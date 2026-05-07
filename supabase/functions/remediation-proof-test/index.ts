// ════════════════════════════════════════════════════════════════
// remediation-proof-test — Phase 4F live remediation proof.
// Ephemeral, DELETE after proof. Rate-limited to 3 total runs.
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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Rate limit: max 3 debug-forced runs total
    const { data: existing } = await supabaseAdmin
      .from("task_runs")
      .select("id")
      .eq("task_type", "account_brief")
      .contains("inputs", { __debug_force_readability_failure: true })
      .limit(10);

    if ((existing?.length ?? 0) >= 3) {
      return json({
        error: "Rate limit: max 3 debug proof runs reached",
        existing_count: existing?.length,
      }, 429);
    }

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
