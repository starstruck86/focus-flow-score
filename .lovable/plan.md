## Audit findings (reference only — no fixes)

### 1) /skills (Skills.tsx, 487 lines)
- Renders a 9-axis SPIDER radar via `useKiProficiency`.
- Tables read: `knowledge_items`, `ki_mastery`, view `ki_mastery_weekly`. **Does NOT read `user_competency`.**
- Real data, not stubbed — but sourced from legacy `/sharpen` mastery store, so blind to TRAIN v2 progress.
- Reachable in nav: yes — `BottomNav` trainNavItems (`/skills`, Target icon).

### 2) /progress (Progress.tsx, 368 lines)
- Shows per-dimension proficiency chart, weekly dojo session counts, learning lesson completion counts, 7-day rollups.
- Tables read: `dojo_sessions`, `learning_lessons`, plus `SPIDER_DIMENSIONS` constants. **Does NOT read `user_competency` or `streak_summary`.**
- Real data, not placeholder.
- Reachable in nav: NO — route exists, not in BottomNav. Deep-link only.

### 3) /brief (Brief.tsx, 451) and /meeting (MeetingMode.tsx, 453)
- Brief: pre-call ritual — pulls calendar event, account context, top KIs for the meeting type, warm-up rep prompt. Wired (auth + supabase calls).
- Meeting: in-call companion view (similar context surface). Wired.
- Both functional, not stubs.
- Neither in BottomNav — reachable via `ProactiveDaveCard` CTAs and direct URL.

### 4) Settings
- Route `/settings` → `Settings.tsx` (1235 lines). Yes, exists.
- Persists across many tables: `user_settings`, `work_schedule_config`, `daily_plan_preferences`, plus others touched by individual sub-panels.
- `user_settings` empty (0 rows) because writes only happen on opt-in toggles (e.g. `useIntensiveMode` upserts only when user flips Deal-Control Intensive). Nothing has been toggled.
- `WhoopIntegration` mounted ONLY here (`Settings.tsx` line 1153, imported line 40). No other surface.
- Confirmed runaway-insert bug: `AuthContext.tsx` does `maybeSingle` on `work_schedule_config` (no unique constraint) → on duplicate rows returns error → falls through to `insert` → loops every session refresh. Same pattern on `streak_summary` init in same function.

### 5) DB views
- **`branch_readiness`**: appears ONLY in `src/integrations/supabase/types.ts` as a `referencedRelation` FK target (~20 hits). **Zero app code queries it.** Dead from the client; useful only for DB joins/admin.
- **`resource_truth_drift`**: same — only in `types.ts` (~2 hits). **Zero app code queries it.** Dead client-side.

### 6) Recommenders — LIVE vs DEAD
- LIVE (rendered as JSX):
  - `TodaysFocus` — Dojo.tsx line 731
  - `PerformanceSignals` — Dojo.tsx line 805
  - `MasteryLanes` — Dojo.tsx
  - `DailyAssignmentCard` — Dojo.tsx
  - `ResumeLaneBanner` — Dojo.tsx
  - `PrimaryActionCard` — Learn.tsx
- DEAD (imported, never rendered):
  - `ProactiveDaveCard` — imported in Dojo.tsx line 30, no JSX usage. Orphan.

### 7) Pages in src/pages/ NOT in your list
- `BatchRegrade.tsx` — admin: bulk re-grade transcripts
- `Benchmark.tsx` — `/benchmark` 10-scenario baseline seeder
- `BulkExtractRunner.tsx` — admin: bulk KI extraction trigger
- `Cockpit.tsx` — alternate daily-ops view (parallel to Dashboard/Home)
- `Competitive.tsx` — `/competitive` competitive intel
- `CourseImportDetail.tsx`, `CourseImports.tsx` — Thinkific/course import UI
- `Diagnostics.tsx` — system diagnostics surface
- `DojoQA.tsx`, `DojoV6QA.tsx` — internal QA harnesses for Dojo flows
- `EnrichmentVerification.tsx` — KI canary review queue
- `ExecuteWorkspace.tsx` — strategy execution workspace
- `ExtractionAdmin.tsx` — extraction ops console
- `Home.tsx`, `Index.tsx` — landing routes (alongside Dashboard)
- `LearnLesson.tsx` — lesson player (deep route under Learn)
- `LifecycleReconciliation.tsx` — library reconciliation UI
- `ObservabilityDashboard.tsx` — telemetry dashboard
- `PhaseEvidenceRunner.tsx` — strategy phase evidence tool
- `PostCallLog.tsx` — `/post-call` post-call capture
- `ReliabilityQA.tsx` — reliability test harness
- `Settings.tsx` — settings (covered in Q4)
- `SignalInbox.tsx` — `/signals` triaged signal queue
- `Simulate.tsx` — `/simulate` conversation simulator
- `SkillBuilderAudit.tsx`, `SkillBuilderSession.tsx` — third practice surface, parallel to TRAIN v2 and `/sharpen`
- `SmokeTest.tsx` — smoke test runner
- `StrategyControlPanel.tsx`, `StrategyDebug.tsx`, `StrategyOpsPanel.tsx`, `StrategySettings.tsx` — strategy admin/ops
- `TerritorySetup.tsx` — territory profile setup
- `Trends.tsx` — `/trends` analytics over time
- `WeeklyReview.tsx` — `/weekly-review` retro
- `Auth.tsx`, `AccessDenied.tsx`, `NotFound.tsx` — boilerplate auth/error

### Cross-cutting surprises
- Three competing practice surfaces: TRAIN v2 (`/train/*`), legacy `/sharpen`, and `SkillBuilderSession`.
- Three daily-landing candidates: `Home.tsx`, `Dashboard.tsx`, `Cockpit.tsx`.
- Skills + Progress both blind to TRAIN v2's `user_competency`.
- 10+ routed pages (`/progress`, `/brief`, `/meeting`, `/benchmark`, `/post-call`, `/trends`, `/weekly-review`, `/simulate`, `/competitive`, `/signals`) are absent from BottomNav.
- `branch_readiness` and `resource_truth_drift` views are dead client-side.
- `ProactiveDaveCard` is imported but unmounted in Dojo.

Audit-only — no edits proposed.