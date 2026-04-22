// ════════════════════════════════════════════════════════════════
// run-validation-canary — controlled canary trigger for live
// validation of the Strategy reliability stack.
//
// Modes:
//   - normal     : start one normal deep-work run via run-strategy-task
//   - fallback   : start one run with a one-shot forced primary-authoring
//                  failure so the fallback ladder is exercised end-to-end
//   - collision  : fire two near-simultaneous generate requests for the
//                  same (thread_id, task_type) and confirm the second
//                  call returns the SAME run_id (idempotency)
//
// Auth model:
//   - Bearer JWT required (authenticated user)
//   - Body must include validation_key === STRATEGY_VALIDATION_KEY
//   - No service-role bypass
//   - This endpoint is for canary operators only
//
// Validator run association:
//   - One validator_run_id (uuid) is generated per endpoint call.
//   - It is forwarded on inputs and stamped into task_runs.meta.validation_canary
//     so evidence can be queried/grouped after the fact, even when logs
//     roll off. Collision mode uses the SAME validator_run_id for both
//     attempted runs.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ALLOWED_TASK_TYPES = new Set(["discovery_prep", "account_brief", "ninety_day_plan"]);
const ALLOWED_MODES = new Set(["normal", "fallback", "collision"]);

// Any input key prefixed with __validation_ is reserved for this endpoint.
// We strip every such key from operator-provided inputs before adding our
// own server-controlled markers, so callers cannot smuggle additional
// validation flags into the pipeline.
const RESERVED_VALIDATION_PREFIX = "__validation_";

interface CanaryBody {
  mode: string;
  thread_id: string;
  task_type: string;
  validation_key: string;
  inputs?: Record<string, unknown>;
}

async function callRunStrategyTask(
  authHeader: string,
  taskType: string,
  inputs: Record<string, unknown>,
): Promise<{ run_id?: string; status?: string; idempotent?: boolean; error?: string }> {
  const resp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-strategy-task`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
      apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    },
    body: JSON.stringify({ action: "generate", task_type: taskType, inputs }),
  });
  const json = await resp.json().catch(() => ({}));
  return json;
}

// Best-effort: stamp meta.validation_canary onto a created task_runs row so
// the drawer can group recent canary runs by validator_run_id.
// We MERGE with any existing validation_canary payload so caller-stamped
// fields (e.g. collision_evidence) survive.
async function stampValidationMeta(
  supabase: any,
  runId: string,
  payload: Record<string, unknown>,
) {
  try {
    const { data: row } = await supabase
      .from("task_runs")
      .select("meta")
      .eq("id", runId)
      .maybeSingle();
    const existing = (row?.meta as Record<string, unknown> | null) || {};
    const existingCanary = (existing.validation_canary as Record<string, unknown> | undefined) || {};
    const next = {
      ...existing,
      validation_canary: { ...existingCanary, ...payload },
    };
    await supabase.from("task_runs").update({ meta: next }).eq("id", runId);
  } catch (e) {
    console.warn("[validation-canary] meta stamp failed:", (e as Error).message);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    let body: CanaryBody;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const expectedKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
    if (!expectedKey) return jsonResponse({ error: "Validation key not configured" }, 500);
    if (body.validation_key !== expectedKey) {
      return jsonResponse({ error: "Forbidden" }, 403);
    }

    if (!ALLOWED_MODES.has(body.mode)) {
      return jsonResponse({ error: "Invalid mode" }, 400);
    }
    if (!ALLOWED_TASK_TYPES.has(body.task_type)) {
      return jsonResponse({ error: "Invalid task_type" }, 400);
    }
    if (!body.thread_id || typeof body.thread_id !== "string") {
      return jsonResponse({ error: "thread_id is required" }, 400);
    }

    // Strip ANY operator-provided __validation_* keys. Only this endpoint
    // is allowed to set validation markers on inputs.
    const operatorInputs: Record<string, unknown> = { ...(body.inputs ?? {}) };
    const strippedKeys: string[] = [];
    for (const k of Object.keys(operatorInputs)) {
      if (k.startsWith(RESERVED_VALIDATION_PREFIX)) {
        strippedKeys.push(k);
        delete operatorInputs[k];
      }
    }
    if (strippedKeys.length > 0) {
      console.warn(JSON.stringify({
        tag: "[validation-canary:stripped_reserved_keys]",
        user_id: user.id,
        keys: strippedKeys,
      }));
    }

    // Pull a default company name from the linked thread / account so the
    // task pipeline (which requires inputs.company_name) has something to
    // work with. Operator can override via body.inputs.
    const { data: thread } = await supabase
      .from("strategy_threads")
      .select("id, linked_account_id, title")
      .eq("id", body.thread_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!thread) return jsonResponse({ error: "Thread not found" }, 404);

    let companyName = (operatorInputs.company_name as string) || thread.title || "Validation Canary";
    if (thread.linked_account_id) {
      const { data: acct } = await supabase
        .from("accounts")
        .select("name")
        .eq("id", thread.linked_account_id)
        .maybeSingle();
      if (acct?.name) companyName = acct.name;
    }

    // One validator_run_id per endpoint invocation.
    const validatorRunId = crypto.randomUUID();

    const baseInputs: Record<string, unknown> = {
      ...operatorInputs,
      thread_id: body.thread_id,
      company_name: companyName,
      // Server-controlled origin marker. runTask.ts only honors validation
      // flags when this exact value is present.
      __validation_origin: "run-validation-canary",
      __validation_run_id: validatorRunId,
      __validation_mode: body.mode,
    };

    console.log(JSON.stringify({
      tag: "[validation-canary:start]",
      user_id: user.id,
      mode: body.mode,
      task_type: body.task_type,
      thread_id: body.thread_id,
      validator_run_id: validatorRunId,
    }));

    const requestedAt = new Date().toISOString();
    const baseMetaPayload: Record<string, unknown> = {
      mode: body.mode,
      thread_id: body.thread_id,
      task_type: body.task_type,
      validator_run_id: validatorRunId,
      requested_at: requestedAt,
    };

    if (body.mode === "normal") {
      const r = await callRunStrategyTask(authHeader, body.task_type, baseInputs);
      const idempotent = r.idempotent === true;
      const metaPayload = {
        ...baseMetaPayload,
        forced_primary_failure_requested: false,
        idempotent_short_circuit: idempotent,
        fresh_run_created: !idempotent && !!r.run_id,
      };
      if (r.run_id) await stampValidationMeta(supabase, r.run_id, metaPayload);
      return jsonResponse({
        ok: !r.error,
        mode: "normal",
        validator_run_id: validatorRunId,
        run_id: r.run_id ?? null,
        idempotent,
        first_run_id: null,
        second_run_id: null,
        same_run_id_returned: null,
        error: r.error ?? null,
      });
    }

    if (body.mode === "fallback") {
      // Fallback ONLY: add the force-failure flag. Normal/collision modes
      // never set this. runTask.ts additionally requires the origin marker.
      const fbInputs = {
        ...baseInputs,
        __validation_force_authoring_failure: true,
      };
      const r = await callRunStrategyTask(authHeader, body.task_type, fbInputs);
      const idempotent = r.idempotent === true;
      const metaPayload = {
        ...baseMetaPayload,
        forced_primary_failure_requested: true,
        idempotent_short_circuit: idempotent,
        fresh_run_created: !idempotent && !!r.run_id,
      };
      if (r.run_id) await stampValidationMeta(supabase, r.run_id, metaPayload);
      return jsonResponse({
        ok: !r.error,
        mode: "fallback",
        validator_run_id: validatorRunId,
        run_id: r.run_id ?? null,
        idempotent,
        first_run_id: null,
        second_run_id: null,
        same_run_id_returned: null,
        error: r.error ?? null,
      });
    }

    if (body.mode === "collision") {
      // Both attempts share the same validator_run_id.
      const [a, b] = await Promise.all([
        callRunStrategyTask(authHeader, body.task_type, baseInputs),
        callRunStrategyTask(authHeader, body.task_type, baseInputs),
      ]);
      const bothReturned = !!(a.run_id && b.run_id);
      const sameId = bothReturned && a.run_id === b.run_id;
      const ids = Array.from(new Set([a.run_id, b.run_id].filter(Boolean) as string[]));
      // For collision, "idempotent_short_circuit" describes whether at least
      // one of the two parallel calls returned an existing pending run rather
      // than creating a fresh one.
      const idempotent = a.idempotent === true || b.idempotent === true;
      const collisionMeta = {
        ...baseMetaPayload,
        forced_primary_failure_requested: false,
        idempotent_short_circuit: idempotent,
        fresh_run_created: !idempotent && ids.length > 0,
        collision_evidence: {
          first_run_id: a.run_id ?? null,
          second_run_id: b.run_id ?? null,
          both_returned: bothReturned,
          same_run_id_returned: bothReturned ? sameId : null,
          distinct_run_ids: ids,
        },
      };
      await Promise.all(ids.map((id) => stampValidationMeta(supabase, id, collisionMeta)));
      return jsonResponse({
        ok: !!(a.run_id || b.run_id),
        mode: "collision",
        validator_run_id: validatorRunId,
        idempotent,
        run_id: null,
        first_run_id: a.run_id ?? null,
        second_run_id: b.run_id ?? null,
        same_run_id_returned: sameId,
        error: a.error ?? b.error ?? null,
      });
    }

    return jsonResponse({ error: "Unsupported mode" }, 400);
  } catch (e: any) {
    console.error("[validation-canary] error:", e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});
