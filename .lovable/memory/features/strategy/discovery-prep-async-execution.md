---
name: discovery-prep-async-execution
description: Discovery Prep runs as an async background job behind the existing button — strong synthesis model preserved, polled via task_runs row state.
type: feature
---
**Execution path (post-rollout)**
- Existing button → existing modal → `useTaskExecution.runDiscoveryPrep` → `run-discovery-prep` edge function.
- Edge function inserts a `pending` row in `task_runs`, returns `{run_id, status}` immediately, then runs the 5-stage pipeline via `EdgeRuntime.waitUntil`.
- Stages write `progress_step` to the row (queued → library_retrieval → research → synthesis → document_authoring → review → completed). On error: status=failed + `error` populated.
- Client polls `{action:"status", run_id}` every 3s (10-min hard cap). UI button label reflects current step.

**Synthesis model: NEVER downgrade**
- Stage 2 must use `openai/gpt-5` via the Lovable AI Gateway (`callLovableAI` with `max_completion_tokens`, no `temperature`). The gateway needs `max_completion_tokens` and rejects `temperature` for the gpt-5 family — handled in `providers.ts`.
- Background execution is what makes the strong model viable; do not revert to gemini-2.5-pro to "save time".

**Schema**
- `task_runs` columns added: `progress_step text`, `error text`, `completed_at timestamptz`. Indexes: `(user_id,status,created_at desc)`, `(id,user_id)`.

**Shared orchestrator**
- `runStrategyTaskInBackground(ctx)` is the async entry; `runStrategyTask(ctx)` kept synchronous for back-compat / smoke tests.
- Both write to the same row so a row's lifecycle is identical regardless of caller.

**DOCX rendering**
- Document is built with `hyphenation: { autoHyphenation: false, doNotHyphenateCaps: true, consecutiveHyphenLimit: 0 }` so Word does not split words mid-character — long words wrap whole to the next line.

**SOP shadow validation (Phase 3A/3B)**
- Client may attach `inputs.__sop` (DiscoveryPrepSopContract). Pulled off in `runTask.executePipeline` before any prompt builder runs — prompt signatures stay byte-identical.
- `sopValidator.ts` runs `validateSopInputs` (pre-stage 2) and `validateDraftAgainstSop` (post-assembly). Both pure observation, never throw, never mutate state.
- Logs: `[strategy-sop]`, `[sop-input-check]`, `[sop-output-check]`, and a single-line `[strategy-sop][task]` summary at finalize.
- Persisted to `task_runs.meta.sop = { enabled, inputCheck, outputCheck, finalized_at }` for queryability after logs roll off.
- DO NOT inject SOP content into prompts here — task SOP is diagnostic only until enforcement phase is approved.
