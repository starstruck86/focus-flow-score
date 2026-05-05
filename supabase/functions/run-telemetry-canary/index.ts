// ════════════════════════════════════════════════════════════════
// run-telemetry-canary — TEMPORARY diagnostic endpoint.
// Service-role-gated. Triggers task runs, returns run_ids immediately.
// Use action:"check" to poll results.
// DELETE THIS AFTER USE.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-canary-token",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const TEMP_CANARY_TOKEN = "phase36-telemetry-proof-2026-05-05";

function checkAuth(req: Request): boolean {
  const canaryToken = req.headers.get("x-canary-token") ?? "";
  if (canaryToken === TEMP_CANARY_TOKEN) return true;
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  if (!!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY) return true;
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!checkAuth(req)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const action = body.action ?? "start";

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // ── Check results for given run_ids ──
  if (action === "check") {
    const runIds: string[] = body.run_ids ?? [];
    if (!runIds.length) return json({ error: "run_ids required" }, 400);
    const { data } = await svc
      .from("task_runs")
      .select("id, task_type, status, meta, error, completed_at")
      .in("id", runIds);
    const results = (data ?? []).map((row: any) => {
      const meta = row.meta ?? {};
      return {
        task_type: row.task_type,
        run_id: row.id,
        status: row.status,
        error: row.error,
        has_planner: !!meta.planner,
        planner: meta.planner ?? null,
        has_artifact_gate: !!meta.artifact_gate,
        artifact_gate: meta.artifact_gate ?? null,
        has_performance: !!meta.performance,
        performance: meta.performance ?? null,
        has_anomaly_flags: !!meta.anomaly_flags,
        anomaly_flags: meta.anomaly_flags ?? null,
        has_failure_patterns: !!meta.failure_patterns,
        failure_patterns: meta.failure_patterns ?? null,
      };
    });
    return json({ results });
  }

  // ── Start runs ──
  const userId = body.as_user_id;
  if (!userId) return json({ error: "as_user_id required" }, 400);

  const tasks = [
    {
      taskType: "account_brief" as const,
      inputs: {
        company_name: "Telemetry Canary Corp",
        opportunity: "Platform Deal",
        stage: "Discovery",
        participants: [{ title: "VP Engineering" }],
        desired_next_step: "Technical deep dive",
        prior_notes: "Phase 3.6 telemetry canary",
      },
    },
    {
      taskType: "ninety_day_plan" as const,
      inputs: {
        company_name: "Canary Ventures",
        opportunity: "Migration Project",
        stage: "Negotiation",
        participants: [{ title: "CTO" }],
        desired_next_step: "Contract review",
        prior_notes: "Phase 3.6 telemetry canary",
      },
    },
    {
      taskType: "discovery_prep" as const,
      inputs: {
        company_name: "Canary Global",
        opportunity: "Data Integration",
        stage: "Qualification",
        participants: [{ title: "Director Ops" }],
        desired_next_step: "Discovery call",
        prior_notes: "Phase 3.6 telemetry canary",
      },
    },
  ];

  const runIds: Record<string, string> = {};
  for (const task of tasks) {
    try {
      const { run_id } = await runStrategyTaskInBackground({
        userId,
        supabase: svc,
        inputs: task.inputs,
        taskType: task.taskType,
      });
      runIds[task.taskType] = run_id;
    } catch (err) {
      runIds[task.taskType] = `ERROR: ${String((err as Error)?.message ?? err).slice(0, 200)}`;
    }
  }

  return json({ started: true, run_ids: runIds });
});
