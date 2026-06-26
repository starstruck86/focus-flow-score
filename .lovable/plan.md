
# Learner-tabs architecture & duplication map (read-only)

No code changes. Facts traced through `src/pages/{Dojo,Learn,Skills,Coach}.tsx`, `src/lib/train/*`, `src/lib/learning/*`, `src/hooks/{useKiProficiency,useTranscriptGrades,useDailyKI,useLearnLoop}.ts`, `supabase/functions/{dojo-score,grade-transcript,score-micro-drill,grade-lesson-response}/`, and live counts from `curriculum_concepts`, `ki_curriculum`, `knowledge_items`, `learning_lessons`, `transcript_grades`, `ki_mastery`, `user_competency`.

---

## 1. TRAIN (Dojo)

- **Page:** `src/pages/Dojo.tsx` → routes to `src/pages/train/TrainTopic.tsx` / `TrainAtom.tsx` / `TrainBandGate.tsx`.
- **"Train by Type" list** (`Dojo.tsx` lines 449–474) — hard-coded array, 5 buckets: Prospecting / Discovery / Deal Control / Stakeholder / Competitive. Each navigates to **`/sharpen`** with `state: { chapters: [...] }` — NOT to `/train/...`. Targets table **`knowledge_items.chapter`** (e.g. `cold_calling`, `messaging`, `discovery`, `closing`, `stakeholder_navigation`, `competitive`). **Does not touch `curriculum_concepts` / `ki_curriculum` at all.**
- **TRAIN v2 entry** (`Dojo.tsx` lines 747–794): 11 hard-coded Cards, all routing to `/train/product/<topic>` (deep_linking + 10 Product slugs). Reads `curriculum_concepts` + `ki_curriculum` via `src/lib/train/curriculum.ts` and `src/hooks/train/useSubLevelLadder.ts`. **377-concept curriculum is exposed only for `spoke='product'` (101 concepts); the other 377 concepts across 9 spokes are not surfaced anywhere in the UI.**
- **"Branch Prep Mode"** (`Dojo.tsx` lines 421–440): green card → `navigate('/sharpen', { state: { branchMode: true } })`. "586 KIs" comes from `useKISync` caching from `knowledge_items` where the Branch-relevant filter applies (chapter/spider_dimension subset cached to IndexedDB). Drill engine: `/sharpen` (legacy Dojo drill loop), scored by **`dojo-score`** edge function. Not connected to the `curriculum_concepts` ladder.

Live DB counts: `curriculum_concepts=478` across spokes `product(101) discovery(84) deal_control(67) messaging(50) objection_handling(46) stakeholder_navigation(45) qualification(25) competitive(24) expansion(24) c_suite(12)`; `ki_curriculum=3186` drill rows.

## 2. LEARN

- **Page:** `src/pages/Learn.tsx`.
- **The "54 lessons / Why Discovery Is the Highest-Leverage Selling Skill"** ships from tables `learning_courses (9) → learning_modules (22) → learning_lessons (54)` via `src/lib/learning/hooks.ts` (`useCourses`, `useUserProgress`) and `user_lesson_progress`. **This is a separate authored curriculum, not a view of TRAIN v2** (`curriculum_concepts` is never queried by Learn). Lesson grading uses edge function **`grade-lesson-response`**.
- **"Fix This Now" card:** `src/components/learn/PrimaryActionCard.tsx`, fed by `useLearnLoop` → `src/lib/learning/learnActionEngine.ts::getPrimaryLearnAction`. Reads `getLastRepInsights` (most recent `dojo_sessions` rep), `getFridayReadiness`, `getBlockRemediationPlan`, `getAdaptiveStudyPath`, and `daily_assignments` row. Targets either `/dojo/session` (legacy Dojo loop) or `/learn/lesson/:id`. Not aware of `/train/*`.
- Additional Learn surfaces: `useDailyKI` (daily KI assignment), `useSkillLevels`/`useSubSkillProgress` (computed off `dojo_sessions`/`ki_mastery`), `LessonGenerationPanel` (admin), `DaveActiveLoopCard` / `DaveLoopCompletionCard` (Dave voice loop state).

## 3. SKILLS

- **Page:** `src/pages/Skills.tsx`, hook `src/hooks/useKiProficiency.ts`.
- **Radar data sources:** axis library counts from `knowledge_items` (`is_core_ae=true AND active=true AND spider_dimension=<dim>`); user proficiency from **`ki_mastery`** (per-KI SRS rows: `times_drilled`, `avg_score`, `best_score`, `decay_risk`, `last_drilled_at`); real-call axis from **`dimension_scores`** view (derived from `transcript_grades`); trend from `ki_mastery_weekly`. **Does NOT read `user_competency` and does NOT read `curriculum_concepts`/`ki_curriculum`.**
- Axis formula: `proficiency = round(avg_score*0.7 + min(total_reps/50,1)*100 * 0.3)` per dimension.
- "23,022 KIs" header = `SELECT count(*) FROM knowledge_items WHERE is_core_ae=true AND active=true AND spider_dimension IS NOT NULL`. "2 Reps" = sum of `ki_mastery.times_drilled` for this user (DB shows `ki_mastery_rows=6`, `user_competency_rows=2`).

## 4. COACH

- **Page:** `src/pages/Coach.tsx`. Grade pipeline: `useGradeTranscript` → edge function **`grade-transcript`** (`supabase/functions/grade-transcript/index.ts`).
- **Stored in:** `transcript_grades` (live count 4). `grade-transcript` also (lines 932–1004) writes back through the spider-dimension recompute (feeds `dimension_scores` consumed by Skills) and `detect-knowledge-gaps`.
- **Feedback loop:** Coach → `transcript_grades` → spider recompute → **Skills radar outer ring** ("Real Calls"). Does NOT touch `user_competency`, does NOT advance `curriculum_concepts` bands, does NOT increment `ki_mastery`. So: Coach feeds Skills, but not TRAIN v2.
- Other surfaces in Coach: `PreCallCoach`, `DealIntelligence`, `WeeklyCoachingDigest`, `CoachingStreaks`, `AfterActionReview`, `WeeklyReviewPanel`, `SkillLabPanel`, `PatternDiagnosticsPanel`, `RecommendationAuditPanel`, `WeeklyPlaybookPracticeCard`, `selectNextKI`.

---

## A. Taxonomy mismatch (three category sets side by side)

| Train "by type" (Dojo card, hard-coded) | Skills radar axes (`SPIDER_DIMENSIONS`) | `curriculum_concepts.spoke` (live DB) |
|---|---|---|
| Prospecting (chapters: cold_calling, messaging, follow_up) | internal_prospecting + messaging | — (no `prospecting` spoke; `messaging` IS a spoke, 50 concepts) |
| Discovery (chapters: discovery, demo, qualification) | discovery + qualification | discovery (84), qualification (25) — split |
| Deal Control (chapters: closing, negotiation, objection_handling) | deal_control + objection_handling | deal_control (67), objection_handling (46) — split |
| Stakeholder (chapters: stakeholder_navigation, personas) | stakeholder_navigation | stakeholder_navigation (45) |
| Competitive (chapters: competitive, competitors) | competitive | competitive (24) |
| — | expansion_strategy | expansion (24) |
| — | c_suite_engagement | c_suite (12) |
| — | product_knowledge | product (101) — the only spoke surfaced in TRAIN v2 ladder |
| — (no UI) | messaging | messaging (50) |

Lined up on `competitive` and `stakeholder_navigation`. Diverges everywhere else: TRAIN-by-type lumps; Skills splits; `spoke` does both ("messaging" matches a radar axis but lives under the Prospecting card). `prospecting` exists only as `knowledge_items.chapter`; no spoke for it. `product` is a spoke but not a radar axis (radar calls it `product_knowledge`).

## B. True duplication vs re-view

**Genuinely separate implementations of the same concept (real duplication):**

1. **Two curricula.** `learning_courses/modules/lessons` (54 lessons) is an authored Learn curriculum. `curriculum_concepts/ki_curriculum` (478 concepts / 3,186 drills) is TRAIN v2. Different tables, different authoring tools, different graders (`grade-lesson-response` vs `dojo-score`). No cross-reference column joins them.
2. **Two drill loops with two trackers.** `/sharpen` (legacy Dojo, what "Train by Type" + "Branch Prep" launch) writes `ki_mastery` + `dojo_sessions`. `/train/*` (TRAIN v2 ladder) writes `user_competency` + `user_band_gate` AND `ki_mastery`. Same `dojo-score` edge function grades both, but progress lands in two different tables that no surface reconciles.
3. **Two "knowledge" surfaces for the same KIs.** `Dojo`'s 5-bucket "Train by Type" routes by `knowledge_items.chapter`; the TRAIN v2 ladder routes by `curriculum_concepts.spoke` (which is essentially a re-bucketing of the same KIs into a graded ladder). Both ultimately drill rows from `knowledge_items`.
4. **Two "next action" engines** (see C).

**Same data, different views (fine):**

- Skills radar vs Coach (radar's outer ring is just `transcript_grades` re-rolled into `dimension_scores`). One pipeline, two presentations.
- Learn's daily KI card vs Dojo's `DailyAssignmentCard` — both read `daily_assignments` (the SSOT per project memory). One source, two surfaces.

## C. "Do this next" engines

Each independent source of "what should I do":

1. **`TodaysFocus`** (`components/dojo/TodaysFocus.tsx`) — reads `daily_assignments` + `skillStats` (`useDojoStats`).
2. **`DailyAssignmentCard`** — reads `daily_assignments`.
3. **`ProactiveDaveCard`** — reads Dave conversation state + `useDaveContext` (calendar, KIs, recent rep).
4. **`ResumeLaneBanner`** — reads `sessionDurability` localStorage (last interrupted Dojo lane).
5. **`MasteryLanes`** — reads `useSkillLevels` + `useSubSkillProgress` (derived from `dojo_sessions` + `ki_mastery`).
6. **`TrainingModes`** — heuristic on `skillStats` + `skillMemory`.
7. **`MicroDrillSession`** (auto-triggered) — `useDailyKI` + `score-micro-drill` edge function.
8. **`PerformanceSignals`** — `skillStats` + `coachingInsights` + `skillMemory.progressSignals`.
9. **Branch Prep Mode card** (Dojo) — static + `useKISync` cache state.
10. **`PrimaryActionCard` / "Fix This Now"** (Learn) — `useLearnLoop` → `learnActionEngine.getPrimaryLearnAction` (7-priority ladder pulling from `dojo_sessions`, `daily_assignments`, `getFridayReadiness`, `getBlockRemediationPlan`, `getAdaptiveStudyPath`).
11. **Skills page recommender** (`selectNextKI` on dimension click) — `src/lib/dojo/selectNextKI.ts` reading `ki_mastery` weakness.
12. **Coach `CoachingFocus` + `AfterActionReview`** — derived from `transcript_grades`.
13. **`WeeklyPlaybookPracticeCard`** (Coach) — `playbook_usage_events` + weakest playbook.
14. **TRAIN v2 ladder itself** — `useSubLevelLadder` deciding which sub-level/gate is "available" via `user_competency`/`user_band_gate`.
15. **`useDailyDigest` / `useMomentumEngine`** — additional dashboard-level recommenders.

**Count: ~15 independent recommenders across 4 tabs, with no shared "next action" arbiter.** They read at least 8 different tables (`dojo_sessions`, `daily_assignments`, `ki_mastery`, `user_competency`, `transcript_grades`, `learning_lessons`/`user_lesson_progress`, `playbook_usage_events`, `dimension_scores`).

## D. Consolidation verdict (most redundant first)

**Highly redundant — candidates to merge or retire:**

1. **"Train by Type" buckets vs TRAIN v2 ladder.** Same intent (route a learner into a topic). One bypasses the 377-concept curriculum entirely and points at the legacy `/sharpen` loop. Either delete the by-type buckets, or rewrite them to navigate to `/train/<spoke>/<topic>` for the 9 unexposed spokes (which currently have no UI entry at all).
2. **`/sharpen` (legacy Dojo) vs `/train/*` (TRAIN v2).** Two parallel drill loops on the same KI substrate writing two different progress stores. Pick one as canonical; collapse the other into it. `user_competency` is the more structured store; `ki_mastery` is the SRS layer — they should coexist as different aggregations of one rep stream, not as two parallel loops.
3. **Learn's 54 authored lessons vs `curriculum_concepts.teach_beat_md`.** TRAIN v2 already carries authored teach beats per concept. The Learn course tree (`learning_courses/modules/lessons`) is a second, smaller, parallel authoring system. Either retire `learning_courses` or back it onto `curriculum_concepts` (a Learn "lesson" = a TRAIN sub-level's teach beats).
4. **The 15 "do this next" widgets.** At minimum, `TodaysFocus`, `DailyAssignmentCard`, `PrimaryActionCard`, `ProactiveDaveCard`, `ResumeLaneBanner` overlap heavily. Collapse to a single Next-Action service (one engine, one card; other surfaces become contextual previews).
5. **Branch Prep Mode card.** Functionally a filter on `knowledge_items` routed through `/sharpen`. If `/sharpen` is retired (item 2), Branch Prep collapses to a spoke filter on the TRAIN ladder.
6. **`grade-lesson-response`, `score-micro-drill`, `score-original-response`, `dojo-roleplay-score`, `dojo-review-score` vs `dojo-score`.** Six grading edge functions. `dojo-score` is the canonical one already used by TRAIN v2 and `/sharpen`. The others are vestiges of older loops; most can be retired or made to delegate.

**Genuinely distinct — should stay separate:**

- **Coach (`transcript_grades` + `grade-transcript`).** Real-call grading is a different signal from practice-rep grading; storing it separately and surfacing it as the outer radar ring is correct.
- **Skills (Proficiency Map).** Pure read-view over `ki_mastery` + `dimension_scores`. Not duplicative; it's the only cross-dimension rollup.
- **`user_competency` / `user_band_gate`.** The only band/sub-level/gate-aware store. Has no duplicate (Learn's `user_lesson_progress` is at lesson granularity, not band granularity).
- **`daily_assignments`.** Per project memory, the SSOT for daily work. Keep.

**Net:** the most concrete duplication is **two curricula** (Learn vs TRAIN v2), **two drill loops** (`/sharpen` vs `/train/*`) writing **two progress stores** (`ki_mastery` vs `user_competency`), and **~15 recommenders** with no shared arbiter. Coach and Skills are not duplicates of each other or of TRAIN.

---

This is a report only; no implementation. Want a consolidation plan next (e.g. retire `/sharpen` + collapse Learn lessons onto `curriculum_concepts` + unify recommenders), say the word and I'll draft one.
