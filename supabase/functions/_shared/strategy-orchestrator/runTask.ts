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
import { callClaude, callOpenAI, callPerplexity, safeParseJSON } from "./providers.ts";
import { getHandler } from "./registry.ts";
import { authorBySectionBatches } from "./sectionAuthor.ts";
import { failStalePendingRun } from "./staleRunWatchdog.ts";
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

  // ── Stage 2: Synthesis — high-quality ChatGPT reasoning, tuned for
  // reliability without collapsing into shallow/minimal thinking.
  await setProgress(supabase, runId, "synthesis");
  const synthesisModel = "gpt-5-mini";
  console.log(JSON.stringify({ tag: "stage-2:start", run_id: runId, model: synthesisModel, reasoning_effort: "medium" }));
  const synthesisRaw = await callOpenAI([
    { role: "system", content: "You are a senior sales strategist. Synthesize research + internal IP into actionable intelligence. Return structured JSON only. No markdown fences, no preamble." },
    { role: "user", content: handler.buildSynthesisPrompt(inputs, research, library) },
  ], { model: synthesisModel, maxTokens: 16000, reasoningEffort: "medium" });
  const synthesis = safeParseJSON<any>(synthesisRaw) ?? { raw: synthesisRaw };
  console.log(JSON.stringify({ tag: "stage-2:end", run_id: runId, model: synthesisModel, synthesis_fields: Object.keys(synthesis).length }));

  // ── Stage 3: Claude document authoring (locked template) ─────
  // Fix 2 — Stall containment:
  //   Inner Claude call:  timeoutMs=75_000, maxAttempts=1   (providers.ts)
  //   Outer stage race:   AUTHORING_TIMEOUT_MS=100_000      (this file)
  // The inner call therefore *cannot* outlive the outer race, and the
  // outer race always wins by ≥25s, leaving budget for the failure write.
  await setProgress(supabase, runId, "document_authoring");
  // Heartbeat write right before the call — proves the worker is alive
  // and resets the reaper window so we know any subsequent stall is
  // inside the model call itself, not earlier.
  await setProgress(supabase, runId, "document_authoring");
  const authoringModel = "claude-sonnet-4-5-20250929";
  const authoringStartedAt = Date.now();
  console.log(JSON.stringify({ tag: "stage-3:start", run_id: runId, stage: "document_authoring", model: authoringModel }));

  // Monolithic authoring is best-effort and intentionally short-budgeted.
  // Claude remains the FIRST authoring pass (policy), but we don't let the
  // giant 19-section one-shot consume the entire stage budget on retries
  // for an oversized payload. If Claude can't land the monolith inside
  // ~60s, we hand off to the per-batch ladder where Claude is *still*
  // first — just on payloads small enough to actually succeed.
  // Outer race must stay below combined budget so section-batched rescue
  // (10 batches × ~70s outer cap, sequential, runs only on monolithic
  // total failure) is reachable inside the worker lifetime.
  const AUTHORING_TIMEOUT_MS = 60_000;
  const AUTHORING_INNER_TIMEOUT_MS = 45_000;
  // Fallback (OpenAI) on the *monolithic* path is also short-budgeted —
  // it is an exception-only safety net here, not the main path. The real
  // safety net for sustained Claude failure is the per-batch ladder below,
  // which is itself Claude-first per batch.
  const MONOLITHIC_FALLBACK_TIMEOUT_MS = 60_000;
  let draftOutput: any;
  let sectionCount = 0;
  // Track the timeout id so we can clear it on success and not leak a
  // dangling timer that keeps the worker alive past the request.
  let authoringTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // Authoring fallback ladder (Gemini removed per model policy).
  // Primary: Claude (formatting/authoring per policy).
  // Fallback (once): OpenAI GPT-5 (ChatGPT — reasoning/synthesis per policy)
  // with the *same* prompt payload + same JSON expectations.
  // Fallback only triggers on transient/availability failures (404/429/5xx,
  // timeout, credits exhausted, unavailable) — NOT on logic/schema bugs
  // (which would also fail on the fallback and just waste the stage budget).
  // NATIVE OpenAI API model id (no "openai/" gateway prefix).
  // Sending "openai/gpt-5" to api.openai.com/v1/chat/completions returns 400.
  const FALLBACK_MODEL = "gpt-5";
  const isFallbackEligible = (err: any): boolean => {
    const msg = String(err?.message || err || "").toLowerCase();
    if (err?.status === 429 || err?.status === 402) return true;
    if (/\b(404|408|409|429|5\d{2})\b/.test(msg)) return true;
    if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("aborted")) return true;
    if (msg.includes("credits exhausted") || msg.includes("rate limited")) return true;
    if (msg.includes("unavailable") || msg.includes("overloaded")) return true;
    return false;
  };

  const authoringMessages = [
    { role: "system", content: handler.buildDocumentSystemPrompt() },
    { role: "user", content: handler.buildDocumentUserPrompt(inputs, synthesis, library) },
  ];

  // Validation-only forced failure hook. Honored ONLY when BOTH:
  //   1. inputs.__validation_force_authoring_failure === true
  //   2. inputs.__validation_origin === "run-validation-canary"
  // The origin marker is set server-side by run-validation-canary and is
  // NEVER set by any UI path. This hardens against accidental leakage of
  // the force-failure flag into normal user runs (e.g. via copy/paste of
  // inputs from a validation run).
  const validationOrigin = (inputs as any)?.__validation_origin;
  const forceAuthoringFailure =
    (inputs as any)?.__validation_force_authoring_failure === true &&
    validationOrigin === "run-validation-canary";
  if ((inputs as any)?.__validation_force_authoring_failure === true && !forceAuthoringFailure) {
    console.warn(JSON.stringify({
      tag: "[authoring:force_failure_ignored]",
      run_id: runId,
      reason: "missing or invalid __validation_origin marker",
    }));
  }

  // Track fallback metadata so we can persist it durably to task_runs.meta
  // for queryability after logs roll off.
  let fallbackMeta: Record<string, unknown> | null = null;

  try {
    let documentRaw: string;
    let primaryErrForLog: string | null = null;
    try {
      if (forceAuthoringFailure) {
        throw new Error("forced primary authoring failure (validation canary)");
      }
      documentRaw = await Promise.race<string>([
        callClaude(authoringMessages, {
          model: authoringModel,
          maxTokens: 12000,
          temperature: 0.3,
          timeoutMs: AUTHORING_INNER_TIMEOUT_MS,
          maxAttempts: 1,
        }),
        new Promise<string>((_, reject) => {
          authoringTimeoutId = setTimeout(
            () => reject(new Error(`Document authoring timed out after ${AUTHORING_TIMEOUT_MS / 1000}s`)),
            AUTHORING_TIMEOUT_MS,
          );
        }),
      ]);
      if (authoringTimeoutId) { clearTimeout(authoringTimeoutId); authoringTimeoutId = null; }
    } catch (claudeErr: any) {
      if (authoringTimeoutId) { clearTimeout(authoringTimeoutId); authoringTimeoutId = null; }
      const claudeMsg = String(claudeErr?.message || claudeErr);
      if (!forceAuthoringFailure && !isFallbackEligible(claudeErr)) {
        // Non-transient (e.g. invalid prompt/schema bug) — propagate as before.
        throw claudeErr;
      }
      primaryErrForLog = claudeMsg;
      console.error(JSON.stringify({
        tag: "[authoring:fallback_triggered]",
        run_id: runId,
        primary_model: authoringModel,
        fallback_model: FALLBACK_MODEL,
        primary_error: claudeMsg.slice(0, 300),
        forced: forceAuthoringFailure,
      }));
      const fallbackStartedAt = Date.now();
      console.log(JSON.stringify({
        tag: "[authoring:fallback_start]",
        run_id: runId,
        fallback_model: FALLBACK_MODEL,
      }));

      let fallbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
      try {
        documentRaw = await Promise.race<string>([
          callOpenAI(authoringMessages, {
            model: FALLBACK_MODEL,
            maxTokens: 12000,
          }),
          new Promise<string>((_, reject) => {
            fallbackTimeoutId = setTimeout(
              () => reject(new Error(`Fallback authoring timed out after ${MONOLITHIC_FALLBACK_TIMEOUT_MS / 1000}s`)),
              MONOLITHIC_FALLBACK_TIMEOUT_MS,
            );
          }),
        ]);
        if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);
        console.log(JSON.stringify({
          tag: "[authoring:fallback_success]",
          run_id: runId,
          fallback_model: FALLBACK_MODEL,
          duration_ms: Date.now() - fallbackStartedAt,
        }));
        fallbackMeta = {
          triggered: true,
          primary_model: authoringModel,
          fallback_model: FALLBACK_MODEL,
          success: true,
          forced: forceAuthoringFailure,
          primary_error: claudeMsg.slice(0, 500),
        };
      } catch (fallbackErr: any) {
        if (fallbackTimeoutId) clearTimeout(fallbackTimeoutId);
        const fbMsg = String(fallbackErr?.message || fallbackErr);
        console.error(JSON.stringify({
          tag: "[authoring:fallback_failed]",
          run_id: runId,
          fallback_model: FALLBACK_MODEL,
          duration_ms: Date.now() - fallbackStartedAt,
          primary_error: (primaryErrForLog || "").slice(0, 200),
          fallback_error: fbMsg.slice(0, 300),
        }));

        // ── Section-batched rescue ────────────────────────────────
        // The monolithic ladder failed. Before giving up, try authoring
        // one small batch at a time (Claude → ChatGPT per batch). This is
        // the reliability layer that keeps deep-work runs from going
        // 100% black on a single timeout. It is *additive*: the existing
        // path runs first; this only fires when both primary and fallback
        // monolithic calls failed. Gemini is intentionally NOT used.
        console.warn(JSON.stringify({
          tag: "[authoring:section_batch_rescue_start]",
          run_id: runId,
          task_type: taskType,
        }));
        const rescue = await authorBySectionBatches({
          runId,
          taskType,
          systemPrompt: handler.buildDocumentSystemPrompt(),
          baseUserPrompt: handler.buildDocumentUserPrompt(inputs, synthesis, library),
          synthesis,
        });

        if (rescue.sections_authored > 0) {
          console.log(JSON.stringify({
            tag: "[authoring:section_batch_rescue_success]",
            run_id: runId,
            sections_authored: rescue.sections_authored,
            sections_total: rescue.draft.sections.length,
            any_fallback_success: rescue.any_fallback_success,
          }));
          documentRaw = JSON.stringify(rescue.draft);
          fallbackMeta = {
            triggered: true,
            primary_model: authoringModel,
            fallback_model: FALLBACK_MODEL,
            success: true,
            forced: forceAuthoringFailure,
            primary_error: claudeMsg.slice(0, 500),
            fallback_error: fbMsg.slice(0, 500),
            section_batch_rescue: {
              used: true,
              sections_authored: rescue.sections_authored,
              sections_total: rescue.draft.sections.length,
              any_fallback_success: rescue.any_fallback_success,
              batches: rescue.batchOutcomes,
            },
          };
        } else {
          fallbackMeta = {
            triggered: true,
            primary_model: authoringModel,
            fallback_model: FALLBACK_MODEL,
            success: false,
            forced: forceAuthoringFailure,
            primary_error: claudeMsg.slice(0, 500),
            fallback_error: fbMsg.slice(0, 500),
            section_batch_rescue: {
              used: true,
              sections_authored: 0,
              sections_total: rescue.draft.sections.length,
              any_fallback_success: false,
              batches: rescue.batchOutcomes,
            },
          };
          // Best-effort persist before throwing
          try {
            await supabase
              .from("task_runs")
              .update({ meta: { authoring_fallback: fallbackMeta } })
              .eq("id", runId);
          } catch { /* swallow */ }
          throw new Error(`primary(claude): ${claudeMsg.slice(0, 120)} | fallback(${FALLBACK_MODEL}): ${fbMsg.slice(0, 150)} | section_batch_rescue: 0/${rescue.draft.sections.length} sections`);
        }
      }
    }

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
    if (authoringTimeoutId) clearTimeout(authoringTimeoutId);
    const durationMs = Date.now() - authoringStartedAt;
    const message = e?.message || String(e);
    const prefixed = message.startsWith("[document_authoring]")
      ? message
      : `[document_authoring] ${message}`;
    console.error(JSON.stringify({
      tag: "stage-3:end",
      run_id: runId,
      duration_ms: durationMs,
      success: false,
      error: message,
    }));

    // Fix 2 — guaranteed terminal failure write.
    // The previous version awaited the update inside a try/catch, but if the
    // worker was being torn down (EdgeRuntime promise resolution race), the
    // network round-trip could be cancelled mid-flight, leaving the row in
    // `pending` + `progress_step='document_authoring'` indefinitely.
    // We now (a) bind the failure write to EdgeRuntime.waitUntil so the
    // platform keeps the worker alive until the write lands, and (b) still
    // await it so the surrounding `throw` cannot race the DB call.
    const failureWrite = supabase
      .from("task_runs")
      .update({
        status: "failed",
        progress_step: "failed",
        error: prefixed.slice(0, 1000),
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // @ts-ignore — EdgeRuntime is provided by the platform.
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(failureWrite);
    }
    try {
      await failureWrite;
    } catch (writeErr) {
      console.error(`[stage-3] failed to mark run failed:`, (writeErr as Error).message);
    }
    // Re-throw with the prefix so the outer catch in runStrategyTask /
    // runStrategyTaskInBackground doesn't overwrite our DB error message
    // with the bare provider text.
    const wrapped = new Error(prefixed);
    (wrapped as any).cause = e;
    throw wrapped;
  }

  // ── Stage 4: Review (Lovable AI, playbook-grounded) ──────────
  let reviewOutput: any = { strengths: [], redlines: [], library_coverage: { used: [], gaps: [] } };
  if (sectionCount > 0) {
    await setProgress(supabase, runId, "review");
    console.log("[stage-4] generating playbook-grounded review...");
    try {
      const reviewRaw = await callOpenAI([
        { role: "system", content: "You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in the provided internal playbooks/KIs." },
        { role: "user", content: handler.buildReviewPrompt(inputs, draftOutput, library) },
      ], { model: "gpt-5-mini", temperature: 0.4, maxTokens: 4000 });
      const parsed = safeParseJSON<any>(reviewRaw);
      if (parsed) reviewOutput = { ...reviewOutput, ...parsed };
    } catch (e: any) {
      console.error("[stage-4] review failed:", e?.message || e);
      // Don't fail the whole run for review issues; surface in row.
    }
  }

  // ── Stage 5: Finalize the run row ────────────────────────────
  const finalizePatch: Record<string, unknown> = {
    draft_output: draftOutput,
    review_output: reviewOutput,
    status: "completed",
    progress_step: "completed",
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  if (fallbackMeta) {
    finalizePatch.meta = { authoring_fallback: fallbackMeta };
  }
  const { error: updateErr } = await supabase
    .from("task_runs")
    .update(finalizePatch)
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
    meta: {} as OrchestrationResult["meta"],
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
        const { data: latest } = await ctx.supabase
          .from("task_runs")
          .select("id, status, progress_step, error, updated_at")
          .eq("id", runId)
          .maybeSingle();

        if (latest?.status === "pending") {
          const staleRow = await failStalePendingRun({
            supabase: ctx.supabase,
            row: latest,
            runId,
            userId: ctx.userId,
          });
          if (staleRow?.status === "failed") return;
        }

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
