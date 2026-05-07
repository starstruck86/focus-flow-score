// ════════════════════════════════════════════════════════════════
// remediation-proof-test — Phase 4F live remediation proof.
// Ephemeral, DELETE after proof. No auth needed because it
// only runs once (checks DB for prior execution).
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

    // Rate limit: check if a debug-forced run already exists
    const { data: existing } = await supabaseAdmin
      .from("task_runs")
      .select("id, status")
      .eq("task_type", "account_brief")
      .contains("inputs", { __debug_force_readability_failure: true })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return json({
        error: "Proof run already exists",
        run_id: existing.id,
        status: existing.status,
        message: "Check this run_id for results. Delete this function.",
      }, 409);
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
      message: "Pipeline started with debug_force_readability_failure=true",
    });
  } catch (e: any) {
    console.error("[remediation-proof-test] error:", e);
    return json({ error: e?.message || "Internal error" }, 500);
  }
});
