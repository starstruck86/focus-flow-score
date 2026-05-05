// ════════════════════════════════════════════════════════════════
// run-production-evidence — Phase 3.7B autonomous evidence runner.
//
// TEMPORARY ENDPOINT. Must be deleted after evidence is captured.
// Security: requires STRATEGY_VALIDATION_KEY header. No anon auth.
// Uses service role internally to bypass RLS for the target user.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-strategy-validation-key",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const VALID_TASK_TYPES = ["account_brief", "discovery_prep", "ninety_day_plan"] as const;

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

  // ── Auth: STRATEGY_VALIDATION_KEY or service-role key ─────────
  const validationKey = req.headers.get("x-strategy-validation-key");
  const expectedKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  const validViaKey = expectedKey && validationKey && validationKey === expectedKey;
  const validViaServiceRole = serviceRoleKey && bearerToken === serviceRoleKey;

  if (!validViaKey && !validViaServiceRole) {
    return jsonResponse({ error: "Unauthorized — validation key or service role required" }, 401);
  }

  try {
    const body = await req.json();
    const { user_id, task_type, account_name, wait_for_completion } = body;

    if (!user_id) return jsonResponse({ error: "user_id required" }, 400);
    if (!task_type || !VALID_TASK_TYPES.includes(task_type)) {
      return jsonResponse({ error: `task_type must be one of: ${VALID_TASK_TYPES.join(", ")}` }, 400);
    }
    if (!account_name) return jsonResponse({ error: "account_name required" }, 400);

    // Service-role client to act on behalf of the user
    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Verify user exists
    const { data: userData, error: userErr } = await serviceClient.auth.admin.getUserById(user_id);
    if (userErr || !userData?.user) {
      return jsonResponse({ error: "User not found" }, 404);
    }

    // Build minimal inputs
    const inputs: Record<string, unknown> = {
      company_name: account_name,
    };

    // Look up a real account_id if available
    const { data: acct } = await serviceClient
      .from("accounts")
      .select("id")
      .eq("user_id", user_id)
      .eq("name", account_name)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();

    if (acct?.id) {
      inputs.account_id = acct.id;
    }

    // Look up an opportunity if available (for ninety_day_plan / discovery_prep)
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

    // Trigger real pipeline using service-role client scoped to user
    const { run_id, status } = await runStrategyTaskInBackground({
      userId: user_id,
      supabase: serviceClient,
      inputs,
      taskType: task_type,
    });

    if (!wait_for_completion) {
      return jsonResponse({ run_id, status, task_type });
    }

    // Poll until done
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
