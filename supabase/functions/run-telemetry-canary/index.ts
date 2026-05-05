// ════════════════════════════════════════════════════════════════
// run-telemetry-canary — TEMPORARY diagnostic endpoint.
// Service-role-gated. Triggers one task run per type using
// runStrategyTaskInBackground, waits for completion, returns meta.
// DELETE THIS AFTER USE.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALIDATION_KEY = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function pollForCompletion(
  svc: any,
  runId: string,
  maxWaitMs = 180_000,
): Promise<Record<string, unknown> | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { data } = await svc
      .from("task_runs")
      .select("id, task_type, status, meta, error, completed_at")
      .eq("id", runId)
      .single();
    if (data && (data.status === "completed" || data.status === "failed")) {
      return data;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Auth: service role OR validation key
  // Auth: service role key via Authorization header, OR validation key, OR temp canary token
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const valKey = req.headers.get("x-strategy-validation-key") ?? "";
  const canaryToken = req.headers.get("x-canary-token") ?? "";
  const TEMP_CANARY_TOKEN = "phase36-telemetry-proof-2026-05-05";
  const okByServiceRole = !!SERVICE_ROLE_KEY && bearer === SERVICE_ROLE_KEY;
  const okByValKey = !!VALIDATION_KEY && valKey === VALIDATION_KEY;
  const okByCanary = canaryToken === TEMP_CANARY_TOKEN;
  if (!okByServiceRole && !okByValKey && !okByCanary) {
    return json({ error: "Unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const userId = body.as_user_id;
  if (!userId) return json({ error: "as_user_id required" }, 400);

  const svc = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  // Impersonate user for RLS
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { "x-supabase-auth": userId } },
  });

  const tasks = [
    {
      taskType: "account_brief" as const,
      inputs: {
        company_name: "Telemetry Canary Corp",
        opportunity: "Platform Deal",
        stage: "Discovery",
        participants: [{ title: "VP Engineering" }],
        desired_next_step: "Technical deep dive",
        prior_notes: "Phase 3.6 telemetry canary run",
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
        prior_notes: "Phase 3.6 telemetry canary run",
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
        prior_notes: "Phase 3.6 telemetry canary run",
      },
    },
  ];

  const results: Record<string, unknown>[] = [];

  for (const task of tasks) {
    try {
      console.log(`[canary] Starting ${task.taskType}...`);
      const { run_id, status } = await runStrategyTaskInBackground({
        userId,
        supabase: svc,
        inputs: task.inputs,
        taskType: task.taskType,
      });
      console.log(`[canary] ${task.taskType} started: ${run_id} (${status})`);

      // Poll for completion
      const finalRow = await pollForCompletion(svc, run_id);
      if (!finalRow) {
        results.push({
          task_type: task.taskType,
          run_id,
          error: "Timed out waiting for completion",
        });
        continue;
      }

      const meta = (finalRow as any).meta ?? {};
      results.push({
        task_type: task.taskType,
        run_id: finalRow.id,
        status: finalRow.status,
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
        error: (finalRow as any).error,
      });
    } catch (err) {
      results.push({
        task_type: task.taskType,
        error: String((err as Error)?.message ?? err).slice(0, 500),
      });
    }
  }

  return json({ canary_results: results });
});
