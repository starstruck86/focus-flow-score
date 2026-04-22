// ════════════════════════════════════════════════════════════════
// run-strategy-job — generic async invoker for non-Discovery-Prep
// TaskHandlers (account_brief, ninety_day_plan).
//
// Mirrors run-discovery-prep but routes by body.task_type and
// pre-fetches Library Cards into inputs.__cards / __cardsContext
// before kicking off the shared 5-stage pipeline (runTask.ts).
//
// runTask.ts is NOT modified — handlers consume cards from inputs.
//
// Body shapes:
//   { action: "generate", task_type, inputs }   → { run_id, status: "pending" }
//   { action: "status",   run_id }              → { run_id, status, progress_step, draft, review, ... }
//   { action: "apply_redline", run_id, section_id, proposed_text }
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyRedline, runStrategyTaskInBackground } from "../_shared/strategy-orchestrator/runTask.ts";
import { getHandler } from "../_shared/strategy-orchestrator/registry.ts";
import { getCards } from "../_shared/strategy-orchestrator/libraryCards.ts";
import type { TaskType } from "../_shared/strategy-orchestrator/types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version, x-trace-id, x-router-bypass",
};

const SUPPORTED_TASK_TYPES: ReadonlyArray<TaskType> = ["account_brief", "ninety_day_plan"];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isSupportedTaskType(v: unknown): v is TaskType {
  return typeof v === "string" && (SUPPORTED_TASK_TYPES as readonly string[]).includes(v);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const action = (body as any).action || "generate";

    // ── Status poll ────────────────────────────────────────────
    if (action === "status") {
      const runId = (body as any).run_id;
      if (!runId || typeof runId !== "string") {
        return jsonResponse({ error: "run_id is required" }, 400);
      }

      const { data: row, error } = await supabase
        .from("task_runs")
        .select("id, status, progress_step, error, draft_output, review_output, completed_at, updated_at, task_type")
        .eq("id", runId)
        .eq("user_id", user.id)
        .single();
      if (error || !row) return jsonResponse({ error: "Run not found" }, 404);

      // Stale-run reaper (parity with run-discovery-prep).
      let effectiveRow: any = row;
      if (row.status === "pending") {
        const lastUpdate = new Date(row.updated_at).getTime();
        const ageMs = Date.now() - lastUpdate;
        if (ageMs > 7 * 60 * 1000) {
          const reaperMessage = `Run stalled at "${row.progress_step || "unknown"}" (no progress for ${Math.round(ageMs / 1000)}s). Please retry.`;
          await supabase
            .from("task_runs")
            .update({
              status: "failed",
              progress_step: "failed",
              error: reaperMessage,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", runId)
            .eq("user_id", user.id);
          effectiveRow = { ...row, status: "failed", progress_step: "failed", error: reaperMessage };
        }
      }

      return jsonResponse({
        run_id: effectiveRow.id,
        task_type: effectiveRow.task_type,
        status: effectiveRow.status,
        progress_step: effectiveRow.progress_step,
        error: effectiveRow.error,
        completed_at: effectiveRow.completed_at,
        updated_at: effectiveRow.updated_at,
        draft: effectiveRow.draft_output,
        review: effectiveRow.review_output,
      });
    }

    // ── Apply redline ──────────────────────────────────────────
    if (action === "apply_redline") {
      const { run_id, section_id, proposed_text } = body as Record<string, any>;
      if (!run_id || !section_id || proposed_text === undefined) {
        return jsonResponse({ error: "run_id, section_id, proposed_text required" }, 400);
      }
      const result = await applyRedline(supabase, user.id, run_id, section_id, proposed_text);
      return jsonResponse({ success: true, ...result });
    }

    // ── Start async generation ────────────────────────────────
    const taskType = (body as any).task_type;
    if (!isSupportedTaskType(taskType)) {
      return jsonResponse(
        { error: `Unsupported task_type. Allowed: ${SUPPORTED_TASK_TYPES.join(", ")}` },
        400,
      );
    }

    const rawInputs = (body as any).inputs;
    if (!rawInputs || typeof rawInputs !== "object" || Array.isArray(rawInputs)) {
      return jsonResponse({ error: "inputs object is required" }, 400);
    }

    // Resolve handler + library scopes (best-effort card pre-fetch).
    let handler;
    try {
      handler = getHandler(taskType);
    } catch (e: any) {
      return jsonResponse({ error: e?.message || "Unknown task_type" }, 400);
    }

    const scopes = (handler.libraryScopes(rawInputs) || []).filter(
      (s: unknown): s is string => typeof s === "string" && s.trim().length > 0,
    );
    const roleWeights = (handler as any).roleWeights || {};

    // Card retrieval is non-blocking on data: handlers tolerate empty cards.
    let cardsBundle = { cards: [] as any[], contextString: "", counts: { standard: 0, tactic: 0, pattern: 0, exemplar: 0 } };
    try {
      cardsBundle = await getCards(supabase, user.id, scopes, roleWeights, { maxCards: 8, maxTokensApprox: 2500 });
    } catch (e) {
      console.warn(`[run-strategy-job] getCards threw — proceeding with zero cards:`, (e as Error).message);
    }

    const enrichedInputs: Record<string, unknown> = {
      ...rawInputs,
      __cards: cardsBundle.cards,
      __cardsContext: cardsBundle.contextString,
    };

    console.log(
      `[run-strategy-job] start task=${taskType} user=${user.id.slice(0, 8)} scopes=${scopes.length} cards=${cardsBundle.cards.length}`,
    );

    const { run_id, status } = await runStrategyTaskInBackground({
      userId: user.id,
      supabase,
      inputs: enrichedInputs as any,
      taskType,
    });

    return jsonResponse({
      run_id,
      status,
      task_type: taskType,
      meta: {
        library_cards: cardsBundle.cards.length,
        library_card_ids: cardsBundle.cards.map((c: any) => c.id),
        library_card_role_counts: cardsBundle.counts,
      },
    });
  } catch (e: any) {
    console.error("[run-strategy-job] error:", e);
    const status = e?.status || 500;
    return jsonResponse({ error: e?.message || "Internal error" }, status);
  }
});
