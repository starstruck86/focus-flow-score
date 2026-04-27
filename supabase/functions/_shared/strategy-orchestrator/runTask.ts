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
import {
  ensureSectionRows,
  invokeNextStep,
  persistSynthesisArtifact,
  TOTAL_BATCHES,
} from "./progressiveDriver.ts";
import { failStalePendingRun } from "./staleRunWatchdog.ts";
import {
  validateDraftAgainstSop,
  validateSopInputs,
  type SopContractLike,
} from "./sopValidator.ts";
import {
  buildRetrievalDecisionLog,
  decideLibraryQuery,
  decideWebQuery,
  evaluateLibraryCoverage,
  logRetrievalDecision,
  resolveServerWorkspaceContract,
} from "../strategy-core/retrievalEnforcement.ts";
import {
  buildPromptCompositionLog,
  buildWorkspaceOverlay,
  logPromptComposition,
} from "../strategy-core/workspacePrompt.ts";
import {
  buildCalibrationPersistenceBlock,
  buildCitationCheckLog,
  buildEscalationPersistenceBlock,
  buildGatePersistenceBlock,
  buildStandardContextPersistenceBlock,
  type CalibrationPersistenceBlock,
  type CitationAuditHit,
  type EscalationPersistenceBlock,
  evaluateEscalationRules,
  type ExemplarSet,
  type GatePersistenceBlock,
  inferTopicScopes,
  logCalibrationResult,
  logCitationCheck,
  logEscalationSuggestions,
  logGateResults,
  logStandardContext,
  renderStandardBlock,
  runCitationCheck,
  runLibraryCalibration,
  runWorkspaceGates,
  selectExemplars,
  type StandardContextPersistenceBlock,
  computeSchemaHealth,
  buildEnforcementPersistenceBlock,
  logEnforcementDryRun,
  runEnforcementDryRun,
  type EnforcementPersistenceBlock,
} from "../strategy-core/index.ts";
import { resolveTaskWorkspace } from "./taskWorkspace.ts";
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

  // ── Phase 3A SOP "SAFE BRIDGE" — observe only, never block. ────
  // The client may attach a structured SOP contract via inputs.__sop.
  // We pull it off the wire here so it never reaches downstream
  // prompt builders (those signatures stay byte-identical).
  const sop: SopContractLike | null =
    (inputs as any)?.__sop && typeof (inputs as any).__sop === "object"
      ? ((inputs as any).__sop as SopContractLike)
      : null;
  console.log(JSON.stringify({
    tag: "[strategy-sop]",
    run_id: runId,
    task_type: taskType,
    sop_enabled: !!sop,
    rules: sop ? Object.keys(sop) : [],
  }));
  let sopInputCheck: ReturnType<typeof validateSopInputs> | null = null;
  try {
    sopInputCheck = validateSopInputs(inputs as Record<string, unknown>, sop);
    console.log(JSON.stringify({
      tag: "[sop-input-check]",
      run_id: runId,
      task_type: taskType,
      ...sopInputCheck,
    }));
  } catch (sopErr) {
    console.warn("[sop-input-check] threw (ignored, shadow mode):", String(sopErr).slice(0, 200));
  }

  // ── Stage 0: Library retrieval ────────────────────────────────
  // W3 — resolve the workspace contract for this task so the universal
  // library retrieval policy is consistent with the chat surface.
  // The mapping is task_type → WorkspaceKey via the W3 normalizer.
  // Library scopes still drive the actual query; the contract decides
  // whether we *should* query and how to interpret coverage.
  const taskWorkspace = resolveTaskWorkspace(taskType);
  const resolvedContract = resolveServerWorkspaceContract(taskWorkspace.workspace);
  const derivedScopes = handler.libraryScopes(inputs);
  const userContent = [
    inputs.company_name,
    inputs.opportunity,
    inputs.prior_notes,
    inputs.desired_next_step,
  ].filter((v): v is string => typeof v === "string" && v.length > 0).join(" ");

  const libraryDecision = decideLibraryQuery(resolvedContract.retrievalRules, {
    userContent,
    derivedScopes,
    // Task pipelines have always run library retrieval when scopes
    // exist; mirror that as the legacy heuristic so `relevant` does
    // not silently shrink retrieval when this fallback path is used.
    legacyWouldQuery: derivedScopes.length > 0,
    userExplicitlyRequestedLibrary: false,
  });

  await setProgress(supabase, runId, "library_retrieval");
  const library = libraryDecision.shouldQuery
    ? await retrieveLibraryContext(supabase, userId, inputs, {
        scopes: derivedScopes,
        maxKIs: 12,
        maxPlaybooks: 6,
      })
    : { knowledgeItems: [], playbooks: [], contextString: "", counts: { kis: 0, playbooks: 0 } };

  const libraryHitCount = (library.counts?.kis ?? 0) + (library.counts?.playbooks ?? 0);
  const libraryCoverageState = evaluateLibraryCoverage({
    rules: resolvedContract.retrievalRules,
    libraryQueried: libraryDecision.shouldQuery,
    libraryHitCount,
  });

  // Web retrieval is not wired into the task pipeline yet — log the
  // decision honestly so telemetry shows it as deferred, never faked.
  const webDecision = decideWebQuery(resolvedContract.retrievalRules, {
    webCapabilityAvailable: false,
    legacyWouldQuery: false,
  });

  logRetrievalDecision({
    ...buildRetrievalDecisionLog({
      resolved: resolvedContract,
      libraryDecision,
      libraryHitCount,
      libraryCoverageState,
      webDecision,
      webHitCount: 0,
      surface: "run-task",
    }),
    // Extra task-context fields (additive, ignored by typed consumers).
    ...(({
      task_type: taskType,
      run_id: runId,
      task_fell_back: taskWorkspace.taskFellBack,
    }) as Record<string, unknown>),
  } as any);

  // ── W4: Workspace overlay (taskTemplateLocked: true always) ──────
  // Compose the structured workspace overlay once and prepend it to
  // every task system prompt below. `taskTemplateLocked: true` forces
  // the explicit "TASK TEMPLATE TAKES PRECEDENCE" guard so the overlay
  // can NEVER reshape locked task schemas (Discovery Prep, Account
  // Brief, 90-Day Plan). Section names, ordering, and JSON shapes
  // remain owned by the task template.
  const workspaceOverlay = buildWorkspaceOverlay({
    contract: resolvedContract.contract,
    taskTemplateLocked: true,
    // Escalation hints are a chat-time concept; suppress for runTask
    // to keep the overlay tight inside the task pipeline.
    includeEscalationRules: false,
    surface: "run-task",
  });
  let overlayPrefix = workspaceOverlay.text
    ? `${workspaceOverlay.text}\n\n`
    : "";

  // Telemetry — single structured composition log for this run.
  try {
    logPromptComposition(
      buildPromptCompositionLog({
        contract: resolvedContract.contract,
        result: workspaceOverlay,
        taskTemplateLocked: true,
        surface: "run-task",
        taskType,
        runId,
      }),
    );
  } catch (e) {
    console.warn(
      "[workspace:prompt_composition] log failed (non-fatal):",
      (e as Error)?.message,
    );
  }

  // ── W6.5 Pass A — Library Standard Context (shadow, pre-gen) ─────
  // Select 2–4 STANDARD/EXEMPLAR/PATTERN cards from the user's
  // library and append a "WHAT GOOD LOOKS LIKE" guidance block to
  // overlayPrefix so it flows into every task system prompt
  // (synthesis, authoring, review). The locked task templates are
  // NOT modified — STANDARDS guide HOW to write, not WHAT to write.
  // RESOURCE beats STANDARD: anything pulled in via Stage 0 library
  // retrieval is demoted out of the candidate pool.
  let exemplarSet: ExemplarSet | null = null;
  let standardContextBlock: StandardContextPersistenceBlock | null = null;
  try {
    const passAScopes = (() => {
      const fromUser = inferTopicScopes(userContent || "");
      if (fromUser.length > 0) return fromUser;
      const fb: string[] = [];
      const co = (inputs as any)?.company_name;
      const op = (inputs as any)?.opportunity;
      if (typeof co === "string" && co.trim()) fb.push(co);
      if (typeof op === "string" && op.trim()) fb.push(op);
      return fb.length > 0 ? fb : derivedScopes;
    })();
    const retrievedItemIds: string[] = [
      ...(library.knowledgeItems ?? [])
        .map((k: any) => String(k?.id ?? ""))
        .filter((s: string) => s.length > 0),
      ...(library.playbooks ?? [])
        .map((p: any) => String(p?.id ?? ""))
        .filter((s: string) => s.length > 0),
    ];
    exemplarSet = await selectExemplars(supabase, userId, {
      workspace: resolvedContract.workspace,
      surface: "run-task",
      taskType,
      scopes: passAScopes,
      retrievedItemIds,
    });
    logStandardContext(exemplarSet);
    standardContextBlock = buildStandardContextPersistenceBlock(exemplarSet);
    const standardsText = renderStandardBlock(exemplarSet);
    if (standardsText) {
      overlayPrefix = `${overlayPrefix}${standardsText}\n\n`;
    }
  } catch (passAErr) {
    console.warn(
      "[workspace:standard_context] run-task threw (ignored, shadow):",
      String(passAErr).slice(0, 200),
    );
  }

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
    { role: "system", content: `${overlayPrefix}You are a senior sales strategist. Synthesize research + internal IP into actionable intelligence. Return structured JSON only. No markdown fences, no preamble.` },
    { role: "user", content: handler.buildSynthesisPrompt(inputs, research, library) },
  ], { model: synthesisModel, maxTokens: 16000, reasoningEffort: "medium" });
  const synthesis = safeParseJSON<any>(synthesisRaw) ?? { raw: synthesisRaw };
  console.log(JSON.stringify({ tag: "stage-2:end", run_id: runId, model: synthesisModel, synthesis_fields: Object.keys(synthesis).length }));

  // ── Progressive execution switch (discovery_prep only) ─────────
  // Persist synthesis as the single source of truth, pre-create
  // task_run_sections rows, and kick off batch 0 in a fresh isolate
  // via HTTP self-invoke. Return immediately so this isolate exits
  // cleanly — the per-batch ladder (Claude-first per batch, OpenAI
  // fallback per batch) and assembly run in run-discovery-prep-step.
  if (taskType === "discovery_prep") {
    await setProgress(supabase, runId, "document_authoring");
    try {
      await persistSynthesisArtifact({
        supabase,
        runId,
        synthesis,
        systemPrompt: `${overlayPrefix}${handler.buildDocumentSystemPrompt()}`,
        baseUserPrompt: handler.buildDocumentUserPrompt(inputs, synthesis, library),
        libraryCounts: { kis: library.counts?.kis ?? 0, playbooks: library.counts?.playbooks ?? 0 },
        researchChars: research.totalChars,
        // Phase 3A/3B safe bridge — carry SOP + shadow input check
        // through to assembleAndFinalize. Never read by prompt builders.
        sop,
        sopInputCheck,
      });
      await ensureSectionRows({ supabase, runId, userId });
      console.log(JSON.stringify({
        tag: "[progressive:handoff]",
        run_id: runId,
        total_batches: TOTAL_BATCHES,
      }));
      invokeNextStep({ runId, batchIndex: 0, userId });
      return;
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 500);
      console.error(JSON.stringify({ tag: "[progressive:handoff_failed]", run_id: runId, error: msg }));
      await supabase
        .from("task_runs")
        .update({
          status: "failed",
          progress_step: "failed",
          error: `progressive_handoff: ${msg}`,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", runId);
      return;
    }
  }

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
    { role: "system", content: `${overlayPrefix}${handler.buildDocumentSystemPrompt()}` },
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

  // ── Bounded-batch-first policy for discovery_prep ────────────────
  // The 19-section monolithic Claude pass is fragile and historically
  // exhausts the stage budget on retries, starving the per-batch ladder.
  // For discovery_prep we now skip the monolith entirely and execute the
  // per-batch ladder as the PRIMARY authoring path. Claude remains first
  // per batch; ChatGPT (gpt-5) fallback is per-batch and exception-only.
  // Other task types still use the monolithic-first path below.
  // NOTE: discovery_prep returns above (line ~351) via the progressive
  // handoff branch, so this code path is reached only by other task types.
  // Cast widens the narrowed union so the (intentionally false) comparison
  // remains valid TS without changing runtime behavior.
  const BOUNDED_BATCH_FIRST = (taskType as string) === "discovery_prep";

  try {
    let documentRaw: string;
    let primaryErrForLog: string | null = null;
    try {
      if (BOUNDED_BATCH_FIRST) {
        // Force-fall through to the section-batched rescue branch, which
        // is now the *primary* authoring path for discovery_prep.
        throw new Error("bounded_batch_first: skipping monolithic authoring (discovery_prep policy)");
      }
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
      // For BOUNDED_BATCH_FIRST runs, claudeErr is a synthetic skip-marker;
      // do NOT apply the transient-only filter (it would propagate).
      if (!BOUNDED_BATCH_FIRST && !forceAuthoringFailure && !isFallbackEligible(claudeErr)) {
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
        bounded_batch_first: BOUNDED_BATCH_FIRST,
      }));
      const fallbackStartedAt = Date.now();
      console.log(JSON.stringify({
        tag: "[authoring:fallback_start]",
        run_id: runId,
        fallback_model: FALLBACK_MODEL,
        bounded_batch_first: BOUNDED_BATCH_FIRST,
      }));

      // BOUNDED_BATCH_FIRST: skip monolithic OpenAI fallback, go straight
      // to per-batch ladder (Claude-first per batch). This IS the primary
      // authoring path for discovery_prep.
      if (BOUNDED_BATCH_FIRST) {
        console.warn(JSON.stringify({
          tag: "[authoring:section_batch_rescue_start]",
          run_id: runId,
          task_type: taskType,
          reason: "bounded_batch_first",
        }));
        const rescue = await authorBySectionBatches({
          runId,
          taskType,
          systemPrompt: `${overlayPrefix}${handler.buildDocumentSystemPrompt()}`,
          baseUserPrompt: handler.buildDocumentUserPrompt(inputs, synthesis, library),
          synthesis,
          supabase,
        });
        if (rescue.sections_authored > 0) {
          console.log(JSON.stringify({
            tag: "[authoring:section_batch_rescue_success]",
            run_id: runId,
            sections_authored: rescue.sections_authored,
            sections_total: rescue.draft.sections.length,
            any_fallback_success: rescue.any_fallback_success,
            bounded_batch_first: true,
          }));
          documentRaw = JSON.stringify(rescue.draft);
          fallbackMeta = {
            triggered: false,
            bounded_batch_first: true,
            primary_model: authoringModel,
            fallback_model: FALLBACK_MODEL,
            success: true,
            forced: forceAuthoringFailure,
            section_batch_rescue: {
              used: true,
              primary_path: true,
              sections_authored: rescue.sections_authored,
              sections_total: rescue.draft.sections.length,
              any_fallback_success: rescue.any_fallback_success,
              batches: rescue.batchOutcomes,
            },
          };
        } else {
          fallbackMeta = {
            triggered: false,
            bounded_batch_first: true,
            primary_model: authoringModel,
            fallback_model: FALLBACK_MODEL,
            success: false,
            forced: forceAuthoringFailure,
            section_batch_rescue: {
              used: true,
              primary_path: true,
              sections_authored: 0,
              sections_total: rescue.draft.sections.length,
              any_fallback_success: false,
              batches: rescue.batchOutcomes,
            },
          };
          try {
            await supabase.from("task_runs").update({ meta: { authoring_fallback: fallbackMeta } }).eq("id", runId);
          } catch { /* swallow */ }
          throw new Error(`bounded_batch_first: 0/${rescue.draft.sections.length} sections authored`);
        }
        // Done — skip legacy monolithic fallback below.
      } else {

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
          systemPrompt: `${overlayPrefix}${handler.buildDocumentSystemPrompt()}`,
          baseUserPrompt: handler.buildDocumentUserPrompt(inputs, synthesis, library),
          synthesis,
          supabase,
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
      } // end else (legacy monolithic-fallback branch)
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
        { role: "system", content: `${overlayPrefix}You are a senior sales leader reviewing a prep document. Be specific, actionable, and grounded in the provided internal playbooks/KIs.` },
        { role: "user", content: handler.buildReviewPrompt(inputs, draftOutput, library) },
      ], { model: "gpt-5-mini", temperature: 0.4, maxTokens: 4000 });
      const parsed = safeParseJSON<any>(reviewRaw);
      if (parsed) reviewOutput = { ...reviewOutput, ...parsed };
    } catch (e: any) {
      console.error("[stage-4] review failed:", e?.message || e);
      // Don't fail the whole run for review issues; surface in row.
    }
  }

  // ── Phase 3A SOP "SAFE BRIDGE" — output validation (shadow only). ──
  // Runs only on the non-progressive path (account_brief, ninety_day_plan,
  // etc.). Discovery Prep finalizes inside assembleAndFinalize where the
  // equivalent log is emitted.
  //
  // Phase 3B addendum (Account Research): in addition to logging the
  // output check, persist the input/output check pair under
  // task_runs.meta.sop with a finalized_at timestamp, and emit the
  // `[strategy-sop][task]` summary log so observability mirrors the
  // progressive driver. Behavior is unchanged — never blocks, never
  // injects into prompts.
  let sopOutputCheck: ReturnType<typeof validateDraftAgainstSop> | null = null;
  try {
    sopOutputCheck = validateDraftAgainstSop(draftOutput, sop);
    console.log(JSON.stringify({
      tag: "[sop-output-check]",
      run_id: runId,
      task_type: taskType,
      ...sopOutputCheck,
    }));
  } catch (sopErr) {
    console.warn("[sop-output-check] threw (ignored, shadow mode):", String(sopErr).slice(0, 200));
  }

  try {
    console.log(JSON.stringify({
      tag: "[strategy-sop][task]",
      run_id: runId,
      task_type: taskType,
      sop_enabled: !!sop,
      input_ok: sopInputCheck?.ran
        ? (sopInputCheck.required_inputs_missing?.length ?? 0) === 0
        : null,
      output_ok: sopOutputCheck?.ran
        ? (sopOutputCheck.required_outputs_missing?.length ?? 0) === 0
        : null,
    }));
  } catch (sopErr) {
    console.warn("[strategy-sop][task] log threw (ignored, shadow mode):", String(sopErr).slice(0, 200));
  }

  // ── W5: Citation behavior check (shadow + reporting only) ────────
  // Apply the workspace `citationMode` to the authored draft + review.
  // Discovery Prep finalizes via the progressive driver, so this branch
  // covers account_brief / ninety_day_plan / fallback. We never rewrite
  // structured task output here — strict-mode rewrites would land back
  // inside JSON, which the templates don't model. W5 stays shadow.
  let citationCheckMeta: Record<string, unknown> | null = null;
  let w5CitationResult: ReturnType<typeof runCitationCheck> | null = null;
  let w5LibraryHits: CitationAuditHit[] = [];
  let auditableTaskText = "";
  try {
    w5LibraryHits = [
      ...((library.knowledgeItems ?? []) as Array<{ id: string; title: string }>).map(
        (k) => ({ id: k.id, title: k.title }),
      ),
      ...((library.playbooks ?? []) as Array<{ id: string; title: string }>).map(
        (p) => ({ id: p.id, title: p.title }),
      ),
    ];
    auditableTaskText = JSON.stringify({
      sections: draftOutput?.sections ?? [],
      review: reviewOutput,
    });
    w5CitationResult = runCitationCheck({
      assistantText: auditableTaskText,
      libraryHits: w5LibraryHits,
      libraryUsed: w5LibraryHits.length > 0,
      workspace: resolvedContract.workspace,
      contractVersion: resolvedContract.contractVersion,
      citationMode: resolvedContract.retrievalRules.citationMode,
    });
    logCitationCheck(buildCitationCheckLog({
      result: w5CitationResult,
      workspace: resolvedContract.workspace,
      contractVersion: resolvedContract.contractVersion,
      surface: "run-task",
      taskType,
      runId,
    }));
    citationCheckMeta = {
      mode: w5CitationResult.citationMode,
      audited: w5CitationResult.audited,
      citations_found: w5CitationResult.citationsFound,
      issues: w5CitationResult.issues,
      modified: w5CitationResult.audit?.modified === true,
    };
  } catch (citErr) {
    console.warn(
      "[workspace:citation_check] threw (ignored, shadow mode):",
      String(citErr).slice(0, 200),
    );
  }

  // ── W6: Quality gate runner (shadow-only) ────────────────────────
  // Run after the W5 citation check so gates can read its result.
  // Required section IDs are derived from whatever the draft actually
  // contains — handlers in this code path do not declare a locked
  // template, so the artifacts.required_sections_present gate will
  // skip when no IDs are passed (per W6 contract).
  let gatePersistenceBlock: GatePersistenceBlock | null = null;
  let w6GateSummary: ReturnType<typeof runWorkspaceGates> | null = null;
  try {
    const requiredSectionIds: string[] | undefined = (() => {
      const declared = (handler as { requiredSectionIds?: readonly string[] })
        .requiredSectionIds;
      if (Array.isArray(declared) && declared.length > 0) {
        return [...declared];
      }
      // No locked template — leave undefined; gate will skip cleanly.
      return undefined;
    })();
    w6GateSummary = runWorkspaceGates({
      inputs: {
        contract: resolvedContract.contract,
        assistantText: auditableTaskText || JSON.stringify(draftOutput ?? {}),
        parsedOutput: draftOutput,
        libraryHits: w5LibraryHits,
        libraryUsed: w5LibraryHits.length > 0,
        citationCheck: w5CitationResult,
        taskType,
        requiredSectionIds,
      },
      surface: "run-task",
      taskType,
      runId,
    });
    logGateResults(w6GateSummary);
    gatePersistenceBlock = buildGatePersistenceBlock(w6GateSummary);
  } catch (gateErr) {
    console.warn(
      "[workspace:gate_result] run-task threw (ignored, shadow):",
      String(gateErr).slice(0, 200),
    );
  }

  // ── W6.5 Pass B — Library Calibration (shadow, post-gen) ─────────
  // Uses the SAME ExemplarSet from Pass A. Heuristic-only in Phase 1
  // — no LLM judge. Never mutates draft_output. Skips cleanly if
  // Pass A skipped or threw.
  let calibrationPersistenceBlock: CalibrationPersistenceBlock | null = null;
  let calibrationResult: Awaited<ReturnType<typeof runLibraryCalibration>> | null = null;
  try {
    if (exemplarSet) {
      const requiredSectionIds: string[] | undefined = (() => {
        const declared = (handler as { requiredSectionIds?: readonly string[] })
          .requiredSectionIds;
        if (Array.isArray(declared) && declared.length > 0) {
          return [...declared];
        }
        return undefined;
      })();
      const calibration = runLibraryCalibration({
        workspace: resolvedContract.workspace,
        surface: "run-task",
        taskType,
        runId,
        outputText: auditableTaskText || JSON.stringify(draftOutput ?? {}),
        parsedOutput: draftOutput,
        userPromptText: userContent || undefined,
        exemplarSet,
        requiredSectionIds,
      });
      logCalibrationResult(calibration);
      calibrationResult = calibration;
      calibrationPersistenceBlock = buildCalibrationPersistenceBlock(
        calibration,
      );
    }
  } catch (calErr) {
    console.warn(
      "[workspace:calibration_result] run-task threw (ignored, shadow):",
      String(calErr).slice(0, 200),
    );
  }

  // ── W7: Escalation rules (shadow-only, advisory) ─────────────────
  // Evaluates whether the task output suggests promoting the user to
  // another workspace (e.g. an account_brief logging a Projects
  // promotion). Pure telemetry + persistence — never routes the user.
  let escalationPersistenceBlock: EscalationPersistenceBlock | null = null;
  let w7EscalationSummary: ReturnType<typeof evaluateEscalationRules> | null = null;
  try {
    // Synthesize a prompt-like signal from structured task inputs so
    // intent-driven rules (e.g. evidence asks) can still fire.
    const synthesizedPrompt = [
      inputs.desired_next_step,
      inputs.prior_notes,
      inputs.opportunity,
    ].filter((v) => typeof v === "string" && v.trim().length > 0).join("\n");
    const w7Summary = evaluateEscalationRules({
      inputs: {
        contract: resolvedContract.contract,
        assistantText: auditableTaskText || JSON.stringify(draftOutput ?? {}),
        userPrompt: synthesizedPrompt || undefined,
        gateSummary: w6GateSummary,
        citationCheck: w5CitationResult,
        libraryHits: w5LibraryHits,
        taskType,
        runId,
        // W7.5 — calibration-aware overlay (shadow-only, additive).
        calibration: calibrationResult,
      },
      surface: "run-task",
      taskType,
      runId,
    });
    logEscalationSuggestions(w7Summary);
    w7EscalationSummary = w7Summary;
    escalationPersistenceBlock = buildEscalationPersistenceBlock(w7Summary);
  } catch (escErr) {
    console.warn(
      "[workspace:escalation_suggestion] run-task threw (ignored, shadow):",
      String(escErr).slice(0, 200),
    );
  }

  // ── W12: Enforcement dry-run (shadow only, never blocks) ─────────
  // Reads only W5/W6/W6.5/W7.5 metadata. No mutation, no retries, no
  // blocking. Stamped BEFORE schema_health so W10 validates the final
  // payload (incl. enforcement_dry_run as a known top-level block).
  let enforcementPersistenceBlock: EnforcementPersistenceBlock | null = null;
  try {
    const w12Summary = runEnforcementDryRun({
      contract: resolvedContract.contract,
      surface: "run-task",
      workspace: resolvedContract.workspace,
      contractVersion: resolvedContract.contractVersion,
      taskType,
      runId,
      gateSummary: w6GateSummary,
      calibration: calibrationResult,
      citationCheck: w5CitationResult,
      escalationSummary: w7EscalationSummary,
      // schema_health not yet computed — pass undefined; the
      // schema.drift.blocker policy reports silent-no-data, which is
      // correct: this run hasn't been stamped yet.
      schemaHealth: null,
    });
    logEnforcementDryRun(w12Summary);
    enforcementPersistenceBlock = buildEnforcementPersistenceBlock(w12Summary);
  } catch (enfErr) {
    console.warn(
      "[workspace:enforcement_dry_run] run-task threw (ignored, shadow):",
      String(enfErr).slice(0, 200),
    );
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
  // Merge SOP shadow-validation results into meta alongside any
  // pre-existing authoring_fallback metadata.
  const sopMetaBlock = {
    enabled: !!sop,
    inputCheck: sopInputCheck ?? null,
    outputCheck: sopOutputCheck ?? null,
    finalized_at: new Date().toISOString(),
  };
  const metaPatch: Record<string, unknown> = { sop: sopMetaBlock };
  if (fallbackMeta) metaPatch.authoring_fallback = fallbackMeta;
  if (citationCheckMeta) metaPatch.citation_check = citationCheckMeta;
  if (gatePersistenceBlock) metaPatch.gate_check = gatePersistenceBlock;
  if (escalationPersistenceBlock) metaPatch.escalation_suggestions = escalationPersistenceBlock;
  if (standardContextBlock) metaPatch.standard_context = standardContextBlock;
  if (calibrationPersistenceBlock) metaPatch.calibration = calibrationPersistenceBlock;
  // W10 — stamp compact schema-health summary AFTER all blocks are assembled.
  try {
    metaPatch.schema_health = computeSchemaHealth(metaPatch, "task");
  } catch (shErr) {
    console.warn(
      "[schema_health] runTask stamping failed (ignored):",
      String(shErr).slice(0, 200),
    );
  }
  finalizePatch.meta = metaPatch;
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
