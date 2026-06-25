
# TRAIN v2 — Stage D Plan (Deep Linking proof topic)

No code edits this turn. Audit + phased plan only.

---

## A. INVENTORY — existing Dojo engine to REUSE

**Session loop / orchestrator (the "one engine"):**
- `src/pages/Sharpen.tsx` (620 LOC) — the actual rep loop: load KI → input → POST /dojo-score → feedback → next. This is the loop Stage D layers MODES onto. Writes `dojo_sessions` + `ki_mastery`.
- `src/pages/Dojo.tsx` (839 LOC) — hub/dashboard (block mgmt, anchors, lanes). Not the rep loop; entry surface.
- `src/components/dojo/DojoRoleplay.tsx`, `DojoReview.tsx`, `MicroDrillSession.tsx`, `TrainingModes.tsx` — alternate rep surfaces; relevant for understanding entry points but Sharpen is the canonical drill loop to extend.

**Scorer (the "one scorer"):**
- `supabase/functions/dojo-score/index.ts` (908 LOC) — the scorer. Accepts `{ scenario:{skillFocus,context,objection}, userResponse, ki:{title,tactic_summary,example_usage,when_to_use,when_not_to_use,why_it_matters} }`. Returns score + rubric subscores + focusPattern + retry-aware deltas. **Reuse as-is** for roleplay/drill AND band gate (gate just calls it with `ki` omitted = cold).
- Sibling scorers to leave alone: `dojo-roleplay-score`, `dojo-review-score`, `score-micro-drill`, `score-original-response`. Do NOT fork another.

**KI selection / writes:**
- `src/lib/dojo/selectNextKI.ts`, `selectNextBranchKI.ts`, `selectNextKIFromCategory.ts` — current dimension/chapter pickers. **Stage D adds a 4th picker keyed off `ki_curriculum_full` (sub_level)**, does not replace them.
- `src/lib/dojo/kiMasteryWriter.ts` — per-KI SRS write. **Keep firing per drill** (mandated).
- `src/lib/dojo/types.ts` (171 LOC) — `DojoScoreResult`, `normalizeScoreResult`. Extend, don't replace.
- `src/hooks/useScoreOriginalResponse.ts` — pattern for invoking score fn with normalization.

**Audio/voice path (reuse for "teach opener" if we ever go audio):**
- `src/lib/dojo/dojoVoiceAdapter.ts`, `src/lib/daveVoiceRuntime.ts` — teach-by-exemplar can read the exemplar through these later; Phase 3 only.

**Stage C live data (confirmed via read_query):**
- `curriculum_concepts` = 24 rows (deep_linking), `ki_curriculum` = 148, `ki_curriculum_full` view = 148 ordered rows (deep_linking), `curriculum_gates` = 5, `user_competency` = 0, `user_band_gate` = 0. ✅ All 6 objects exist and are readable.

---

## B. SHARPEN SCORE-POISONING — root cause + fix

**File:** `src/pages/Sharpen.tsx` lines 289–304 (call site) + `supabase/functions/dojo-score/index.ts` lines 571–592 (prompt assembly).

**Root cause (two compounding bugs):**

1. **Sharpen feeds the gold answer as the buyer's objection.** Line 293:
   ```ts
   objection: currentKI.example_usage || currentKI.tactic_summary || 'Respond to this situation.'
   ```
   `example_usage` is the world-class rep line. So the prompt becomes "Buyer says: '<elite rep line>'". Rep then mirrors it → looks elite. Wrong field entirely; `example_usage` is a rep utterance, not a buyer utterance.

2. **The KI block leaks the same exemplar to the grader in the same prompt.** dojo-score line 576 emits `World-class execution — real call example: "${ki.example_usage}"`. So the grader sees the gold answer labeled as the buyer line AND as the world-class line, and the rep's score collapses toward "matches the model" rather than "handles the objection".

**Fix (clean, minimal, ships in Phase 2):**

- Sharpen call site: stop using `example_usage` as the objection. Source the buyer line from a real scenario field. Three acceptable sources in priority order:
  1. New `curriculum_concepts.teach_beat_ref` payload (objection text authored per concept) when present,
  2. `currentKI.when_to_use` framed as a situation (already a buyer/scenario field) + a generic stem,
  3. Curated `scenarios.ts` fallback for that `spider_dimension`.
  Never `example_usage` and never `tactic_summary` (those are rep/play content).
- dojo-score: keep `kiBlock` for teach-mode coaching, but **omit `example_usage` from the prompt during scoring** (only include `tactic_summary` + `when_to_use` + `why_it_matters` so the grader knows the play without seeing the gold line). Gate-mode calls pass no `ki` at all → cold.
- Add a unit assertion: `objection` must not equal `ki.example_usage` (cheap guard against regression).

This is the consolidation: one scorer, one loop, no leak.

---

## C. PHASED BUILD PLAN (each phase independently shippable / deno-checkable)

### Phase 1 — Data layer (read curriculum, write competency)

New files (frontend):
- `src/lib/train/curriculum.ts` — typed reads against `ki_curriculum_full`, `curriculum_concepts`, `curriculum_gates`. Exposes:
  - `getSubLevels(spoke, topic)` → ordered `[{ sub_level, band, concepts[] }]`
  - `getConceptWithItems(concept_id)` → `{ concept, teach:{kind, exemplarKi|teachBeatRef|pending}, drills[] (ordered by order_in_concept, capped) }`
  - `getBandGate(spoke, topic, band)` + `getBandExemplarPool(band)` for cold items.
- `src/lib/train/competency.ts` — typed writes:
  - `incrementSubLevelRep(user, spoke, topic, sub_level, scoreOut)` upserts `user_competency` (reps++, progress recompute, sub-level `gate_passed_at` when threshold met).
  - `recordBandGateAttempt(user, …, score)` upserts `user_band_gate` (status, best_score, attempts, `passed_at`, `next_retest_due = now()+30d` on pass).
- `src/types/train.ts` — `Band`, `SubLevel`, `Concept`, `TrainAtomPlan`, `BandGateAttempt`.
- `src/hooks/train/useSubLevelLadder.ts`, `useConceptAtom.ts`, `useBandGate.ts` — React Query wrappers.

No engine wiring yet. Deliverable: read paths render a placeholder list page; write helpers covered by a smoke test.

DB: none required (Stage C is live). Optional later: a `next_retest_due` index — defer.

### Phase 2 — Engine modes on the Dojo loop (+ Sharpen fix)

Refactor `Sharpen.tsx` into a thin shell + a `useTrainAtomSession` hook so Stage D modes are configurations, not new loops:
- New: `src/lib/dojo/trainAtomEngine.ts` — state machine `teach → roleplay → refine → owned`, parameterized by `mode: 'practice' | 'band_gate'`.
- New: `src/pages/TrainAtom.tsx` — route `/train/:spoke/:topic/:sub_level` (and `/train/:spoke/:topic/gate/:band`) consuming the engine.
- Reuses: `dojo-score` edge fn, `kiMasteryWriter`, `dojo_sessions` insert (add `mode: 'train_atom' | 'band_gate'`).
- Calls Phase 1 writers on every rep / gate attempt.

Teach-opener:
- `ki_exemplar` → render the exemplar KI card (no scoring).
- `authored` → render `teach_beat_ref` content.
- `teach_beat_status='pending'` (e.g. C5b) → render "Beat pending — opening with the first drill as a provisional teach" banner, then proceed with `order_in_concept = 1` as the opener. Engine never crashes on missing beats.

Band gate:
- Cold mode (`ki` omitted in scorer call, no teach surface, no retry assist).
- Item pool = exemplar KIs of every concept in that band (`item_strategy='band_exemplars'`).
- N items (default 5), aggregate avg vs `pass_threshold` (80).
- On pass: write `user_band_gate`, set `passed_at`, `next_retest_due = now()+30d`, mark next band `available`.
- On fail: write attempt, surface targeted sub-levels to revisit.

Sharpen fix lands in this phase (call-site change + scorer prompt change). Single migration of behavior: old `/sharpen` route keeps working but routed through the patched call site.

Sub-skill drill cap: `min(drills.length, 5)` per rep, ordered by `order_in_concept`, rotated by user history (use existing `ki_mastery.last_drilled_at`).

### Phase 3 — UI (ladder, atom flow, gate ceremony)

- `src/pages/TrainTopic.tsx` (`/train/product/deep_linking`) — the Duolingo-style sub-level ladder driven by `user_competency` + `user_band_gate`. Band rows collapse, sub-levels chip out, locked/available/passed states from `user_band_gate.status`.
- Atom flow polish on `TrainAtom.tsx`: teach card → "Try it" → roleplay → score + refine → owned check.
- Band gate ceremony: pre-gate cold-prep warning, in-gate "no coaching" UI, post-gate result with promotion animation and "Retest due <date>" chip.
- Anti-decay surfacing: when `next_retest_due <= now()`, show a "Retest <band>" CTA at the top of the ladder.

Each phase passes `tsgo --noEmit` for frontend and `deno check` for any touched edge fn (Phase 2 only touches one). RLS already in place; no migrations required.

---

## D. CONFLICTS + DECISIONS NEEDED

1. **Two routes or one?** Existing `/sharpen` already covers freeform dimension drills and is wired into Dojo/Branch modes. Stage D introduces `/train/...`. Recommendation: keep `/sharpen` as the open-ended drill (still useful), make `/train` the curriculum-gated path. Confirm.
2. **Sub-level "progress" formula.** `user_competency.progress` is 0..1. Proposal: `progress = min(1, reps_passing(≥70) / required_passes)` where `required_passes = max(3, num_drills_in_sublevel)`. `gate_passed_at` (sub-level) set when `progress >= 1`. OK?
3. **Band gate item count + threshold.** Schema says `pass_threshold=80`. Proposal: 5 cold items from band exemplars, aggregate average vs 80. OK or want a per-item floor too (e.g. no item < 60)?
4. **`next_retest_due` interval.** Proposal: 30 days on pass, 14 days if average between 70–79 (warning), immediate on fail. OK?
5. **dojo_sessions schema additions.** I'll write `mode='train_atom'|'band_gate'` into the existing `mode` text column (no migration). Confirm no enum constraint blocks that — I'll verify before writing.
6. **Exemplar leak fix scope.** OK to also strip `example_usage` from the scoring prompt in non-Sharpen callers (DojoRoleplay etc.)? They have the same leak.
7. **C5b pending-beat handling.** Provisional fallback = "open with first drill" — acceptable for ship, or do you want the engine to hard-skip pending concepts until a beat is authored?

---

## E. Stage C existence check

Live DB confirms: `curriculum_concepts`=24, `ki_curriculum`=148, `ki_curriculum_full`=148 (deep_linking), `curriculum_gates`=5, `user_competency`=0, `user_band_gate`=0. All six readable, no writes performed.
