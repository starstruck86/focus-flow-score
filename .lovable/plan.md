
# TRAIN Learner Loop — Read-Only Audit

No files changed. Findings only. File:line evidence inline.

---

## 1. TrainAtom flow

**(a) Concept whose `teach_beat_md` is NULL (the 92% case) — is there a teach step?**

Yes, there is almost always a teach step. Ladder in `src/lib/train/curriculum.ts:220-236`:

- `teach_beat_status = 'pending'` → `kind: 'pending'` with a provisional first drill.
- `teach_kind = 'authored' && teach_beat_md` → `kind: 'authored_md'` (this is the 8% path).
- `teach_kind = 'authored' && teach_beat_ref` → `kind: 'authored'` (legacy ref).
- `teach_kind = 'ki_exemplar' && exemplarKi` → `kind: 'ki_exemplar'` with `modelLine = concept.model_line_plain ?? exemplarKi.example_usage`.
- fallback → `pending` provisional.

So for the 92% (`teach_beat_md IS NULL`):
- If the concept is `ki_exemplar` with a linked exemplar KI → user sees the **Concept beat** (title + why_it_matters + when_to_use, `TrainAtom.tsx:335-351`) then the **Elite beat** (model line + when_not_to_use, `TrainAtom.tsx:404-419`).
- If it's `authored` with no `teach_beat_md` and no `teach_beat_ref` → falls through to `pending` provisional with the "coming soon" amber card (`TrainAtom.tsx:365-369`), then drills.
- The teach step is CONDITIONALLY skipped by `TrainAtom.tsx:57-63`: `hasConceptBeat` is false only if the exemplar has none of `why_it_matters`/`when_to_use`/`title`. In that case the atom starts on the **Elite beat**, and if that's also empty (`hasEliteBeat` false, `line 63`) it goes straight to **Situation** via `startDrilling()`.

So: **there IS a teach step for exemplar concepts (majority), driven off the KI's own fields, not off `teach_beat_md`.** The 92% figure only affects whether the concept renders authored markdown vs. hydrated KI fields — it does NOT bypass teaching.

**(b) What is sent to the grader on drill submit?**

Path: `TrainAtom.handleSubmit → runPracticeRep → scoreRep → POST ${SUPABASE_URL}/functions/v1/dojo-score` (`src/lib/train/engine.ts:90-97`).

Body (`engine.ts:69-88`):
```
scenario: { skillFocus: topic, context: ki.when_to_use ?? 'Enterprise sales scenario.', objection }
userResponse
ki: { title, tactic_summary, when_to_use, when_not_to_use, why_it_matters }   // practice mode only
```
- `objection` = `ki.scenario ?? ki.when_to_use ?? 'Respond to this buyer situation.'` (`engine.ts:137-141`), where `ki.scenario` comes from `ki_curriculum_full.drill_scenario` (`curriculum.ts:111,161`).
- `example_usage` is **intentionally stripped** (`engine.ts:83`) and a poisoning guard blocks objections that equal it (`engine.ts:65-67`, mirrored server-side at `dojo-score/index.ts:425-434`).
- **`model_line_plain` is NOT sent to the grader.** It's only used client-side as the "How an elite AE handled it" reveal in feedback (`TrainAtom.tsx:265-272`) and as the modelLine on the Elite beat.
- **`drill_model_answer` / `drill_rubric` are NOT read anywhere** — no reference in `curriculum.ts`, `engine.ts`, or `dojo-score`.
- The grader's "gold" is the built-in `RUBRICS[skill]` (`dojo-score/index.ts:66,444` — fallback `objection_handling`) plus whatever tactic context leaks through `ki.tactic_summary`/`when_to_use`. No per-drill gold, no model answer.

---

## 2. Rep / pass semantics (`src/lib/train/competency.ts`)

**Progress is per SUB-LEVEL, not per concept.**

- Upsert key is `(user_id, spoke, topic, sub_level)` (`competency.ts:23-30, 63`). No `concept_id` column on `user_competency` (`types/train.ts:88-98`).
- Required = `TRAIN_TUNABLES.subLevelRequiredPasses` = **3** (constant, `types/train.ts:141`). The old `drillCountInSubLevel` input is ignored (`competency.ts:37-40`, comment "drillCountInSubLevel is AVAILABLE reps, not REQUIRED").
- A pass = score ≥ `subLevelPassThreshold` = **85** (`types/train.ts:142`).
- Progress formula (`competency.ts:42-45`): `passingRepsApprox = round(prevProgress * 3) + (passed ? 1 : 0); nextProgress = min(1, passingRepsApprox / 3)`.
- `gate_passed_at` is stamped once when `nextProgress >= 1` (`competency.ts:52-58`). This is the sub-level completion marker.

**What advances sub_level → next sub_level?**

Nothing automatic. `gate_passed_at` is written on the sub-level row but there is no writer that promotes the user to the next `sub_level`. Sub-levels are ordered rows in `curriculum_concepts`; the LADDER UI (`TrainTopic.tsx`, `useSubLevelLadder`) reads all sub-levels + user_competency rows and simply displays which are complete. There is no `user_state.current_sub_level` pointer.

**What does a completed sub_level "do"?**

Two effects, both cosmetic/gating:
- The daily ladder skips it: `dailyLadder.ts:151` — `if (progress >= 1) continue`.
- The `TrainTopic` ring shows it complete.
It does NOT unlock anything. The only real unlock in TRAIN is BAND-level, and that's gated by `user_band_gate.status === 'passed'` (`dailyLadder.ts:110-114`, `useSubLevelLadder`), driven by the band gate flow — not by completing sub-levels.

So: you can pass a Band 1 gate without ever completing the Band 1 sub-levels, and finishing all Band 1 sub-levels does not unlock Band 2. **The sub-level and band-gate systems are decoupled.**

---

## 3. `dailyLadder.getNextDueCurriculum`

**(a) Cold start (empty `user_competency`)**

`dailyLadder.ts:65-77` loads ALL `curriculum_concepts` for the user (every spoke, every topic). Order in SQL: `spoke asc, topic asc, band asc, sub_level asc, order_in_sublevel asc`.

Per topic (`ts:96-166`):
- Band 1 always unlocked (`ts:106-110`).
- Walks sub-levels in order, picks the FIRST concept in the first incomplete sub-level (`ts:145`), one pick per topic.
- Cold start → every topic in every spoke yields a Band 1 candidate with `rank = 2*10+1 = 21` (`ts:161`, `inProgress ? 1 : 2`).

Then spoke spreading (`ts:172-193`): iterates candidates, takes at most one per spoke first, then fills the rest with reserves.

So cold start with `limit=5` returns **5 Band-1 items across 5 different spokes**, in alphabetical spoke order (product, deal_control, discovery, … depending on `spoke` string sort). **No frequency×importance weighting anywhere** — no calls to any priority/weighting function, no read of KI usage, no coverage scoring. Just alpha spoke/topic order with a spread heuristic.

**(b) New vs review mix**

- Retests (band gates whose `next_retest_due <= now`) get `rank = 0` (highest priority) (`ts:114-129`).
- In-progress sub-levels (`0 < progress < 1`) get `rank = 10 + band` (`ts:161`).
- New / not-started sub-levels get `rank = 20 + band`.

So review (retest + in-progress) sorts ahead of new. There's no ratio target — if you have 5 retests due, they fill the ladder.

**(c) `ki_mastery.next_review_at`?**

**Not consulted.** `dailyLadder.ts` only reads `curriculum_concepts`, `user_competency`, `user_band_gate`. No `ki_mastery` read. Per-KI SRS still runs (`engine.ts:151-162`) but its `next_review_at` never influences daily selection.

---

## 4. Gate flow

**Route:** `src/App.tsx:279` — `/train/:spoke/:topic/gate/:band → TrainBandGate` (lazy). Working page.

**Runner:** `src/pages/train/TrainBandGate.tsx`. Per-item flow: `submitItem` calls `scoreRep({ ki: null })` (`TrainBandGate.tsx:88-115`) — cold call to `dojo-score` with no KI payload. Same grader as drills, just no `ki` block (`engine.ts:79`).

**Writer to `user_band_gate`:** `TrainBandGate.tsx:134-140` → `recordBandGateAttempt` (`competency.ts:90-142`). That function:
- Upserts on `(user_id, spoke, topic, band)` (`competency.ts:130`).
- Writes `status`, `attempts++`, `best_score = max(prev, avg)`, `passed_at` (once), `last_attempt_at`, `next_retest_due`.
- On pass with `promotes_to`, upserts the next band row with `status='available'` (idempotent, `competency.ts:145-165`).

**`next_retest_due` logic:** `competency.ts:83-85` — `retestDays(passed) = passed ? TRAIN_TUNABLES.retestPassDays (30) : 0`. Fail returns `now`. Written unconditionally at `competency.ts:120`.

**Anti-decay / retest enforcement:** Only surfaces through the daily ladder — `dailyLadder.ts:48-51, 114-129` promotes any band whose `next_retest_due <= now` to a `retest` candidate with rank 0. There is NO decay of `best_score`, NO downgrade of `status`, NO revocation of band unlock, and nothing forces the user to take the retest. It's simply the top-ranked pick in the daily list.

**Who wrote the single existing `user_band_gate` row?**

`recordBandGateAttempt` is called from exactly two places:
- `src/pages/train/TrainBandGate.tsx:134` (the gate UI).
- `src/lib/train/engine.ts:248` inside `runBandGate` (batch runner — but grep shows no caller of `runBandGate` in the app; it's legacy from the pre-linear-flow gate implementation).

So the existing row was almost certainly written by the TrainBandGate UI, on a manual gate attempt.

---

## 5. `/train` home — motivation surfaces

`src/pages/train/TrainHome.tsx` (61 lines, full file already in context). It renders:
- Header "Train / Full curriculum · 10 spokes …" (`:16-22`).
- Loading/error states.
- One card per spoke via `useTrainCatalog()` showing `spoke label`, `topicCount`, `conceptCount` (`:34-56`).

**No completion %, no belts, no streaks, no ring, no accomplishment surface, no next-due preview.** Just a spoke list. Progress lives elsewhere: `DailyLadderCard` and `AccomplishmentDashboard` are mounted on the **Dojo** home (`src/pages/Dojo.tsx`), not on `/train`. The `/train` page itself is a bare index.

---

## 6. Placement / onboarding / test-out

Grep of `src/` and `supabase/` for `placement|test.?out|seedCompetency|skip.?band|self.?assess` (results above) — **zero hits** related to TRAIN. No seeder writes `user_competency` at signup, no placement flow, no "start above Band 1" affordance.

The only ways any `user_competency` or `user_band_gate` row gets created:
- `incrementSubLevelRep` (drill rep) — creates a sub-level row.
- `recordBandGateAttempt` (band gate attempt) — creates a band row; on pass, seeds `promotes_to` band with `status='available'`.

Therefore the **only way to reach Band 2+ is to pass the Band 1 gate sequentially**, and the Band 1 gate is directly reachable at `/train/:spoke/:topic/gate/1` from `TrainTopic` because Band 1 is always considered unlocked (`useSubLevelLadder`/`dailyLadder.ts:107`, `TrainBandGate.tsx:52`). So a user can technically walk straight into the Band 1 gate without doing any drills, but they cannot skip a gate.

---

## Summary of structural gaps observed (no fixes proposed here)

- Grader is **rubric-only**; `model_line_plain` and any authored `drill_model_answer`/`drill_rubric` are unused as gold.
- Sub-level progress and band unlock are **decoupled** — finishing all Band 1 sub-levels does not unlock Band 2; passing the Band 1 gate does, regardless of sub-level progress.
- Daily ladder cold-start is **alphabetical, unweighted**, ignores `ki_mastery.next_review_at`.
- Band-gate anti-decay = a nudge in the daily ladder, no enforcement.
- `/train` home has **no progress/motivation surface** — those all live on `/dojo`.
- **No placement, no test-out, no seeding**; only sequential gate passes unlock higher bands.
