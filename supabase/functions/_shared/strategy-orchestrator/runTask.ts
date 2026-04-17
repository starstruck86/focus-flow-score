// ════════════════════════════════════════════════════════════════
// runTask — shared Strategy task orchestration pipeline.
//
// Stage 0: Library retrieval (KIs + playbooks)         [shared]
// Stage 1: Perplexity research                         [shared]
// Stage 2: OpenAI synthesis (uses library)             [shared]
// Stage 3: Claude document author (locked template)    [shared]
// Stage 4: Lovable AI review (playbook-grounded)       [shared]
// Stage 5: Persist run                                 [shared]
//
// All task-specific behavior lives in the TaskHandler. The pipeline
// itself is generic so future tasks (recap email, follow-up, etc.)
// reuse the same orchestration without forking it.
//
// ──────────────────────────────────────────────────────────────────
// ASYNC EXECUTION
// ──────────────────────────────────────────────────────────────────
// `runStrategyTaskInBackground` inserts a `pending` row immediately,
// returns its id, then runs all 5 stages off the request lifecycle
// via EdgeRuntime.waitUntil. Status/error/completed_at are written
// back to the row at every stage transition so the client can poll.
// ════════════════════════════════════════════════════════════════

import { retrieveLibraryContext } from "./libraryRetrieval.ts";
import { callClaude, callLovableAI, callPerplexity, safeParseJSON } from "./providers.ts";
import { getHandler } from "./registry.ts";
import type { OrchestrationContext, OrchestrationResult, ResearchBundle } from "./types.ts";

// ── Internal: write a progress step to the run row (best-effort). ─
async function setProgress(supabase: any, runId: string, step: string) {
  try {
    await supabase
      .from("task_runs")
      .update({ progress_step: step, updated_at: new Date().toISOString() })
      .eq("id", runId);
  } catch (e) {
    console.warn(`[orchestrator] progress update failed (${step}):`, (e as Error).message);
  }
}

// ── Core pipeline — bound to an existing pending run row. ─────────
async function executePipeline(ctx: OrchestrationContext, runId: string): Promise<void> {
  const { supabase, userId, inputs, taskType } = ctx;
  const handler = getHandler(taskType);
  console.log(`[orchestrator] task=${taskType} run=${runId} company=${inputs.company_name || "(none)"} user=${userId.slice(0, 8)}`);

  // ── Stage 0: Library retrieval ────────────────────────────────
  await setProgress(supabase, runId, "library_retrieval");
  const library = await retrieveLibraryContext(supabase, userId, inputs, {
    scopes: handler.libraryScopes(inputs),
    maxKIs: 12,
    maxPlaybooks: 6,
  });

  // ── Stage 1: External research (Perplexity, parallel) ────────
  const queries = handler.buildResearchQueries(inputs);
  const research: ResearchBundle = { results: {}, totalChars: 0 };

  if (queries.length) {
    await setProgress(supabase, runId, "research");
    console.log(`[stage-1] ${queries.length} parallel research queries...`);
    const settled = await Promise.allSettled(
      queries.map(async (q) => {
        try {
          const result = await callPerplexity([
            { role: "system", content: "You are a sales research analyst. Provide specific, sourced facts. Include dates and numbers when available. If information is not found, say so explicitly." },
            { role: "user", content: q.prompt },
          ]);
          return { key: q.key, result };
        } catch (e) {
          console.error(`[stage-1] ${q.key} failed:`, (e as Error).message);
          return { key: q.key, result: { text: "", citations: [] } };
        }
      }),
    );
    for (const s of settled) {
      if (s.status === "fulfilled") research.results[s.value.key] = s.value.result;
    }
    research.totalChars = Object.values(research.results).reduce((sum, r) => sum + r.text.length, 0);
    console.log(`[stage-1] research complete: ${research.totalChars} chars`);
  }

  // ── Stage 2: Synthesis — STRONG model (openai/gpt-5 via Lovable AI Gateway).
  // We run this in the background, so wall-clock is no longer a constraint.
  await setProgress(supabase, runId, "synthesis");
  console.log(`[stage-2] synthesis via Lovable AI (openai/gpt-5)...`);
  const synthesisRaw = await callLovableAI([
    { role: "system", content: "You are a senior sales strategist. Synthesize research + internal IP into actionable intelligence. Return structured JSON only. No markdown fences, no preamble." },
    { role: "user", content: handler.buildSynthesisPrompt(inputs, research, library) },
  ], { model: "openai/gpt-5", maxTokens: 12000 });
  const synthesis = safeParseJSON<any>(synthesisRaw) ?? { raw: synthesisRaw };
  console.log(`[stage-2] synthesis fields: ${Object.keys(synthesis).length}`);

  // ── Stage 3: Claude document authoring (locked template) ─────
  // Hard fail-fast contract: 90s wall-clock cap on this stage. If the
  // model call hangs (provider socket stuck, retry loop wedged, etc.)
  // we surface a clear error instead of letting the background promise
  // die silently and stranding the row in `pending`.
  await setProgress(supabase, runId, "document_authoring");
  // Heartbeat write right before the call — proves the worker is alive
  // and resets the reaper window so we know any subsequent stall is
  // inside the model call itself, not earlier.
  await setProgress(supabase, runId, "document_authoring");
  const authoringModel = "claude-sonnet-4-5-20250929";
  const authoringStartedAt = Date.now();
  console.log(JSON.stringify({ tag: "stage-3:start", run_id: runId, stage: "document_authoring", model: authoringModel }));

  const AUTHORING_TIMEOUT_MS = 90_000;
  let draftOutput: any;
  let sectionCount = 0;
  // Track the timeout id so we can clear it on success and not leak a 90s
  // dangling timer that keeps the worker alive past the request.
  let authoringTimeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const documentRaw = await Promise.race<string>([
      callClaude([
        { role: "system", content: handler.buildDocumentSystemPrompt() },
        { role: "user", content: handler.buildDocumentUserPrompt(inputs, synthesis, library) },
      ], { model: authoringModel, maxTokens: 12000, temperature: 0.3 }),
      new Promise<string>((_, reject) => {
        authoringTimeoutId = setTimeout(
          () => reject(new Error(`Document authoring timed out after ${AUTHORING_TIMEOUT_MS / 1000}s`)),
          AUTHORING_TIMEOUT_MS,
        );
      }),
    ]);
    if (authoringTimeoutId) clearTimeout(authoringTimeoutId);

    // safeParseJSON returns `null` for unparseable input — treat that as a
    // hard failure rather than silently shipping an empty `sections: []`
    // shell, which previously let runs complete "successfully" with no
    // content.
    const parsed = safeParseJSON<any>(documentRaw);
    if (parsed === null || parsed === undefined) {
      throw new Error("Document authoring returned invalid JSON (unparseable model output)");
    }
    if (typeof parsed !== "object" || !Array.isArray(parsed.sections)) {
      throw new Error("Document authoring returned invalid JSON (missing sections array)");
    }
    draftOutput = parsed;
    sectionCount = draftOutput.sections.length;

    console.log(JSON.stringify({
      tag: "stage-3:end",
      run_id: runId,
      duration_ms: Date.now() - authoringStartedAt,
      success: true,
      sections: sectionCount,
    }));
  } catch (e: any) {
    const durationMs = Date.now() - authoringStartedAt;
    const message = e?.message || String(e);
    console.error(JSON.stringify({
      tag: "stage-3:end",
      run_id: runId,
      duration_ms: durationMs,
      success: false,
      error: message,
    }));
    // Mark the row failed immediately so the UI exits the loading state
    // without waiting for the 7-min reaper.
    try {
      await supabase
        .from("task_runs")
        .update({
          status: "failed",
          progress_step: "failed",
          error: `[document_authoring] ${message}`.slice(0, 1000),
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
    } catch (writeErr) {
      console.error(`[stage-3] failed to mark run failed:`, (writeErr as Error).message);
    }
    throw e;
  }

  // ── Stage 4: Review (Lovable AI, playbook-grounded) ──────────
  let reviewOutput: any = { strengths: [], redlines: [], library_coverage: { used: [], gaps: [] } };
  if (sectionCount > 0) {
    await setProgress(supabase, runId, "review");
    console.log("[stage-4] generating playbook-grounded review...");
    try {
      const reviewRaw = await callLovableAI([
        { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in the provided internal playbooks/KIs." },
        { role: "user", content: handler.buildReviewPrompt(inputs, draftOutput, library) },
      ], { model: "google/gemini-2.5-flash", temperature: 0.4, maxTokens: 4000 });
      const parsed = safeParseJSON<any>(reviewRaw);
      if (parsed) reviewOutput = { ...reviewOutput, ...parsed };
    } catch (e: any) {
      console.error("[stage-4] review failed:", e?.message || e);
      // Don't fail the whole run for review issues; surface in row.
    }
  }

  // ── Stage 5: Finalize the run row ────────────────────────────
  const { error: updateErr } = await supabase
    .from("task_runs")
    .update({
      draft_output: draftOutput,
      review_output: reviewOutput,
      status: "completed",
      progress_step: "completed",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (updateErr) {
    console.error("[orchestrator] finalize update error:", updateErr);
    throw updateErr;
  }

  const meta = {
    research_chars: research.totalChars,
    library_kis: library.counts.kis,
    library_playbooks: library.counts.playbooks,
    sections: sectionCount,
    redlines: reviewOutput.redlines?.length || 0,
  };
  console.log(`[orchestrator] complete run=${runId} ${JSON.stringify(meta)}`);
}

/**
 * Synchronous entry point (kept for back-compat / smoke tests).
 * For end-user requests, prefer `runStrategyTaskInBackground`.
 */
export async function runStrategyTask(ctx: OrchestrationContext): Promise<OrchestrationResult> {
  // Insert pending row first so the same finalize path is used.
  const { data: row, error: insertErr } = await ctx.supabase
    .from("task_runs")
    .insert({
      user_id: ctx.userId,
      task_type: ctx.taskType,
      inputs: ctx.inputs,
      status: "pending",
      progress_step: "queued",
      thread_id: ctx.inputs.thread_id || null,
      account_id: ctx.inputs.account_id || null,
      opportunity_id: ctx.inputs.opportunity_id || null,
    })
    .select("id")
    .single();
  if (insertErr || !row) throw insertErr || new Error("Failed to create task_runs row");

  try {
    await executePipeline(ctx, row.id);
  } catch (e: any) {
    await ctx.supabase
      .from("task_runs")
      .update({
        status: "failed",
        error: (e?.message || String(e)).slice(0, 1000),
        progress_step: "failed",
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    throw e;
  }

  // Return final state from DB (consistent shape with async path).
  const { data: finalRow } = await ctx.supabase
    .from("task_runs").select("draft_output, review_output").eq("id", row.id).single();
  return {
    run_id: row.id,
    draft: finalRow?.draft_output ?? { sections: [] },
    review: finalRow?.review_output ?? { strengths: [], redlines: [] },
    meta: {},
  };
}

/**
 * Async entry point: insert a pending row, kick off the pipeline on
 * the edge runtime's background lifecycle, return the run_id immediately.
 *
 * Caller should poll `task_runs` (status / progress_step) until
 * status ∈ {completed, failed}.
 */
export async function runStrategyTaskInBackground(
  ctx: OrchestrationContext,
): Promise<{ run_id: string; status: "pending" }> {
  const { data: row, error: insertErr } = await ctx.supabase
    .from("task_runs")
    .insert({
      user_id: ctx.userId,
      task_type: ctx.taskType,
      inputs: ctx.inputs,
      status: "pending",
      progress_step: "queued",
      thread_id: ctx.inputs.thread_id || null,
      account_id: ctx.inputs.account_id || null,
      opportunity_id: ctx.inputs.opportunity_id || null,
    })
    .select("id")
    .single();
  if (insertErr || !row) throw insertErr || new Error("Failed to create task_runs row");

  const runId: string = row.id;

  // Detach from the request lifecycle so the HTTP response can return
  // immediately while the heavy pipeline keeps running.
  const work = (async () => {
    try {
      await executePipeline(ctx, runId);
    } catch (e: any) {
      console.error(`[orchestrator] background run=${runId} failed:`, e?.message || e);
      try {
        await ctx.supabase
          .from("task_runs")
          .update({
            status: "failed",
            error: (e?.message || String(e)).slice(0, 1000),
            progress_step: "failed",
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("id", runId);
      } catch (writeErr) {
        console.error(`[orchestrator] failed to mark run=${runId} as failed:`, (writeErr as Error).message);
      }
    }
  })();

  // Supabase edge runtime exposes EdgeRuntime.waitUntil in production.
  // Fall back to a fire-and-forget promise locally.
  // @ts-ignore — EdgeRuntime is provided by the platform.
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    // @ts-ignore
    EdgeRuntime.waitUntil(work);
  } else {
    work.catch(() => { /* already logged */ });
  }

  return { run_id: runId, status: "pending" };
}

/** Apply a single section-level redline to an existing run. Shared across tasks. */
export async function applyRedline(
  supabase: any,
  userId: string,
  runId: string,
  sectionId: string,
  proposedText: any,
): Promise<{ draft_output: any; review_output: any }> {
  const { data: run, error: fetchErr } = await supabase
    .from("task_runs").select("*").eq("id", runId).eq("user_id", userId).single();
  if (fetchErr || !run) throw new Error("Run not found");

  const draft = run.draft_output as any;
  if (draft?.sections) {
    const idx = draft.sections.findIndex((s: any) => s.id === sectionId);
    if (idx >= 0) draft.sections[idx].content = proposedText;
  }

  const review = run.review_output as any;
  if (review?.redlines) {
    review.redlines = review.redlines.map((r: any) =>
      r.section_id === sectionId ? { ...r, status: "accepted" } : r,
    );
  }

  const { error: updateErr } = await supabase
    .from("task_runs")
    .update({ draft_output: draft, review_output: review, updated_at: new Date().toISOString() })
    .eq("id", runId);
  if (updateErr) throw updateErr;

  return { draft_output: draft, review_output: review };
}
