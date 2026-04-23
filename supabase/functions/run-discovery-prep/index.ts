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
import { findRecentActiveRun } from "../_shared/strategy-orchestrator/idempotency.ts";
import { failStalePendingRun } from "../_shared/strategy-orchestrator/staleRunWatchdog.ts";

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

      let effectiveRow = row as any;
      if (row.status === "pending") {
        effectiveRow = await failStalePendingRun({ supabase, row, runId, userId: user.id });
      }

      return jsonResponse({
        run_id: effectiveRow.id,
        status: effectiveRow.status,
        progress_step: effectiveRow.progress_step,
        error: effectiveRow.error,
        completed_at: effectiveRow.completed_at,
        updated_at: effectiveRow.updated_at,
        draft: effectiveRow.draft_output,
        review: effectiveRow.review_output,
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

    // Pre-insert idempotency: converge near-simultaneous identical generates
    // to the same run_id. Covers both threaded and thread-less callers.
    try {
      const existing = await findRecentActiveRun({
        supabase, userId: user.id, taskType: "discovery_prep", inputs,
      });
      if (existing) {
        console.log(JSON.stringify({
          tag: "run-discovery-prep:idempotent_preinsert_hit",
          run_id: existing.id,
          status: existing.status,
          had_thread_id: !!inputs?.thread_id,
        }));
        return jsonResponse({
          run_id: existing.id,
          status: existing.status,
          task_type: "discovery_prep",
          idempotent: true,
        });
      }
    } catch (preErr) {
      console.warn("[run-discovery-prep:preinsert_dedupe_error]", String(preErr).slice(0, 200));
    }

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
