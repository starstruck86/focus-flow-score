// ════════════════════════════════════════════════════════════════
// run-telemetry-proof — TEMPORARY service-role-only canary.
//
// Queries recent task_runs to prove Phase 3.6 telemetry persistence.
// Security: requires service-role key in Authorization header.
// This function MUST be deleted after validation.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth: service-role key required via Authorization header ───
  const authHeader = req.headers.get("authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || !authHeader.includes(serviceKey)) {
    return json({ error: "Unauthorized — service role key required" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );

  const results: Record<string, any> = {};
  for (const taskType of ["discovery_prep", "account_brief", "ninety_day_plan"]) {
    const { data, error } = await supabase
      .from("task_runs")
      .select("id, task_type, status, meta, draft_output, created_at, completed_at")
      .eq("task_type", taskType)
      .in("status", ["completed", "failed"])
      .order("created_at", { ascending: false })
      .limit(3);
    
    if (error) {
      results[taskType] = { error: error.message };
      continue;
    }

    results[taskType] = (data || []).map((row: any) => ({
      id: row.id,
      status: row.status,
      has_draft: !!row.draft_output,
      created_at: row.created_at,
      completed_at: row.completed_at,
      meta_keys: row.meta ? Object.keys(row.meta) : [],
      planner: row.meta?.planner ?? null,
      artifact_gate: row.meta?.artifact_gate ?? null,
      performance: row.meta?.performance ?? null,
      anomaly_flags: row.meta?.anomaly_flags ?? null,
      failure_patterns: row.meta?.failure_patterns ?? null,
    }));
  }
  return json({ results });
});
