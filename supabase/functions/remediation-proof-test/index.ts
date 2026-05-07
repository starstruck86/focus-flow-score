// ════════════════════════════════════════════════════════════════
// remediation-proof-test — Phase 4F live remediation proof harness.
// Owner-only, ephemeral. DELETE after proof.
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
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Auth: require x-batch-key header (internal service auth pattern)
    const batchKey = req.headers.get("x-batch-key");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    if (!batchKey || batchKey !== serviceKey) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const OWNER_ID = "9f11e308-4028-4527-b7ba-5ea365dc1441";

    const { runStrategyTaskInBackground } = await import("../_shared/strategy-orchestrator/runTask.ts");

    const result = await runStrategyTaskInBackground({
      userId: OWNER_ID,
      supabase: supabaseAdmin,
      inputs: {
        company_name: "Acme Corp",
        __debug_force_readability_failure: true,
      },
      taskType: "account_brief",
    });

    return new Response(JSON.stringify({
      success: true,
      run_id: result.run_id,
      status: result.status,
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
