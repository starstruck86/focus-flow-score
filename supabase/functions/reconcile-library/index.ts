/**
 * reconcile-library — Scans all user resources and classifies each into
 * work buckets, persisting a reconciliation snapshot.
 *
 * POST /reconcile-library
 * Body: { mode: 'dry_run' | 'safe_auto_fix' | 'force_reprocess' }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CURRENT_ENRICHMENT_VERSION = 2;

type Bucket =
  | "no_action"
  | "needs_enrichment"
  | "needs_extraction"
  | "needs_activation"
  | "needs_re_enrichment"
  | "needs_re_extraction"
  | "needs_qa_review"
  | "blocked";

interface ClassifiedItem {
  resource_id: string;
  bucket: Bucket;
  issues: string[];
  severity: number;
}

function classifyResource(
  r: any,
  kiCount: number,
  activeKiCount: number
): ClassifiedItem {
  const issues: string[] = [];
  let severity = 0;
  const status = r.enrichment_status || "not_enriched";
  const contentLen = r.content_length || r.actual_content_len || 0;
  const enrichVer = r.enrichment_version ?? 0;
  // If status indicates successful enrichment/extraction, trust that content exists
  const impliedContent = ["deep_enriched", "extracted", "extraction_retrying", "content_ready", "enriched"].includes(status);
  const hasContent = contentLen >= 100 || impliedContent;

  // ── 1. No content at all ──────────────────────────────────
  if (!hasContent) {
    // Failed enrichment → blocked
    if (status === "failed") {
      return { resource_id: r.id, bucket: "blocked", issues: ["enrichment_failed"], severity: 8 };
    }
    // No valid URL → blocked
    if (!r.file_url || (!r.file_url.startsWith("http") && !r.file_url.includes("/"))) {
      return { resource_id: r.id, bucket: "blocked", issues: ["no_valid_source_url"], severity: 2 };
    }
    // Can still be enriched
    return { resource_id: r.id, bucket: "needs_enrichment", issues: ["missing_content"], severity: 7 };
  }

  // ── 2. Not-enriched / early pipeline states ───────────────
  if (["not_enriched", "queued_for_deep_enrich", "incomplete"].includes(status)) {
    return { resource_id: r.id, bucket: "needs_enrichment", issues: ["not_enriched"], severity: 6 };
  }

  // ── 3. Stuck in processing ────────────────────────────────
  if (["deep_enrich_in_progress", "reenrich_in_progress"].includes(status)) {
    return { resource_id: r.id, bucket: "needs_qa_review", issues: ["stuck_in_processing"], severity: 9 };
  }

  // ── 4. Content ready but not fully enriched ───────────────
  if (["content_ready", "enriched"].includes(status)) {
    if (kiCount === 0) {
      // Has content but needs extraction
      return { resource_id: r.id, bucket: "needs_extraction", issues: ["content_ready_no_kis"], severity: 5 };
    }
    // Has content and KIs — treat as functional
  }

  // ── 5. Extraction in progress / retrying ──────────────────
  if (status === "extraction_retrying") {
    // Has KIs but retrying = let it finish, but flag if stuck
    const attemptCount = r.extraction_attempt_count || 0;
    const maxAttempts = r.max_extraction_attempts || 4;
    if (attemptCount >= maxAttempts) {
      issues.push("extraction_exhausted_retries");
      return { resource_id: r.id, bucket: "needs_qa_review", issues, severity: 6 };
    }
    // Still retrying — no action needed from reconciliation
    return { resource_id: r.id, bucket: "no_action", issues: ["extraction_retrying_in_progress"], severity: 0 };
  }

  // ── 6. Version drift check (only for deep_enriched) ──────
  const isStaleVersion = enrichVer < CURRENT_ENRICHMENT_VERSION && status === "deep_enriched";
  if (isStaleVersion) {
    issues.push(`stale_enrichment_v${enrichVer}`);
    severity = Math.max(severity, 4);
  }

  // ── 7. Missing KIs on enriched content ────────────────────
  if (kiCount === 0 && ["deep_enriched", "extracted"].includes(status)) {
    // Check if extraction was attempted and failed
    if (r.extraction_failure_type) {
      issues.push("extraction_failed_no_kis");
      return { resource_id: r.id, bucket: "needs_qa_review", issues, severity: 7 };
    }
    issues.push("missing_kis");
    return { resource_id: r.id, bucket: "needs_extraction", issues, severity: 6 };
  }

  // ── 8. Low-yield check ────────────────────────────────────
  // Scale floor by content length
  const lowYieldFloor = contentLen > 5000 ? 3 : contentLen > 2000 ? 2 : 1;
  if (kiCount > 0 && kiCount <= lowYieldFloor && contentLen > 2000) {
    issues.push("low_yield_extraction");
    severity = Math.max(severity, 5);
  }

  // ── 9. No active KIs ─────────────────────────────────────
  if (kiCount > 0 && activeKiCount === 0) {
    issues.push("no_active_kis");
    return { resource_id: r.id, bucket: "needs_activation", issues, severity: 5 };
  }

  // ── 10. Stale failure_reason on enriched resource ─────────
  if (status === "deep_enriched" && r.failure_reason) {
    issues.push("stale_failure_reason");
    severity = Math.max(severity, 2);
  }

  // ── 11. Route to final bucket ─────────────────────────────
  // Stale version with existing KIs → re-enrichment (not re-extraction)
  if (isStaleVersion && kiCount > 0) {
    return { resource_id: r.id, bucket: "needs_re_enrichment", issues, severity };
  }
  // Stale version without KIs → needs extraction after re-enrichment
  if (isStaleVersion && kiCount === 0) {
    return { resource_id: r.id, bucket: "needs_re_enrichment", issues, severity };
  }
  // Low yield → re-extraction
  if (issues.some((i) => i === "low_yield_extraction")) {
    return { resource_id: r.id, bucket: "needs_re_extraction", issues, severity };
  }
  // Remaining issues → QA
  if (issues.length > 0 && issues.some(i => !i.startsWith("extraction_retrying"))) {
    return { resource_id: r.id, bucket: "needs_qa_review", issues, severity };
  }

  return { resource_id: r.id, bucket: "no_action", issues: [], severity: 0 };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const mode = body.mode || "dry_run";

    // Check no active run
    const { data: activeRuns } = await supabase
      .from("library_reconciliation_runs")
      .select("id")
      .eq("user_id", user.id)
      .in("status", ["pending", "scanning", "running"])
      .limit(1);

    if (activeRuns && activeRuns.length > 0) {
      return new Response(
        JSON.stringify({ error: "A reconciliation run is already active", active_run_id: activeRuns[0].id }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all resources (paginated)
    const allResources: any[] = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await supabase
        .from("resources")
        .select("id, title, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, extraction_attempt_count, max_extraction_attempts, extraction_failure_type, last_quality_tier, last_quality_score, active_job_status")
        .eq("user_id", user.id)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allResources.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Get KI counts per resource
    const resourceIds = allResources.map((r) => r.id);
    const kiCounts: Record<string, { total: number; active: number }> = {};

    for (let i = 0; i < resourceIds.length; i += 200) {
      const chunk = resourceIds.slice(i, i + 200);
      const { data: kis } = await supabase
        .from("knowledge_items")
        .select("source_resource_id, active")
        .in("source_resource_id", chunk);

      if (kis) {
        for (const ki of kis) {
          const rid = ki.source_resource_id;
          if (!kiCounts[rid]) kiCounts[rid] = { total: 0, active: 0 };
          kiCounts[rid].total++;
          if (ki.active) kiCounts[rid].active++;
        }
      }
    }

    // Classify
    const classified = allResources.map((r) => {
      const counts = kiCounts[r.id] || { total: 0, active: 0 };
      return classifyResource(r, counts.total, counts.active);
    });

    // Aggregate
    const buckets: Record<string, number> = {};
    const issueBreakdown: Record<string, number> = {};
    for (const item of classified) {
      buckets[item.bucket] = (buckets[item.bucket] || 0) + 1;
      for (const issue of item.issues) {
        issueBreakdown[issue] = (issueBreakdown[issue] || 0) + 1;
      }
    }

    // Create run
    const { data: run, error: runErr } = await supabase
      .from("library_reconciliation_runs")
      .insert({
        user_id: user.id,
        mode,
        status: "scanned",
        total_resources: allResources.length,
        buckets,
        issue_breakdown: issueBreakdown,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (runErr) throw runErr;

    // Persist items
    const itemsToInsert = classified.map((c) => ({
      run_id: run.id,
      resource_id: c.resource_id,
      user_id: user.id,
      bucket: c.bucket,
      issues: c.issues,
      severity: c.severity,
      qa_flagged: c.bucket === "needs_qa_review",
      qa_reason: c.bucket === "needs_qa_review" ? c.issues.join("; ") : null,
    }));

    for (let i = 0; i < itemsToInsert.length; i += 200) {
      const chunk = itemsToInsert.slice(i, i + 200);
      const { error: insertErr } = await supabase
        .from("library_reconciliation_items")
        .insert(chunk);
      if (insertErr) console.error("Insert items error:", insertErr);
    }

    const summary = {
      run_id: run.id,
      mode,
      total_resources: allResources.length,
      buckets,
      issue_breakdown: issueBreakdown,
      needs_action: allResources.length - (buckets["no_action"] || 0),
      qa_flagged: classified.filter((c) => c.bucket === "needs_qa_review").length,
    };

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("reconcile-library error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
