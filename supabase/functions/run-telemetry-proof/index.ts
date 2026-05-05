// ════════════════════════════════════════════════════════════════
// run-telemetry-proof — TEMPORARY service-role-only canary.
//
// Queries task_runs to prove Phase 3.6 telemetry. Can also fire
// tasks using a specified user_id for impersonation.
//
// Security: validates Authorization Bearer matches SUPABASE_SERVICE_ROLE_KEY.
// This function MUST be deleted after validation.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pollForCompletion(supabase: any, runId: string, maxWaitMs = 120_000): Promise<any> {
  const startMs = Date.now();
  while (Date.now() - startMs < maxWaitMs) {
    const { data } = await supabase
      .from("task_runs")
      .select("id, task_type, status, meta, draft_output, error, completed_at")
      .eq("id", runId)
      .single();
    if (data && (data.status === "completed" || data.status === "failed")) return data;
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth: service role key in Authorization Bearer ─────────────
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!serviceKey || token !== serviceKey) {
    return json({ error: "Unauthorized — service role required" }, 401);
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const body = await req.json().catch(() => ({}));
  const action = body.action || "query";

  if (action === "query") {
    const results: Record<string, any> = {};
    for (const taskType of ["discovery_prep", "account_brief", "ninety_day_plan"]) {
      const { data, error } = await supabase
        .from("task_runs")
        .select("id, task_type, status, meta, draft_output, created_at, completed_at")
        .eq("task_type", taskType)
        .in("status", ["completed", "failed"])
        .order("created_at", { ascending: false })
        .limit(3);
      if (error) { results[taskType] = { error: error.message }; continue; }
      results[taskType] = (data || []).map((row: any) => ({
        id: row.id, status: row.status, has_draft: !!row.draft_output,
        created_at: row.created_at, completed_at: row.completed_at,
        meta_keys: row.meta ? Object.keys(row.meta) : [],
        planner: row.meta?.planner ?? null,
        artifact_gate: row.meta?.artifact_gate ?? null,
        performance: row.meta?.performance ?? null,
        anomaly_flags: row.meta?.anomaly_flags ?? null,
        failure_patterns: row.meta?.failure_patterns ?? null,
      }));
    }
    return json({ results });
  }

  if (action === "fire") {
    const userId = body.user_id;
    if (!userId) return json({ error: "user_id required" }, 400);
    const taskType = body.task_type || "account_brief";
    const forceFailure = body.force_failure === true;
    const inputs: Record<string, any> = {
      company_name: `Telemetry Proof ${taskType}`,
      opportunity: "Phase 3.6 Validation",
      stage: "Discovery",
      desired_next_step: "Validate telemetry persistence",
    };
    if (forceFailure) {
      inputs.__validation_force_authoring_failure = true;
      inputs.__validation_origin = "run-validation-canary";
    }

    try {
      const { run_id } = await runStrategyTaskInBackground({
        userId, supabase, inputs, taskType,
      });
      const result = await pollForCompletion(supabase, run_id);
      if (!result) return json({ error: "Timed out", run_id }, 504);
      return json({
        run_id: result.id, task_type: result.task_type, status: result.status,
        has_draft: !!result.draft_output, error: result.error,
        meta_keys: result.meta ? Object.keys(result.meta) : [],
        planner: result.meta?.planner ?? null,
        artifact_gate: result.meta?.artifact_gate ?? null,
        performance: result.meta?.performance ?? null,
        anomaly_flags: result.meta?.anomaly_flags ?? null,
        failure_patterns: result.meta?.failure_patterns ?? null,
      });
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }

  return json({ error: "Unknown action" }, 400);
});
