// ════════════════════════════════════════════════════════════════
// remediation-proof-test — Phase 4F live remediation proof harness.
// Ephemeral function. DELETE immediately after proof.
// Auth: requires STRATEGY_VALIDATION_KEY in body (same pattern as
// strategy-stress-runner).
// ════════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const VALIDATION_KEY = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";
    if (!VALIDATION_KEY) return json({ error: "STRATEGY_VALIDATION_KEY not configured" }, 503);

    const body = await req.json();
    if (body.key !== VALIDATION_KEY) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const OWNER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";

    const { runStrategyTaskInBackground } = await import(
      "../_shared/strategy-orchestrator/runTask.ts"
    );

    const result = await runStrategyTaskInBackground({
      userId: OWNER_ID,
      supabase: supabaseAdmin,
      inputs: {
        company_name: "Acme Corp",
        __debug_force_readability_failure: true,
      },
      taskType: "account_brief",
    });

    return json({
      success: true,
      run_id: result.run_id,
      status: result.status,
    });
  } catch (e: any) {
    console.error("[remediation-proof-test] error:", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
