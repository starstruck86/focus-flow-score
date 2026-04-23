// ════════════════════════════════════════════════════════════════
// run-strategy-task — shared async Strategy task entry point.
//
// Body shapes:
//   { action: "generate", task_type: "discovery_prep", inputs: {...} }   → returns { run_id, status: "pending" }
//   { action: "status",   run_id }                                       → returns current row
//   { action: "apply_redline", run_id, section_id, proposed_text }
//
// All Strategy tasks share this function. Heavy pipeline runs via
// EdgeRuntime.waitUntil so we never block the request lifecycle.
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyRedline, runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";
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
      const effectiveRow = row.status === "pending"
        ? await failStalePendingRun({ supabase, row, runId, userId: user.id })
        : row;
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

    if (action === "apply_redline") {
      const { run_id, section_id, proposed_text } = body;
      if (!run_id || !section_id || proposed_text === undefined) {
        return jsonResponse({ error: "run_id, section_id, proposed_text required" }, 400);
      }
      const result = await applyRedline(supabase, user.id, run_id, section_id, proposed_text);
      return jsonResponse({ success: true, ...result });
    }

    // generate
    const taskType = body.task_type || "discovery_prep";
    const { inputs } = body;
    if (!inputs?.company_name) return jsonResponse({ error: "inputs.company_name is required" }, 400);

    try {
      const { run_id, status } = await runStrategyTaskInBackground({
        userId: user.id, supabase, inputs, taskType,
      });
      return jsonResponse({ run_id, status });
    } catch (e: any) {
      // Fix 1 — idempotency: partial unique index `task_runs_one_active_per_thread_task`
      // blocks a second active row for the same (thread_id, task_type). When that
      // happens, return the existing active run instead of erroring so concurrent
      // callers converge on the same run_id.
      const code = e?.code || e?.cause?.code;
      const threadId = inputs?.thread_id || null;
      if (code === "23505" && threadId) {
        const { data: existing, error: lookupErr } = await supabase
          .from("task_runs")
          .select("id, status, task_type")
          .eq("user_id", user.id)
          .eq("thread_id", threadId)
          .eq("task_type", taskType)
          .in("status", ["pending", "running"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!lookupErr && existing) {
          console.log(JSON.stringify({
            tag: "run-strategy-task:idempotent_hit",
            thread_id: threadId,
            task_type: taskType,
            run_id: existing.id,
            status: existing.status,
          }));
          return jsonResponse({
            run_id: existing.id,
            status: existing.status,
            task_type: existing.task_type,
            idempotent: true,
          });
        }
      }
      throw e;
    }
  } catch (e: any) {
    console.error("[run-strategy-task] error:", e);
    const status = e?.status || 500;
    return jsonResponse({ error: e?.message || "Internal error" }, status);
  }
});
