
# STRATEGY — Deep Read-Only Audit

No code changes. Quotes verbatim with `file:line`.

---

## 1) Surface & Reachability

- **Route:** `/strategy` (+ `/strategy/settings`, `/strategy/settings/pill/:pillId`, `/strategy/debug`, `/strategy/control`). `App.tsx:157-191`.
- **Entry page:** `src/pages/Strategy.tsx` — pure shell wrapping `<StrategyShell />` from `src/components/strategy/v2/StrategyShell.tsx` inside a `StrategyErrorBoundary`.
- **Nav:** Strategy is in **Work mode** of `BottomNav.tsx:67`: `{ to: '/strategy', label: 'Strategy', icon: Crosshair }`. Train-mode users never see it; not in any side nav. `/strategy/{settings,debug,control}` are URL-only.
- **What the user does:** chat threads (`strategy_threads` 88 rows) → free-form chat OR scoped tasks (`discovery_prep`, `account_brief`, `ninety_day_plan`) which produce structured artifacts (`strategy_outputs`, `strategy_artifacts`). Threads can be linked to an account/opportunity/territory and a workspace ("research/evaluate/build/strategy/brainstorm"). Sidebar lists threads, status pills, rollups, conflicts.

Supporting client modules: `useStrategyThreads`, `useStrategyMessages`, `useStrategyJob`, `useThreadTaskRuns`, `useStrategyOutputs`, `useStrategyArtifacts`.

---

## 2) Request flow / architecture

**Edge functions (`ls supabase/functions | grep -i strateg`):**

- `strategy-chat` — primary chat handler (8.7k LOC, single file) — composes prompt, calls providers, persists assistant message.
- `strategy-summarize-upload` — summarizes a file dropped on a thread.
- `strategy-clone-thread` — copies thread + messages; resets `trust_state='safe'`.
- `strategy-transform-output` — renders a chat message into a structured artifact (brief/memo/docx); has explicit anthropic→openai fallback.
- `strategy-detect-proposals` — extracts proposed contacts/notes from a transcript turn.
- `strategy-detect-conflicts` — writes `strategy_thread_conflicts` rows.
- `strategy-stage-proposal` / `strategy-promote-proposal` — proposal lifecycle; both refresh `trust_state` via RPC.
- `strategy-evidence-render` — renders evidence/citations for a message.
- `strategy-retrieval-probe` — admin debug for retrieval (probe what the model sees).
- `strategy-smoke-test` / `strategy-stress-test` / `strategy-stress-runner` / `strategy-benchmark-runner` — QA harnesses.
- `run-strategy-job` / `run-strategy-task` / `run-strategy-task-reaper` / `run-strategy-eval-synthesis` / `run-phase35b-validation` / `run-validation-canary` — async task pipeline (`task_runs` + `task_run_sections`).
- `run-discovery-prep` / `run-discovery-prep-step` — Discovery Prep async pipeline (separate path used by the brief generator).
- `extract-strategy-memory` — persists `account_strategy_memory` / `opportunity_strategy_memory` / `territory_strategy_memory`.
- `expand-prompt` / `search-context` — retrieval helpers used by chat.

**One user message end-to-end (chat):**

1. Client `useStrategyMessages.sendMessage` → invokes `strategy-chat` with `{thread_id, userContent, workflow_type?, depth, override}`.
2. `strategy-chat/index.ts` (head, lines 1–95) imports a giant aggregator from `strategy-core/index.ts` plus `routeRequest` (router), `classifySituation`, `runCurrentStatePreflight`, `selectOutputMode`, `classifyBehaviorIntent`, plus v2 (`buildV2Prompt`, `assertSynthesisContractIntact`, `v2AuditResponse`).
3. **Router** (`strategy-router/index.ts:30-87`): `routeRequest({...signals, override})` returns `{lane: 'direct'|'assisted'|'deep_work', task_type, ...}`. Hard overrides + deep-intent + account-attached upgrade. Pure function; caller writes `routing_decisions` via `log.ts`.
4. **Situation classifier** (`strategy-router/situationClassifier.ts`): one LLM call to Gemini-Flash that picks a `playbookId` from the user's actual playbooks + emits `derivedScopes[]` (topic keywords).
5. **Context assembly**: `assembleStrategyContext` (account + 10 contacts + latest transcript + branch_footprint) → `contextBlock`. `contextAssembly.ts`.
6. **Library retrieval** (`strategy-orchestrator/libraryRetrieval.ts:120-200`) — KIs from `knowledge_items` filtered by `spider_dimension ∈ mapScopesToDimensions(scopes)` + playbooks. **This is the KI injector** (see §3).
7. **Resource retrieval** (`strategy-core/resourceRetrieval.ts`) — title/ILIKE/tag matches on `resources`; produces a separate `=== LIBRARY RESOURCES ===` block.
8. **Current-state preflight** (`currentStateIntelligence.ts`) — optional separate LLM call that fetches verifiable signals about the account.
9. **Prompt composition** (`strategy-core/chatPrompt.ts:148-235`) — assembles: identity + thinking order + fact discipline + account specificity + economic framing + chat output contract + depth modifier + workspace overlay + ordered context blocks (library / account / resources / totals / working_thesis / context_section). Order reshuffled per `WorkspaceContract.retrievalRules.contextMode`.
10. **Provider call**: `strategy-orchestrator/providers.ts` exposes `callPerplexity`, `callOpenAI`, `callAnthropicWithUsage`. Each returns `{text, citations, usage, provider, model, duration_ms}`. **No silent fallback chain in chat** — chat picks one (`route.primaryProvider`). `strategy-transform-output/index.ts:89,155` shows the only explicit anthropic→openai fallback (`fallbackUsed=true`).
11. **Post-call enforcement**: `runCitationCheck`, `auditResourceCitations`, `runWorkspaceGates`, `evaluateEscalationRules`, optional v2 `assertSynthesisContractIntact` + `v2AuditResponse`.
12. **Persist** to `strategy_messages` with `provider_used`, `model_used`, `fallback_used`, `latency_ms`, `manifest_id` (derived per turn — see §3). Rollups + telemetry written separately (`strategy_rollups`, `strategy_run_telemetry`).

**The "guards" in `strategy_messages.provider_used`** (`creation-guard`, `evaluation-guard`, `synthesis-guard`) are not literal modules but **pipeline-stage labels written by the orchestrator** when a non-LLM enforcement step authors/edits an assistant message. Code path: `provider_used: "system"` is set at `strategy-chat/index.ts:6177` (the targeted-lookup auto-reply). Other `provider_used: result.provider` writes (`:7121, 7219, 7430, 7540, 7970, 8085, 8349, 8362, 8375, 8461`) carry the real provider. The guard labels are written by the orchestrator/runTask path (artifact/gate writers in `artifactGateEnforcement.ts`, `workspaceGateRunner.ts`, `sectionAuthor.ts`) that flag synthesis vs evaluation vs creation slots. They behave as audit stamps, not separate models.

**Provider orchestration:** No fallback chain in chat. Provider is chosen by `route.primaryProvider` (function of intent + workspace). Anthropic↔OpenAI fallback only in `strategy-transform-output`. Perplexity is reserved for current-state web research (sonar-pro, `providers.ts:66`). Lovable AI Gateway is explicitly forbidden in the strategy execution path (`providers.ts:3-8`).

---

## 3) KI-Injection Architecture (the flagged-wrong piece)

### 3a. `manifest_id` — what it actually is

A **string tag for evidence attribution**, not a runtime config. Two distinct meanings collide:

- **In `strategy_messages.manifest_id`**: a content classification derived per-turn from keywords/workflow_type. `strategy-chat/index.ts:100-138`:
```ts
function deriveChatManifestId(content, workspace, workflowType): string | null {
  if (workflowType) { const wfMap = { deep_research: "account-research", account_plan: "account-research",
    territory_tiering: "account-research", opportunity_strategy: "conversation-pov",
    brainstorm: "commercial-insight", email_evaluation: "follow-up-email" };
    return wfMap[workflowType] ?? "conversation-pov"; }
  if (/\b(meddicc|meddpicc|meddic)\b/.test(lower)) return "meddicc-review";
  if (/\bdemo\b/.test(lower) && /\b(strat|plan|prep|...)\b/.test(lower)) return "demo-strategy";
  ... return "conversation-pov";
}
```
That's it — it's a regex bucket so the evidence panel can group messages by purpose.

- **In `strategy-orchestrator/taskManifestMap.ts`**: a richer `SkillManifest` (a different concept, also called "manifest") that drives the task pipeline. Quote:
```ts
const TASK_MANIFEST_MAP = {
  discovery_prep: enrichedDiscoveryPrepManifest,
  account_brief: enrichedAccountBriefManifest,
  ninety_day_plan: ninetyDayPlanManifest,
};
```
Each `SkillManifest` carries `retrieval: { scopes, termBindings, methodologySeeds, minRelevantItems }` and a `rubric` with `sectionMap`. The universal `buildPlan` (`src/lib/strategy-skills/planner/buildPlan.ts`) consumes this to emit a `RetrievalQueryPlan` for tasks. The planner is currently a **client-side mirror**; the live orchestrator on the server uses the legacy `libraryRetrieval` path. So the codebase has **two parallel KI selection systems**: the legacy scope→dimension scorer (in production) and the universal planner (Phase 3.5, partial).

### 3b. Thread resources → context

`strategy_thread_resources` carries up to 19 resource pins per thread. They are read by the **client** (`useStrategyUploads`, `useStrategyArtifacts`) and surfaced in the composer. Server-side, `resourceRetrieval.retrieveResourceContext` ILIKE-matches `resources.title`/tags/description against phrases pulled from the user message; it does NOT join `strategy_thread_resources` directly. Pinned resources reach the prompt only if the rendered upload-summary is already part of `contextSection` (passed in by the client). I.e., **thread-pin → context is implicit, not first-class**.

### 3c. KI selection — the actual injection (legacy path, live in chat)

Quote from `strategy-orchestrator/libraryRetrieval.ts`:

```ts
const SCOPE_TO_DIMENSION: Readonly<Record<string,string>> = {
  competitive: "competitive", adjust: "competitive", appsflyer: "competitive",
  displacement: "competitive", mmp_switch: "competitive",
  expansion: "expansion_strategy", whitespace: "expansion_strategy",
  discovery: "discovery", stakeholder: "stakeholder_navigation",
  champion: "stakeholder_navigation", c_suite: "c_suite_engagement",
  product: "product_knowledge", deep_linking: "product_knowledge",
  attribution: "product_knowledge", branch: "product_knowledge",
  objection: "objection_handling", messaging: "messaging", qualification: "qualification",
};
```

```ts
let kiQuery = supabase
  .from("knowledge_items")
  .select("id, title, chapter, ... , confidence_score, ..., active")
  .eq("user_id", userId).eq("active", true)
  .order("confidence_score", { ascending: false });
if (scopedDimensions.length > 0) kiQuery = kiQuery.in("spider_dimension", scopedDimensions);
const { data: kiRows } = await kiQuery.limit(CANDIDATE_LIMIT /* 800 */);

knowledgeItems = (kiRows as any[])
  .map(r => ({ row: r, score: scoreRow(searchText, opts.scopes) }))
  .filter(x => x.score > 0)
  .sort((a,b) => b.score - a.score || (b.row.confidence_score ?? 0) - (a.row.confidence_score ?? 0))
  .slice(0, maxKIs /* 12 */)
  .map(...);
```

Mechanism summary:
1. Situation-classifier LLM emits 2–6 `derivedScopes` (free-form topic keywords).
2. `mapScopesToDimensions(scopes)` translates those to a small set of `spider_dimension` values via a 30-row hardcoded map.
3. Postgres returns the top 800 KIs in that dimension ordered by `confidence_score`.
4. `scoreRow` does regex-based scope-keyword hit-counts on a concatenated text blob (`title + chapter + framework + spider_dimension + tactic_summary + why_it_matters + when_to_use + tags`).
5. Top 12 by score are projected into `RetrievedKI[]`, formatted as `KI[title]: tactic_summary…` lines inside `=== INTERNAL LIBRARY ===`.

### 3d. Why this is architecturally weak (factual observations)

- **Two KI selectors coexist.** Production chat uses the scope→dimension+ILIKE scorer. The Phase 3.5 universal `buildPlan` exists but only as a manifest-driven planner shadow — `TASK_MANIFEST_MAP` only covers 3 task types, not chat.
- **Lossy translation:** classifier scopes → ~30 hardcoded dimension keywords. Anything off the map (e.g. `forecasting`, `risk_management`, `procurement`, every new sub-chapter) silently falls back to "no dimension filter" → scoring across all 800 highest-confidence KIs regardless of topic.
- **Keyword scoring on prose** — no embeddings, no chunking. With 33k KIs, this is brittle; misspellings, synonyms, persona-coded vocab are invisible.
- **`spider_dimension` is the only handle.** `chapter` / `sub_chapter` / `is_core_ae` / `applies_to_contexts` are read into the blob but never used as filters.
- **No use of `strategy_thread_resources`.** Pinned resources are not promoted to KIs in the prompt; the model gets them only when the client renders a separate upload-summary block.
- **No use of `account_strategy_memory` / `account_signals` in the chat KI path.** Those are written by `extract-strategy-memory` but never queried by `libraryRetrieval`.
- **Two "manifest" concepts share a name** (`strategy_messages.manifest_id` = regex bucket; `SkillManifest` = retrieval+rubric blueprint). Easy to confuse; the DB column is purely cosmetic.
- **Confidence-ordering bias:** the 800-row pre-filter always sorts by `confidence_score` first, so a low-confidence-but-perfect-scope KI never reaches the scorer.

---

## 4) Legacy content (RULE 3) — verbatim hits

`src/lib/strategy/discoveryPrepSopSeed.ts` — fully Branch expansion-AE framed; **no Acoustic/Marketo/martech vocabulary**. Clean.

**Hits across strategy code:**

- `src/lib/commissionCalculations.ts:2` — `// Based on Acoustic FY26 Incentive Plan` (not in strategy folder, but adjacent — flagged for completeness).
- `src/lib/strategy/discoveryPdfGenerator.ts:181` — `if (c.cx_audit_detail) { y = addHeading(doc, 'CX Audit Detail', y, 3); ...`
- `src/lib/strategy/discoveryDocxGenerator.ts:285` — `['CX Audit Detail', content?.cx_audit_detail],`
- `src/lib/strategy/discoveryDocxGenerator.ts:323` — `case 'cx_audit': return [heading('CX Audit Check', 2), ...]`
- `supabase/functions/_shared/strategy-core/enforcementPolicy.ts:53` — `* Policy lifecycle states. W12 ONLY honors 'disabled' and 'dry_run'.` (benign lexical "lifecycle")
- `supabase/functions/_shared/strategy-core/currentStateIntelligence.ts:50,121,262,425-427,466,475,562,573,586,631,953,964,976,1017` — multiple `lifecycle` / `campaign` / `marketing_motion_implication` / `Acoustic` token mentions:
  - `:121` `* lifecycle/CX opportunity map with a mobile-app + attribution` — comment explaining the REPLACEMENT of legacy frame.
  - `:262` `marketing_motion_implication: string;  // What it implies about lifecycle / engagement motion` — schema field still named/typed in lifecycle terms.
  - `:426` `..."Library", "Acoustic", "Corey", "Dave", ...` — stopword/proper-noun list (intentional; Acoustic is a name to ignore).
  - `:466` `// Single capitalized tokens: TJX, ButcherBox, Acoustic` — code comment using Acoustic as an example token.
  - `:573` `"kind": "news | product_launch | campaign | leadership_change | ..."` — schema enum still includes `campaign` alongside Branch-specific kinds.
  - `:953` `"signal": "Concrete... 'TJX's treasure-hunt model means inventory turns weekly and creates real-time scarcity that lifecycle programs almost never exploit'..."` — **prompt example pitched in lifecycle/CRM language**, not Branch expansion.
  - `:964` `"marketing_motion_implication": "1 sentence: what this implies about how lifecycle / engagement / CRM motion should be shaped."` — **active prompt instruction in CRM/lifecycle frame**.
  - `:976` `"next": "Z — ... Example: 'Moving toward a behaviorally-triggered lifecycle motion that monetizes the loyalty signal in real time.'"` — Acoustic-era exemplar.
  - `:1017` `// - No generic lifecycle buckets (Acquisition / Activation / Retention / Winback) as signals.` — guardrail comment (correct direction).
- `supabase/functions/_shared/strategy-core/behaviorIntent.ts:287,384` — both are **removal comments** ("(Removed) Generic martech category-bucket labels."). Clean.
- `supabase/functions/strategy-chat/index.ts:2641-2648` — `// Global SOP lifecycle` / `// Workspace SOP lifecycle` — benign lexical.
- `supabase/functions/strategy-chat/index.ts:6489` — assistant **example/few-shot**: `"I wouldn't lead with lifecycle marketing at all. I'd start with the fact that TJX wins because shopping feels unpredictable — then frame lifecycle as a way to extend that unpredictability beyond the store. That immediately changes the conversation from campaigns to experience design."` — Acoustic-era exemplar baked into the live system prompt.
- `supabase/functions/strategy-detect-proposals/index.ts:116,123,132` — worked-example uses `Matthew Pertgen said Acoustic is not a fit because they're heavily invested in HubSpot.` as the canonical input — Acoustic-as-vendor example surfaced into a live prompt.
- Outside strategy folder but in strategy-adjacent functions: `enrich-account/index.ts:448,466,654,678` (MarTech case-study search), `discover-contacts/index.ts:103-204,287-296,494,686-687` (uses `crm_lifecycle`, `martech`, `cx` discovery modes and "Director of Lifecycle Marketing" ordering preference), `daily-digest/index.ts:129` (`new martech stack adoption, ... marketing strategy, growth, customer retention`), `parse-screenshot/index.ts:131` (`Build MarTech string`).

**Summary**: Acoustic seed SOP is clean; `currentStateIntelligence.ts` and the assistant few-shot inside `strategy-chat/index.ts:6489` and `strategy-detect-proposals` worked example are the remaining live contamination points. `enrich-account` / `discover-contacts` / `daily-digest` are not in `strategy/` but feed the strategy surface and still operate in Acoustic CRM-lifecycle vocabulary.

---

## 5) Reasoning Contracts

Defined in `supabase/functions/_shared/strategy-core/reasoningCore.ts` as **prompt fragments** consumed by every strategy surface. Quote (`reasoningCore.ts:1-90`):

```ts
export const STRATEGY_CORE_THINKING_ORDER = `NON-NEGOTIABLE STRATEGY CORE THINKING ORDER (you must complete BEFORE writing):
  STEP 1 — ACCOUNT THESIS: define account_truth, primary_growth_lever, primary_value_leakage,
    biggest_risk, best_entry_point_motion, one_line_story. Account-specific. Opinionated. Business-first.
  STEP 2 — VALUE LEAKAGE MAP: 4-6 leakage points, each with evidence, grade (VALID/INFER/HYPO/UNKN), ...
  STEP 3 — SECTION POV: every required section starts with a pov_block ... Each call MUST be DISTINCT.
  STEP 4 — ALIGNMENT: every section ties back to the thesis or the leakage map.`;
export const FACT_DISCIPLINE_RULES = `FACT DISCIPLINE (CRITICAL): VALID / INFER / HYPO / UNKN. ...`;
export const ACCOUNT_SPECIFICITY_RULE = `ACCOUNT-SPECIFICITY RULE: ...`;
export const ECONOMIC_FRAMING_RULES = `SOLUTION DISCIPLINE: For tech_stack: DIAGNOSE business breakage BEFORE prescribing platform. Stack does not lead the call. Order: Diagnose → Quantify → Validate → Propose motion.`;
```

Plus shared JSON-schema fragments: `POV_BLOCK_SCHEMA`, `ACCOUNT_THESIS_SCHEMA`, `VALUE_LEAKAGE_ENTRY_SCHEMA`. They are vocabulary-agnostic ("account_truth", "value_leakage", "primary_growth_lever") — **generic strategic-account language, not Branch expansion-AE language**. The Branch-specific framing lives in `chatPrompt.ts:CHAT_IDENTITY` (line 44 — long quoted earlier) which prepends Branch vocabulary in front of these contracts. Other v2 contracts live in `strategy-core/v2/{reasoningRubric,extendedReasoningContract,qualityAudit,wrongQuestionGuard}.ts` plus the locked file `_locked/synthesisStrongContract.lock.md`.

---

## 6) Does it work + extras (terse)

- **trust_state + conflict detection.** `compute_thread_trust_state(p_thread_id)` SQL function returns `'blocked' | 'warning' | 'safe'` based on unresolved `strategy_thread_conflicts` severity. Written via `strategy-detect-conflicts`; refreshed by `strategy-stage-proposal` (`:103-108`) and `strategy-promote-proposal` (`:187-200`). `strategy-clone-thread` resets to `'safe'`. Used in UI by `useThreadTrustState`. Only 4 conflict rows currently — feature is wired but lightly exercised.
- **Benchmark / judge_mode.** `strategy-benchmark-runner/index.ts:1133` reads `judge_mode: 'heuristics_only' | 'llm_only' | 'both'`. Runs canned "asks" against an account; computes heuristic scores + optional LLM-judge scores; persists to `strategy_benchmark_runs` + `strategy_benchmark_audit_logs`. Saves markdown report; supports replay. 13 runs in DB.
- **fallback_used frequency:** Only meaningfully populated by `strategy-transform-output` (anthropic→openai). Chat sets `fallback_used` from `routingDecision` flag (`strategy-stress-test/index.ts:387`). Smoke test asserts non-null (`strategy-smoke-test/index.ts:193`). With only 4 `strategy_outputs` rows, real fallback exercise is minimal.
- **Obvious dead/abandoned/parallel pieces:**
  - Two KI-selection systems (legacy scorer in chat vs Phase 3.5 universal planner in tasks).
  - Two "manifest" concepts sharing a column name.
  - `strategy_synthesis_cache` table exists but no recent write code surfaced in grep.
  - `currentStateIntelligence.ts` is ~2.3k LOC and carries the bulk of Acoustic-era prompt residue.
  - `enforcementPolicy.ts` has higher policy states explicitly noted as placeholders ("W12 ONLY honors `disabled` and `dry_run`. Higher states are placeholders so the registry contract is stable").
  - `strategy-chat/index.ts` is a single 8732-line file — strong code-smell for future bugs.

