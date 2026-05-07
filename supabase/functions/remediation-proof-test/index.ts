// ════════════════════════════════════════════════════════════════
// remediation-proof-test — Phase 4F live remediation proof harness.
//
// Owner-only, single-use test function. Invokes run-strategy-task
// with debug_force_readability_failure=true using service role to
// impersonate the owner. Returns the run_id for verification.
//
// DELETE THIS FUNCTION after proof is complete.
// ════════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Use service role for this test harness
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Validate caller is the owner via a simple shared key
    const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY") || "";
    const body = await req.json();
    if (body.validation_key !== validationKey || !validationKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OWNER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";
    const companyName = body.company_name || "Acme Corp";

    // Insert a pending task_runs row directly
    const { data: row, error: insertErr } = await supabaseAdmin
      .from("task_runs")
      .insert({
        user_id: OWNER_ID,
        task_type: "account_brief",
        inputs: {
          company_name: companyName,
          __debug_force_readability_failure: true,
        },
        status: "pending",
        progress_step: "queued",
      })
      .select("id")
      .single();

    if (insertErr || !row) {
      return new Response(JSON.stringify({ error: "Failed to create run", detail: insertErr?.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const runId = row.id;

    // Import and run the pipeline directly
    const { runStrategyTaskInBackground } = await import("../_shared/strategy-orchestrator/runTask.ts");

    // Fire the pipeline in background using service-role supabase
    // but scoped to the owner user
    const result = await runStrategyTaskInBackground({
      userId: OWNER_ID,
      supabase: supabaseAdmin,
      inputs: {
        company_name: companyName,
        __debug_force_readability_failure: true,
      },
      taskType: "account_brief",
    });

    return new Response(JSON.stringify({
      success: true,
      run_id: result.run_id,
      status: result.status,
      message: "Pipeline started with debug_force_readability_failure=true. Poll status to verify.",
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[remediation-proof-test] error:", e);
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
