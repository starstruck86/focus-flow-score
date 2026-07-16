// ════════════════════════════════════════════════════════════════
// run-strategy-task-reaper — cron-triggered, time-gated stale-run reaper.
//
// Sweeps ALL users for task_runs rows stuck in `pending` past their
// stage budget and fails them with explicit `stage_timeout:<step>`.
//
// Triggered by pg_cron every minute. Uses the service role so it can
// reach rows across users without auth.
// ════════════════════════════════════════════════════════════════

import { createClient } from "npm:@supabase/supabase-js@2";
import { sweepStalePendingRuns } from "../_shared/strategy-orchestrator/staleRunWatchdog.ts";
import { hasValidCronSecret } from "../_shared/cronSecretAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Cron-only endpoint — require shared secret header.
  const isCron = await hasValidCronSecret(req.headers);
  if (!isCron) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (req.method === "HEAD") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const result = await sweepStalePendingRuns({ supabase });
    console.log(JSON.stringify({
      tag: "[reaper:complete]",
      reaped: result.reaped,
      ids: result.ids,
    }));

    return new Response(
      JSON.stringify({ ok: true, reaped: result.reaped, ids: result.ids }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[reaper:error]", e);
    return new Response(
      JSON.stringify({ error: e?.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
