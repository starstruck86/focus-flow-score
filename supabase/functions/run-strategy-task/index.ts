// ════════════════════════════════════════════════════════════════
// run-strategy-task — shared Strategy task orchestration entry point.
//
// Single backend for ALL Strategy tasks. Discovery Prep is the first
// consumer; future tasks (recap email, follow-up, etc.) plug in via
// the TaskHandler registry — no parallel functions.
//
// Body shapes:
//   { action: "generate", task_type: "discovery_prep", inputs: {...} }
//   { action: "apply_redline", run_id, section_id, proposed_text }
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyRedline, runStrategyTask } from "../_shared/strategy-orchestrator/runTask.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader! } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const action = body.action || "generate";

    if (action === "apply_redline") {
      const { run_id, section_id, proposed_text } = body;
      if (!run_id || !section_id || proposed_text === undefined) {
        return new Response(JSON.stringify({ error: "run_id, section_id, proposed_text required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const result = await applyRedline(supabase, user.id, run_id, section_id, proposed_text);
      return new Response(JSON.stringify({ success: true, ...result }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // generate
    const taskType = body.task_type || "discovery_prep";
    const { inputs } = body;
    if (!inputs?.company_name) {
      return new Response(JSON.stringify({ error: "inputs.company_name is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await runStrategyTask({ userId: user.id, supabase, inputs, taskType });
    return new Response(JSON.stringify(result), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("[run-strategy-task] error:", e);
    const status = e?.status || 500;
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), {
      status, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
