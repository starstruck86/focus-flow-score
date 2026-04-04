/**
 * reconcile-library — Scans all user resources and classifies each into
 * work buckets, persisting a reconciliation snapshot.
 *
 * POST /reconcile-library
 * Body: { mode: 'dry_run' | 'safe_auto_fix' | 'force_reprocess' }
 * Returns: run summary with bucket counts and issue breakdown.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const CURRENT_ENRICHMENT_VERSION = 2;
const CURRENT_EXTRACTION_VERSION = 2;
const MIN_KI_FLOOR = 1;

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
  severity: number; // 0-10, higher = more urgent
}

function classifyResource(r: any): ClassifiedItem {
  const issues: string[] = [];
  let severity = 0;

  const status = r.enrichment_status || "not_enriched";
  const contentLen = r.content_length || (r.content ? r.content.length : 0);
  const kiCount = r.knowledge_item_count ?? 0;
  const activeKi = r.active_ki_count ?? 0;
  const enrichVer = r.enrichment_version ?? 0;
  const extractionStatus = r.extraction_status;

  // Missing content
  if (!r.content || contentLen < 100) {
    if (status === "failed") {
      issues.push("enrichment_failed");
      severity = 8;
      return { resource_id: r.id, bucket: "blocked", issues, severity };
    }
    if (!r.file_url || !r.file_url.startsWith("http")) {
      issues.push("no_valid_source_url");
      severity = 2;
      return { resource_id: r.id, bucket: "blocked", issues, severity };
    }
    issues.push("missing_content");
    severity = 7;
    return { resource_id: r.id, bucket: "needs_enrichment", issues, severity };
  }

  // Stale enrichment version
  if (enrichVer < CURRENT_ENRICHMENT_VERSION && status === "deep_enriched") {
    issues.push(`stale_enrichment_v${enrichVer}`);
    severity = Math.max(severity, 4);
  }

  // Not enriched yet
  if (
    status === "not_enriched" ||
    status === "queued_for_deep_enrich" ||
    status === "incomplete"
  ) {
    issues.push("not_enriched");
    severity = 6;
    return {
      resource_id: r.id,
      bucket: "needs_enrichment",
      issues,
      severity,
    };
  }

  // Stuck in processing
  if (
    status === "deep_enrich_in_progress" ||
    status === "reenrich_in_progress"
  ) {
    issues.push("stuck_in_processing");
    severity = 9;
    return { resource_id: r.id, bucket: "needs_qa_review", issues, severity };
  }

  // Missing KIs → needs extraction
  if (kiCount === 0) {
    if (
      extractionStatus === "extraction_requires_review" ||
      extractionStatus === "extraction_failed"
    ) {
      issues.push("extraction_failed_no_kis");
      severity = 7;
      return {
        resource_id: r.id,
        bucket: "needs_qa_review",
        issues,
        severity,
      };
    }
    issues.push("missing_kis");
    severity = 6;
    return {
      resource_id: r.id,
      bucket: "needs_extraction",
      issues,
      severity,
    };
  }

  // Low-yield extraction
  if (kiCount > 0 && kiCount < MIN_KI_FLOOR + 1 && contentLen > 2000) {
    issues.push("low_yield_extraction");
    severity = Math.max(severity, 5);
  }

  // No active KIs (all inactive)
  if (kiCount > 0 && activeKi === 0) {
    issues.push("no_active_kis");
    severity = Math.max(severity, 5);
    return {
      resource_id: r.id,
      bucket: "needs_activation",
      issues,
      severity,
    };
  }

  // Active KIs but missing contexts
  const activeKiCtx = r.active_ki_with_context_count ?? 0;
  if (activeKi > 0 && activeKiCtx === 0) {
    issues.push("missing_contexts");
    severity = Math.max(severity, 4);
    return {
      resource_id: r.id,
      bucket: "needs_activation",
      issues,
      severity,
    };
  }

  // Stale failure_reason on enriched resource
  if (status === "deep_enriched" && r.failure_reason) {
    issues.push("stale_failure_reason");
    severity = Math.max(severity, 2);
  }

  // Re-enrichment needed (stale version + content exists)
  if (issues.some((i) => i.startsWith("stale_enrichment"))) {
    return {
      resource_id: r.id,
      bucket: "needs_re_enrichment",
      issues,
      severity,
    };
  }

  // Low yield → re-extraction
  if (issues.some((i) => i === "low_yield_extraction")) {
    return {
      resource_id: r.id,
      bucket: "needs_re_extraction",
      issues,
      severity,
    };
  }

  // QA review for remaining issues
  if (issues.length > 0) {
    return {
      resource_id: r.id,
      bucket: "needs_qa_review",
      issues,
      severity,
    };
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

    // Validate user
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser();
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
        JSON.stringify({
          error: "A reconciliation run is already active",
          active_run_id: activeRuns[0].id,
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Fetch all resources with lifecycle data
    // Use pagination to handle >1000 resources
    const allResources: any[] = [];
    let offset = 0;
    const pageSize = 500;
    while (true) {
      const { data, error } = await supabase
        .from("resources")
        .select(
          "id, title, content, content_length, enrichment_status, enrichment_version, validation_version, enriched_at, failure_reason, file_url, description, extraction_status, knowledge_item_count, active_ki_count, active_ki_with_context_count, last_quality_tier, last_quality_score, active_job_status"
        )
        .eq("user_id", user.id)
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      if (!data || data.length === 0) break;
      allResources.push(...data);
      if (data.length < pageSize) break;
      offset += pageSize;
    }

    // Classify each resource
    const classified = allResources.map(classifyResource);

    // Aggregate buckets
    const buckets: Record<string, number> = {};
    const issueBreakdown: Record<string, number> = {};
    for (const item of classified) {
      buckets[item.bucket] = (buckets[item.bucket] || 0) + 1;
      for (const issue of item.issues) {
        issueBreakdown[issue] = (issueBreakdown[issue] || 0) + 1;
      }
    }

    // Create run record
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

    // Persist classified items (batch insert in chunks)
    const itemsToInsert = classified.map((c) => ({
      run_id: run.id,
      resource_id: c.resource_id,
      user_id: user.id,
      bucket: c.bucket,
      issues: c.issues,
      severity: c.severity,
      qa_flagged: c.bucket === "needs_qa_review",
      qa_reason:
        c.bucket === "needs_qa_review" ? c.issues.join("; ") : null,
    }));

    for (let i = 0; i < itemsToInsert.length; i += 200) {
      const chunk = itemsToInsert.slice(i, i + 200);
      const { error: insertErr } = await supabase
        .from("library_reconciliation_items")
        .insert(chunk);
      if (insertErr) {
        console.error("Insert items error:", insertErr);
      }
    }

    const summary = {
      run_id: run.id,
      mode,
      total_resources: allResources.length,
      buckets,
      issue_breakdown: issueBreakdown,
      needs_action:
        allResources.length - (buckets["no_action"] || 0),
      qa_flagged: classified.filter((c) => c.bucket === "needs_qa_review")
        .length,
    };

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("reconcile-library error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
