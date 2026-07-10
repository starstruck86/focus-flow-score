# Phase 2 — Explicit `any` Remediation Plan (read-only scan complete)

## Scan summary

| Bucket | Files scanned | Explicit `any` findings |
|---|---|---|
| Auth guards & contexts | `AuthContext.tsx`, `ProtectedRoute.tsx`, `authenticatedFetch.ts`, `useMutationGuard.ts` | **0** (clean) |
| `useDataSync` row mappers | `src/hooks/useDataSync.ts` | **0** (only reference is a comment on line 284 noting the old `from(table as any)` pattern was already removed) |
| Resource / extraction pipeline | `resourcePipeline.ts`, `extractionPipeline.ts`, `pipelineContract.ts`, `processingState.ts` | **~55** (heavy) |
| Edge functions calling AI providers | 40+ `index.ts` files + `_shared/getModelConfig.ts` | **~700+** total (top offenders: strategy-chat 126, generate-time-blocks 80, extract-tactics 58, strategy-benchmark-runner 53, batch-extract-kis 45, territory-copilot 44) |

**Headline finding:** the two most security-adjacent buckets (auth & useDataSync) are already `any`-free. Remaining risk lives in the pipeline layer and the AI response-parsing paths.

---

## Prioritized remediation order

### P0 — AI response envelope parsing in edge functions (highest runtime risk)
The dangerous `any` uses are the ones that touch untrusted provider payloads: `data.choices?.[0]?.message?.content`, `data.content?.[0]?.text`, tool-call arg parsing, and JSON.parse of model output. These currently flow as `any` into downstream DB writes and client responses.

Recommended order:
1. **`_shared/getModelConfig.ts`** — small, foundational. Type the config row + return shape first so every downstream function inherits typed model info. (est. 1–3 `any`.)
2. **`_shared/` helper — add `AnthropicResponse`, `OpenAIChatResponse`, `LovableGatewayResponse`, `PerplexityResponse`, `ElevenLabsSTTResponse` narrow types** (new file, e.g. `_shared/aiResponseTypes.ts`). Not a fix on its own, but unblocks every P0 function.
3. **`strategy-chat/index.ts` (126)** — largest surface, writes citations + telemetry. Highest blast radius; do after the shared types exist.
4. **`grade-transcript` (17), `strategy-transform-output` (11), `strategy-smoke-test` (22)** — recently touched; small, high-value wins that also re-verify smoke-test contract.
5. **Score/grade family:** `dojo-score`, `dojo-review-score`, `dojo-roleplay-score`, `car-mode-score`, `car-mode-audio-score`, `grade-mock-call`, `score-original-response`, `score-micro-drill` — same JSON-out-of-model shape; typing one gives a template for the rest.
6. **Extraction family:** `batch-extract-kis` (45), `extract-tactics` (58), `extract-scenarios`, `extract-tasks`, `extract-strategy-memory`, `preprocess-transcript` — these write KIs to DB, so bad parsing = corrupt training corpus.
7. **Voice/audio:** `elevenlabs-stt`, `elevenlabs-transcribe`, `transcribe-audio`, `elevenlabs-tts-stream`, `dave-conversation-token` (31) — provider payload shapes are stable and small; quick wins.
8. **Remaining chat/generation functions** (generate-time-blocks 80, territory-copilot 44, weekly-battle-plan 12, daily-digest 6, simulate-chat, clean-baseline, pdf-ocr, expand-prompt, voice-command, analyze-call, analyze-sentiment, analyze-deal-outcome, discover-*, parse-*, prioritize-accounts, source-icp-accounts, suggest-*, generate-*, playbook-roleplay, mock-call, branch-intelligence, etc.).

**Risk if left as `any`:** silent shape drift when a provider changes response envelope (already bit us with `claude-sonnet-4-20250514` retirement and `max_tokens` → `max_completion_tokens`); malformed JSON.parse can throw uncaught and 500 the function; typos in `.choices[0].message.content` go undetected.

### P1 — `src/lib/extractionPipeline.ts` (~40 `any`)
Every DB call uses `(supabase as any).from(...)`, and helpers `computePriorityScore(resource: any)`, `diagnoseBlockReason(resource: any)`, `assignQueue(resource: any, ...)`, plus `.map((r: any) => ...)`, `.map((k: any) => ...)`, `recentJobs: any[]`, `catch (err: any)`.

**Why risky:** this file writes to `resources`, `extraction_pipeline_jobs`, `knowledge_items`. `(supabase as any)` defeats generated `Database` types, so column renames / removals compile silently. Priority scoring on `resource: any` means a missing field is `undefined` and scores land at 0 — invisible corruption of the queue.

**Remediation:** import `Database` from `@/integrations/supabase/types`, alias `Resource = Tables<'resources'>`, `PipelineJob = Tables<'extraction_pipeline_jobs'>`, `KnowledgeItem = Tables<'knowledge_items'>`. Replace `(supabase as any).from('X')` with typed `supabase.from('X')` — the `as any` is only there because the file predates the generated types being current. If a column is genuinely missing from generated types, that's a schema-vs-types drift bug to log, not paper over.

### P2 — `src/lib/resourcePipeline.ts` (~10 `any`)
Mostly `metadata: (…) as any`, `trackedInvoke<any>`, and `(result.data as any).summary / .tasks`.

**Why risky:** the `result.data as any` reads land straight in DB updates (`extracted_actions`, `summary`). Same class of bug as P0 — untyped model output written to app tables.

**Remediation:** define response DTOs per edge function (`EnrichResourceResponse`, `OperationalizeResourceResponse`, `ExtractTasksResponse`) in `src/lib/edgeFunctionTypes.ts` and thread them through `trackedInvoke<T>` / `invokeEnrichResource<T>` generics. Type `metadata` as `Json` from generated types instead of `any`.

### P3 — `src/lib/processingState.ts` (~6 `any`)
All are `(resource as any).content_length / .manual_content_present / .resolution_method`.

**Why risky:** these three fields drive whether a resource is treated as "resolved via manual content" — a silent typo demotes recovered resources back to failed state.

**Remediation:** widen the shared `Resource` type (or create `ResourceWithRecovery`) so these three columns are first-class. Confirm the columns exist in the generated `Database` type; if they do, the cast is unnecessary and can just be deleted.

### P4 — `src/lib/pipelineContract.ts` (2 `any`)
`ENRICHED_STATUSES.includes(resource.enrichment_status as any)` twice.

**Why risky:** low. Just a `readonly string[].includes(x)` TS narrowing quirk.

**Remediation:** either widen `ENRICHED_STATUSES` to `readonly EnrichmentStatus[]` or use `(ENRICHED_STATUSES as readonly string[]).includes(resource.enrichment_status ?? '')`. Trivial.

### P5 — Auth & useDataSync
**No action.** Confirmed clean. Note in the tracking doc so future scanners don't re-open.

---

## Suggested execution shape (when we move to build mode)

1. **Batch A (foundations, ~1 session):** P4 pipelineContract, P3 processingState, add `_shared/aiResponseTypes.ts`, add `src/lib/edgeFunctionTypes.ts`, type `_shared/getModelConfig.ts`. No behavior change; typecheck must stay green.
2. **Batch B (pipeline hardening, ~1 session):** P2 resourcePipeline + P1 extractionPipeline. Requires re-verifying generated `Database` types are current; may surface real schema drift to log.
3. **Batch C (edge functions, staged):** P0 in the priority sub-order above, one function group per deploy so smoke tests catch shape regressions early. Never batch strategy-chat with other functions.

## Non-goals for Phase 2
- Do **not** enable `noImplicitAny` compiler flag in this phase — corpus is too large; treat as a Phase 3 gate after Batches A–C land.
- Do **not** touch `src/integrations/supabase/types.ts` (auto-generated).
- Do **not** rewrite pipeline logic while retyping — pure type work only, matches the discipline used in the Motion rename tranche.

## Reporting artifact
After each batch, produce a short diff of `rg -c ": any\b|<any>|as any\b|any\[\]" <files>` before/after so the burn-down is visible.
