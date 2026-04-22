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
    if (!body.thread_id) {
      return jsonResponse({ error: "thread_id is required" }, 400);
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

    let companyName = (body.inputs?.company_name as string) || thread.title || "Validation Canary";
    if (thread.linked_account_id) {
      const { data: acct } = await supabase
        .from("accounts")
        .select("name")
        .eq("id", thread.linked_account_id)
        .maybeSingle();
      if (acct?.name) companyName = acct.name;
    }

    const baseInputs: Record<string, unknown> = {
      ...(body.inputs ?? {}),
      thread_id: body.thread_id,
      company_name: companyName,
    };

    console.log(JSON.stringify({
      tag: "[validation-canary:start]",
      user_id: user.id,
      mode: body.mode,
      task_type: body.task_type,
      thread_id: body.thread_id,
    }));

    if (body.mode === "normal") {
      const r = await callRunStrategyTask(authHeader, body.task_type, baseInputs);
      return jsonResponse({
        ok: !r.error,
        mode: "normal",
        run_id: r.run_id ?? null,
        first_run_id: null,
        second_run_id: null,
        same_run_id_returned: null,
        error: r.error ?? null,
      });
    }

    if (body.mode === "fallback") {
      // The forced-failure flag is a validation-only key on inputs. runTask
      // strips/honors it server-side and ONLY when the request originated
      // from this validation endpoint (it is never set by UI paths).
      const fbInputs = {
        ...baseInputs,
        __validation_force_authoring_failure: true,
      };
      const r = await callRunStrategyTask(authHeader, body.task_type, fbInputs);
      return jsonResponse({
        ok: !r.error,
        mode: "fallback",
        run_id: r.run_id ?? null,
        first_run_id: null,
        second_run_id: null,
        same_run_id_returned: null,
        error: r.error ?? null,
      });
    }

    if (body.mode === "collision") {
      // Fire both requests as close to simultaneously as possible. The
      // second call should hit the partial-unique-index path in
      // run-strategy-task and converge on the same run_id.
      const [a, b] = await Promise.all([
        callRunStrategyTask(authHeader, body.task_type, baseInputs),
        callRunStrategyTask(authHeader, body.task_type, baseInputs),
      ]);
      const sameId = !!(a.run_id && b.run_id && a.run_id === b.run_id);
      return jsonResponse({
        ok: !!(a.run_id || b.run_id),
        mode: "collision",
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
