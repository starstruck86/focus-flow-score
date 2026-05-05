// ════════════════════════════════════════════════════════════════
// run-production-evidence — Phase 3.7B autonomous evidence runner.
//
// TEMPORARY ENDPOINT. Must be deleted after evidence is captured.
// Security: Self-validates by comparing an internal secret.
// Uses service role internally to bypass RLS for the target user.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_TASK_TYPES = ["account_brief", "discovery_prep", "ninety_day_plan"] as const;
const DEFAULT_USER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";
const DEFAULT_ACCOUNT = "Arrow Exterminators";

async function pollForCompletion(
  supabase: any,
  runId: string,
  timeoutMs = 300_000,
  intervalMs = 5_000,
): Promise<any> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data: row, error } = await supabase
      .from("task_runs")
      .select("id, status, progress_step, error, draft_output, meta, completed_at, updated_at")
      .eq("id", runId)
      .single();
    if (error) throw new Error(`Poll failed: ${error.message}`);
    if (row.status === "completed" || row.status === "failed") return row;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`Timeout after ${timeoutMs}ms waiting for run ${runId}`);
}

function extractTelemetry(meta: any) {
  return {
    planner: !!meta?.planner,
    artifact_gate: !!meta?.artifact_gate,
    performance: !!meta?.performance,
    anomaly_flags: !!meta?.anomaly_flags,
    failure_patterns: !!meta?.failure_patterns,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // ── Auth: body.secret must match STRATEGY_VALIDATION_KEY ─────
  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const expectedKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  if (!expectedKey || body.secret !== expectedKey) {
    // Also try x-strategy-validation-key header
    const headerKey = req.headers.get("x-strategy-validation-key");
    if (!headerKey || headerKey !== expectedKey) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
  }

  try {
    const user_id = body.user_id || DEFAULT_USER_ID;
    const task_type = body.task_type || "account_brief";
    const account_name = body.account_name || DEFAULT_ACCOUNT;
    const wait_for_completion = body.wait_for_completion !== false;

    if (!VALID_TASK_TYPES.includes(task_type)) {
      return jsonResponse({ error: `task_type must be one of: ${VALID_TASK_TYPES.join(", ")}` }, 400);
    }

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceRoleKey,
    );

    // Verify user exists
    const { data: userData, error: userErr } = await serviceClient.auth.admin.getUserById(user_id);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "User not found" }, 404);
    }

    const inputs: Record<string, unknown> = { company_name: account_name };

    const { data: acct } = await serviceClient
      .from("accounts")
      .select("id")
      .eq("user_id", user_id)
      .eq("name", account_name)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (acct?.id) inputs.account_id = acct.id;

    if (acct?.id && (task_type === "ninety_day_plan" || task_type === "discovery_prep")) {
      const { data: opp } = await serviceClient
        .from("opportunities")
        .select("id, name, stage")
        .eq("account_id", acct.id)
        .eq("user_id", user_id)
        .limit(1)
        .maybeSingle();
      if (opp) {
        inputs.opportunity = opp.name;
        inputs.stage = opp.stage;
        inputs.opportunity_id = opp.id;
      }
    }

    console.log(JSON.stringify({
      tag: "[production-evidence:trigger]",
      user_id: user_id.slice(0, 8),
      task_type,
      account_name,
      has_account_id: !!inputs.account_id,
    }));

    const { run_id, status } = await runStrategyTaskInBackground({
      userId: user_id,
      supabase: serviceClient,
      inputs,
      taskType: task_type,
    });

    if (!wait_for_completion) {
      return jsonResponse({ run_id, status, task_type });
    }

    const finalRow = await pollForCompletion(serviceClient, run_id);
    const meta = finalRow.meta || {};

    return jsonResponse({
      run_id: finalRow.id,
      task_type,
      status: finalRow.status,
      telemetry_present: extractTelemetry(meta),
      has_draft_output: !!finalRow.draft_output,
      meta_snapshot: {
        planner: meta.planner || null,
        artifact_gate: meta.artifact_gate || null,
        performance: meta.performance || null,
        anomaly_flags: meta.anomaly_flags || null,
        failure_patterns: meta.failure_patterns || null,
      },
      completed_at: finalRow.completed_at,
      error: finalRow.error || null,
    });
  } catch (e: any) {
    console.error("[run-production-evidence] error:", e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});
