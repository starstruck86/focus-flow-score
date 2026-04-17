// ════════════════════════════════════════════════════════════════
// run-discovery-prep — async/background entry point.
//
// Body shapes:
//   { action: "generate", inputs: {...} }           → starts a job, returns { run_id, status: "pending" }
//   { action: "status", run_id }                    → returns current row (status / progress / draft / review)
//   { action: "apply_redline", run_id, section_id, proposed_text }
//
// Heavy pipeline runs via EdgeRuntime.waitUntil so the HTTP response
// returns instantly and we never hit the synchronous wall clock.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyRedline, runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";

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
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const action = body.action || "generate";

    // ── Status poll ────────────────────────────────────────────
    if (action === "status") {
      const runId = body.run_id;
      if (!runId) return jsonResponse({ error: "run_id is required" }, 400);

      const { data: row, error } = await supabase
        .from("task_runs")
        .select("id, status, progress_step, error, draft_output, review_output, completed_at, updated_at")
        .eq("id", runId)
        .eq("user_id", user.id)
        .single();
      if (error || !row) return jsonResponse({ error: "Run not found" }, 404);

      return jsonResponse({
        run_id: row.id,
        status: row.status,
        progress_step: row.progress_step,
        error: row.error,
        completed_at: row.completed_at,
        updated_at: row.updated_at,
        draft: row.draft_output,
        review: row.review_output,
      });
    }

    // ── Apply redline (existing behavior) ─────────────────────
    if (action === "apply_redline") {
      const { run_id, section_id, proposed_text } = body;
      if (!run_id || !section_id || proposed_text === undefined) {
        return jsonResponse({ error: "run_id, section_id, proposed_text required" }, 400);
      }
      const result = await applyRedline(supabase, user.id, run_id, section_id, proposed_text);
      return jsonResponse({ success: true, ...result });
    }

    // ── Start async generation ────────────────────────────────
    const { inputs } = body;
    if (!inputs?.company_name) return jsonResponse({ error: "inputs.company_name is required" }, 400);

    const { run_id, status } = await runStrategyTaskInBackground({
      userId: user.id,
      supabase,
      inputs,
      taskType: "discovery_prep",
    });

    return jsonResponse({ run_id, status });
  } catch (e: any) {
    console.error("[run-discovery-prep] error:", e);
    const status = e?.status || 500;
    return jsonResponse({ error: e?.message || "Internal error" }, status);
  }
});
