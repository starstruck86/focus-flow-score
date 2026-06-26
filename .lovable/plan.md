## Final sweep — overlooked surfaces

### 1) /skills (Skills.tsx, 487 lines)
- Radar = 9 SPIDER_DIMENSIONS from `useKiProficiency`, which reads **`knowledge_items` + `ki_mastery`** (legacy `/sharpen` store) and `ki_mastery_weekly` view. **Does NOT read `user_competency` (TRAIN v2)**. So Skills radar reflects only legacy `/sharpen` drills + transcript-signaled mastery, not TRAIN v2 progress.
- Reachable: yes, in `BottomNav` trainNavItems (`/skills`, Target icon).
- Real data, not stub — but **wrong source-of-truth post-TRAIN-v2**.

### 2) /progress (Progress.tsx, 368 lines)
- Reads `dojo_sessions`, `learning_lessons` counts, plus per-user 7-day rollups. Uses `SPIDER_DIMENSIONS`. **Does NOT read `user_competency` or `streak_summary`.** Real data, but again misses TRAIN v2 competency store.
- Reachable via `/progress` route; not in `BottomNav` — orphaned from primary nav (only deep-linked).

### 3) /brief (Brief.tsx, 451) & /meeting (MeetingMode.tsx, 453)
- Both wired with auth + Supabase calls (calendar/account context + KI fetch). Functional pre-call/in-call surfaces. Not stubs. Not in `BottomNav` — reachable only via `ProactiveDaveCard` CTAs and route URL.

### 4) Settings
- `/settings` → `Settings.tsx` (1235 lines). Mounts **`WhoopIntegration`** (the connect UI lives here only). Persists into `user_settings`, `work_schedule_config`, `daily_plan_preferences`, etc.
- `user_settings` table empty (0 rows) despite UI writes — likely because writes are wrapped in `(supabase as any).from('user_settings').upsert(...)` in `useIntensiveMode` and similar; either RLS is rejecting or no user has toggled anything. Not a crash, just unused.
- `work_schedule_config` runaway-insert bug confirmed (`AuthContext.tsx` maybeSingle → insert loop). Same pattern likely on `streak_summary` init.

### 5) Views
- **`branch_readiness`** — appears ONLY in `src/integrations/supabase/types.ts` as a FK target (referencedRelation). **No app code queries it.** Dead from the client; exists for DB joins/admin only.
- **`resource_truth_drift`** — same: only in types.ts. **Not queried by app.** Dead client-side.

### 6) Recommenders — LIVE vs DEAD
- LIVE (rendered): `TodaysFocus` (Dojo), `PerformanceSignals` (Dojo), `MasteryLanes` (Dojo), `DailyAssignmentCard` (Dojo), `ResumeLaneBanner` (Dojo), `PrimaryActionCard` (Learn).
- **DEAD: `ProactiveDaveCard`** — imported in `src/pages/Dojo.tsx` line 30 but **never rendered as JSX**. Orphan.
- (PrimaryActionCard appears only in Learn, not Dojo — fine, but worth noting Dojo has no equivalent "one next action" hero card now.)

### 7) Overlooked pages (in src/pages/ not in your list)
- `BatchRegrade.tsx` — admin batch regrade UI
- `BulkExtractRunner.tsx` — admin bulk extraction trigger
- `Cockpit.tsx` — alt daily view (separate from Dashboard/Today)
- `CourseImportDetail.tsx`, `CourseImports.tsx` — Thinkific/course importer surface
- `Diagnostics.tsx` — system diagnostics
- `DojoQA.tsx`, `DojoV6QA.tsx` — internal QA harnesses for Dojo
- `EnrichmentVerification.tsx` — KI canary review queue
- `ExecuteWorkspace.tsx` — strategy execution workspace
- `ExtractionAdmin.tsx` — extraction ops
- `LearnLesson.tsx` — lesson player (deep route)
- `LifecycleReconciliation.tsx` — library reconciliation
- `ObservabilityDashboard.tsx` — telemetry dashboard
- `PhaseEvidenceRunner.tsx` — strategy phase evidence tool
- `PostCallLog.tsx` — post-call capture (signals/next-steps)
- `ReliabilityQA.tsx` — reliability test harness
- `SignalInbox.tsx` — `/signals` triaged signal queue
- `Simulate.tsx` — `/simulate` conversation simulator
- `SkillBuilderAudit.tsx`, `SkillBuilderSession.tsx` — separate Skill Builder flow (parallel to TRAIN v2 / `/sharpen` — **third practice surface**)
- `SmokeTest.tsx` — smoke runner
- `StrategyControlPanel.tsx`, `StrategyDebug.tsx`, `StrategyOpsPanel.tsx` — strategy admin
- `TerritorySetup.tsx` — territory profile setup
- `Trends.tsx` — `/trends` analytics over time
- `Benchmark.tsx` — `/benchmark` baseline benchmark (10-scenario seed)
- `WeeklyReview.tsx` — `/weekly-review` retro
- `Competitive.tsx` — `/competitive` intel
- `Coach.tsx`, `Dashboard.tsx`, `Home.tsx`, `Index.tsx` — already discussed
- `Auth.tsx`, `AccessDenied.tsx`, `NotFound.tsx` — boilerplate

### Notable surprises
- **Third practice surface**: `SkillBuilderSession` (separate from `/sharpen` legacy and TRAIN v2) — adds to fragmentation count.
- **`Cockpit.tsx` vs `Dashboard.tsx` vs `Home.tsx`** — three daily-landing candidates.
- **`branch_readiness` + `resource_truth_drift` views never queried** — dead infra.
- **`ProactiveDaveCard` imported but unmounted** in Dojo (after recent refactor presumably).
- **Skills & Progress both blind to TRAIN v2** (`user_competency`).
- **`/progress`, `/brief`, `/meeting`, `/benchmark`, `/post-call`, `/trends`, `/weekly-review`, `/simulate`, `/competitive`, `/signals`** all routed but absent from `BottomNav` — only reachable via CTAs/URL.

---

**Question:** which of these do you want addressed first? Candidates: (a) point Skills/Progress at `user_competency`, (b) consolidate SkillBuilder vs Sharpen vs TRAIN v2, (c) remove dead `ProactiveDaveCard` import + dead views, (d) fix `work_schedule_config`/`streak_summary` runaway inserts, (e) surface orphaned routes in nav, or (f) leave as audit-only and move on.