/**
 * reconcile-library — Scans all user resources and classifies each into
 * work buckets, persisting a reconciliation snapshot.
 *
 * POST /reconcile-library
 * Body: { mode: 'dry_run' | 'safe_auto_fix' | 'force_reprocess', backfill_content_length?: boolean }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

const CURRENT_ENRICHMENT_VERSION = 2;

// Statuses that imply content exists even if content_length is null
const CONTENT_IMPLIED_STATUSES = [
  "deep_enriched",
  "extracted",
  "extraction_retrying",
  "content_ready",
  "enriched",
];

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

// ── Attachment reference detection (mirrors client-side attachmentDetection.ts) ──
const ATTACHMENT_PATTERNS = [
  /\bsee\s+(the\s+)?pdf\b/i,
  /\bpdf\s+attached\b/i,
  /\bdownload\s+(the\s+)?(worksheet|workbook|template|checklist|guide|pdf|slides?|deck)\b/i,
  /\bsee\s+(the\s+)?(slide|attachment|document|handout|worksheet|workbook)\b/i,
  /\brefer\s+to\s+(the\s+)?(document|pdf|slide|attachment|worksheet)\b/i,
  /\b(attached|enclosed)\s+(pdf|document|file|worksheet|slide)\b/i,
  /\bclick\s+(here\s+)?to\s+download\b/i,
  /\bdownload\s+(below|above|here)\b/i,
  /\bsee\s+attached\b/i,
];

function hasAttachmentReferences(content: string | null): boolean {
  if (!content) return false;
  return ATTACHMENT_PATTERNS.some(p => p.test(content));
}

function classifyResource(
  r: any,
  kiCount: number,
  activeKiCount: number
): ClassifiedItem {
  const issues: string[] = [];
  let severity = 0;
  const status = r.enrichment_status || "not_enriched";
  const contentLen = r.content_length || 0;
  const enrichVer = r.enrichment_version ?? 0;
  const contentText = r.content || "";
  const hasAttachmentRefs = hasAttachmentReferences(contentText);

  // Determine whether content exists
  const impliedContent = CONTENT_IMPLIED_STATUSES.includes(status);
  const hasContent = contentLen >= 100 || impliedContent;

  // ── 1. No content at all ──────────────────────────────────
  if (!hasContent) {
    if (status === "failed") {
      return { resource_id: r.id, bucket: "blocked", issues: ["enrichment_failed"], severity: 8 };
    }
    if (!r.file_url || (!r.file_url.startsWith("http") && !r.file_url.includes("/"))) {
      return { resource_id: r.id, bucket: "blocked", issues: ["no_valid_source_url"], severity: 2 };
    }
    return { resource_id: r.id, bucket: "needs_enrichment", issues: ["missing_content"], severity: 7 };
  }

  // ── 1b. False needs_auth with usable content ──────────────
  // HARD RULE: If status is needs_auth but content already exists (>= 200 chars),
  // the real issue is extraction, not auth. Reclassify.
  if (status === "needs_auth") {
    const hasUsableContent = contentLen >= 200;
    if (hasUsableContent) {
      // Has content — not really auth-blocked
      if (hasAttachmentRefs) {
        return { resource_id: r.id, bucket: "needs_extraction", issues: ["false_needs_auth_wrapper_page"], severity: 6 };
      }
      return { resource_id: r.id, bucket: "needs_extraction", issues: ["false_needs_auth_has_content"], severity: 5 };
    }
    // Truly auth-blocked with no usable content — but check for attachment references first
    if (hasAttachmentRefs) {
      return { resource_id: r.id, bucket: "needs_extraction", issues: ["auth_blocked_but_has_attachment_ref"], severity: 5 };
    }
    return { resource_id: r.id, bucket: "blocked", issues: ["auth_required"], severity: 6 };
  }

  // ── 2. Not-enriched / early pipeline states ───────────────
  if (["not_enriched", "queued_for_deep_enrich", "incomplete"].includes(status)) {
    return { resource_id: r.id, bucket: "needs_enrichment", issues: ["not_enriched"], severity: 6 };
  }

  // ── 3. Stuck in processing ────────────────────────────────
  if (["deep_enrich_in_progress", "reenrich_in_progress"].includes(status)) {
    return { resource_id: r.id, bucket: "needs_qa_review", issues: ["stuck_in_processing"], severity: 9 };
  }

  // ── 4. Extraction retrying — let it finish unless exhausted
  if (status === "extraction_retrying") {
    const attemptCount = r.extraction_attempt_count || 0;
    const maxAttempts = r.max_extraction_attempts || 4;
    if (attemptCount >= maxAttempts) {
      return { resource_id: r.id, bucket: "needs_qa_review", issues: ["extraction_exhausted_retries"], severity: 6 };
    }
    return { resource_id: r.id, bucket: "no_action", issues: ["extraction_retrying_in_progress"], severity: 0 };
  }

  // ── 5. Content ready / enriched but not yet deep-enriched ─
  if (["content_ready", "enriched"].includes(status)) {
    if (kiCount === 0) {
      return { resource_id: r.id, bucket: "needs_extraction", issues: ["content_ready_no_kis"], severity: 5 };
    }
    // Has KIs — functional, check activation below
  }

  // ── 6. Version drift (deep_enriched with stale version) ───
  const isStaleVersion = enrichVer < CURRENT_ENRICHMENT_VERSION && status === "deep_enriched";
  if (isStaleVersion) {
    issues.push(`stale_enrichment_v${enrichVer}`);
    severity = Math.max(severity, 4);
  }

  // ── 7. Missing KIs on enriched content ────────────────────
  if (kiCount === 0 && ["deep_enriched", "extracted"].includes(status)) {
    if (r.extraction_failure_type) {
      return { resource_id: r.id, bucket: "needs_qa_review", issues: ["extraction_failed_no_kis"], severity: 7 };
    }
    return { resource_id: r.id, bucket: "needs_extraction", issues: ["missing_kis"], severity: 6 };
  }

  // ── 8. Low-yield check (tighter thresholds) ───────────────
  // Use effective content length: if implied but null, estimate conservatively
  const effectiveLen = contentLen > 0 ? contentLen : (impliedContent ? 3000 : 0);
  const lowYieldFloor = effectiveLen > 8000 ? 5 : effectiveLen > 4000 ? 3 : effectiveLen > 2000 ? 2 : 1;
  if (kiCount > 0 && kiCount <= lowYieldFloor && effectiveLen > 2000) {
    issues.push("low_yield_extraction");
    severity = Math.max(severity, 5);
  }

  // ── 9. No active KIs ─────────────────────────────────────
  if (kiCount > 0 && activeKiCount === 0) {
    return { resource_id: r.id, bucket: "needs_activation", issues: [...issues, "no_active_kis"], severity: Math.max(severity, 5) };
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
  if (isStaleVersion && kiCount === 0) {
    return { resource_id: r.id, bucket: "needs_re_enrichment", issues, severity };
  }
  // Low yield → re-extraction
  if (issues.includes("low_yield_extraction")) {
    return { resource_id: r.id, bucket: "needs_re_extraction", issues, severity };
  }
  // Remaining non-trivial issues → QA
  const substantiveIssues = issues.filter(i => !i.startsWith("extraction_retrying") && i !== "stale_failure_reason");
  if (substantiveIssues.length > 0) {
    return { resource_id: r.id, bucket: "needs_qa_review", issues, severity };
  }

  // ── 12. ANTI-LIMBO GUARD ──────────────────────────────────
  // Content-backed + 0 KIs + not processing → must not be invisible
  if (kiCount === 0 && contentLen >= 200) {
    if (hasAttachmentRefs) {
      return { resource_id: r.id, bucket: "needs_extraction", issues: ["wrapper_page_needs_attachment_extraction"], severity: 5 };
    }
    return { resource_id: r.id, bucket: "needs_extraction", issues: ["anti_limbo_content_backed_no_kis"], severity: 5 };
  }

  return { resource_id: r.id, bucket: "no_action", issues, severity: 0 };
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
    const backfillContentLength = body.backfill_content_length === true;

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
        .select("id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, extraction_attempt_count, max_extraction_attempts, extraction_failure_type, last_quality_tier, last_quality_score, active_job_status")
        .eq("user_id", user.id)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allResources.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // ── Content-length backfill ─────────────────────────────
    let backfilledCount = 0;
    if (backfillContentLength) {
      for (const r of allResources) {
        if (!r.content_length && r.content && r.content.length > 0) {
          const realLen = r.content.length;
          await supabase
            .from("resources")
            .update({ content_length: realLen })
            .eq("id", r.id);
          r.content_length = realLen;
          backfilledCount++;
        }
      }
    }

    // Get KI counts per resource — paginated to avoid 1000-row limit
    const resourceIds = allResources.map((r) => r.id);
    const kiCounts: Record<string, { total: number; active: number }> = {};

    for (let i = 0; i < resourceIds.length; i += 50) {
      const chunk = resourceIds.slice(i, i + 50);
      // Paginate within each chunk to handle >1000 KIs per chunk
      let kiOffset = 0;
      const kiPageSize = 1000;
      while (true) {
        const { data: kis } = await supabase
          .from("knowledge_items")
          .select("source_resource_id, active")
          .in("source_resource_id", chunk)
          .range(kiOffset, kiOffset + kiPageSize - 1);

        if (!kis || kis.length === 0) break;

        for (const ki of kis) {
          const rid = ki.source_resource_id;
          if (!kiCounts[rid]) kiCounts[rid] = { total: 0, active: 0 };
          kiCounts[rid].total++;
          if (ki.active) kiCounts[rid].active++;
        }

        if (kis.length < kiPageSize) break;
        kiOffset += kiPageSize;
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
      backfilled_content_length: backfilledCount,
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
