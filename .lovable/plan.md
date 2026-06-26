# LOOP Subsystem Audit (READ-ONLY)

No code changes. The headline finding is the `work_schedule_config` insert bug — a self-compounding leak on every login.

---

## 1. Surface & Reachability

| Concept | Route(s) | Page component | Trigger |
|---|---|---|---|
| Daily dashboard | `/today`, `/dashboard` | `src/pages/Dashboard.tsx` | landing surface |
| Tasks list | `/tasks`, `/recurring` | `Tasks.tsx`, `RecurringTasks.tsx` | Work-mode nav |
| Daily journal (modal) | inline modal — no route | `components/journal/DailyScorecardModal.tsx`, `QuickLogModal.tsx`, `ConfirmYesterdayModal.tsx`, `JournalPromptManager.tsx` | opened from `GlobalWeekStrip` (top of Dashboard) or `J` hotkey |
| Week journal strip | global | `GlobalWeekStrip.tsx` → `WeekStrip.tsx` | rendered above Dashboard |
| Daily training assignment | `/dojo` | `src/pages/Dojo.tsx` → `components/dojo/DailyAssignmentCard.tsx` | Train-mode nav |
| Today's calendar | `/today` (cards) + `/meeting` | `Dashboard.tsx`, `MeetingMode.tsx` | inline |
| Pre-call brief | `/brief` | `Brief.tsx` | |

Daily user loop: morning ConfirmYesterdayModal → review Dashboard (calendar, tasks, hygiene, priorities) → Dojo daily assignment → EOD `DailyScorecardModal` (or `QuickLogModal`) → save `daily_journal_entries`. **No `/journal` route exists** — the journal is entirely modal-based. Note `JournalPromptManager` literally states *"NO auto-popups. The journal is accessed inline via JournalDashboardCard or keyboard shortcut (J)."*

Reachability via `BottomNav` Work mode (Tasks, Dashboard) and Train mode (Dojo).

---

## 2. `work_schedule_config` BUG — confirmed self-compounding insert

### The bug (verbatim)

```ts
// src/contexts/AuthContext.tsx:15-38
async function initializeUserData(userId: string) {
  try {
    // Check if work_schedule_config exists
    const { data: existingConfig } = await supabase
      .from('work_schedule_config')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();              // ⚠ errors when > 1 row exists

    if (!existingConfig) {
      await supabase.from('work_schedule_config').insert({   // ⚠ INSERT, not UPSERT
        user_id: userId,
        working_days: [1, 2, 3, 4, 5],
        reminder_enabled: true,
        …
      });
    }
    …
  } catch (error) {
    console.warn('Failed to initialize user data:', error);   // ⚠ error swallowed
  }
}
```

`initializeUserData` is called from `AuthProvider`'s session listener (every fresh sign-in / token refresh / new tab). Each invocation:

1. `.maybeSingle()` against `user_id` with multiple rows present → PGRST114 error.
2. The destructure ignores `error`; `existingConfig` is `null`.
3. `.insert(...)` adds another row → next check finds even more rows → error again → insert again.
4. `catch` swallows everything.

The table has **no unique constraint on `user_id`**, so each insert succeeds. There is no `upsert` and no `onConflict` anywhere on this table. Result: ~28 new rows/day matches Auth session refresh cadence (mobile + desktop + tab refreshes).

### Reads — also fragile

All three readers select without filtering by `user_id`, depending purely on RLS, and use `.limit(1).maybeSingle()`:

```ts
// src/hooks/useStreakData.ts:83-87  (useWorkScheduleConfig)
await supabase.from('work_schedule_config').select('*').limit(1).maybeSingle();
```

```ts
// src/hooks/useStreakData.ts:329-333  (useUpdateConfig)
const { data: current } = await supabase
  .from('work_schedule_config').select('id').limit(1).single();
// then .update().eq('id', current?.id)   ← only touches one of the 2,639 rows
```

```ts
// src/hooks/useDailyJournal.ts:341-345  (useJournalPromptStatus)
await supabase.from('work_schedule_config')
  .select('eod_checkin_time, …').limit(1).maybeSingle();
```

So even with thousands of rows the reader returns a single arbitrary row, masking the leak. Settings saved via `useUpdateConfig` only mutate one random row — the rest become stale duplicates.

### Server-side reader (also affected)

```ts
// supabase/functions/schedule-daily-plan/index.ts:21-23
const { data: prefUsers } = await adminClient
  .from("daily_plan_preferences").select("user_id");
```
(That one is fine — different table — but `work_schedule_config` reads server-side share the same fragility pattern in other functions.)

### Why ~28/day on 2 users

`AuthProvider` re-fires `initializeIfNeeded` on every fresh `SIGNED_IN`/refresh event. Two users × multiple devices × Supabase token refresh (~1 h) × tab opens → easily 14 boots/user/day → 28 inserts/day.

**Fix shape (NOT applied):** add a unique constraint on `user_id`, replace `.insert(...)` with `.upsert({…}, { onConflict: 'user_id' })`, add `.eq('user_id', user.id)` to all readers, and dedupe the existing rows.

---

## 3. Calendar Sync (terse)

`supabase/functions/sync-calendar/index.ts` pulls an **Outlook ICS feed** (`OUTLOOK_ICS_URL` secret, confirmed line 600). Parses ICS → upserts `calendar_events` keyed on `external_id` (UID from VEVENT). Not Google Calendar, no MCP connector. Driver: `useSyncCalendar` / `useAutoSyncCalendar` in `src/hooks/useCalendarEvents.ts` — runs on app boot if last sync > 1 hour. Also `parse-calendar-screenshot` for manual paste import. The 1,130 events / June 2025–Sept 2026 spread is consistent with a working ICS feed.

---

## 4. LOOP → TRAIN bridge (`daily_assignments`) (terse)

Generated by `src/lib/dojo/v3/assignmentManager.ts::getOrCreateTodayAssignment`. Once per user per day (DB unique constraint). Inputs: active block (`blockManager`), skill memory, last 7 assignments, KI catalog (`kiCatalogBridge`). Authoritative comment at top: *"daily_assignments is the SSOT for Dojo/Learn."* Consumed only by `Dojo.tsx` via `DailyAssignmentCard.tsx`.

**It does NOT advance `user_competency`.** That table is written only by TRAIN v2 (`src/lib/train/competency.ts::incrementSubLevelRep`, confirmed in earlier audit). DailyAssignment surfaces KI/scenario IDs as the day's curated drill set, but tapping them routes into the **legacy `/dojo/session` and `/sharpen` loops** (which write `ki_mastery` only). Completing the daily assignment therefore does **not** progress the Train spoke ladder. The two systems share `knowledge_items` IDs but live in parallel — exactly the duplication flagged in the consolidation audit.

---

## 5. Daily Journal (terse)

- **Writers:** `useSaveJournalEntry` (DailyScorecardModal full 3-step form) and `QuickLogModal` (5-field shortcut), both in `src/hooks/useDailyJournal.ts` (`upsert` on `(user_id, date)`).
- **Flow:** Morning → `ConfirmYesterdayModal` (read-only confirm). EOD → `DailyScorecardModal` 3 steps: Activity (dials/meetings/opps/prospecting block mins/focus mode) → Preparedness (calls prepped tomorrow) → Recovery (sleep/energy/stress/focus/clarity/distractions/context-switching). Optional `QuickLogModal` for fast log. `JournalPromptManager` has auto-popups **disabled** by design.
- **Scoring** — `calculateJournalScores` in `useDailyJournal.ts:125-151`:
  - `dailyScore = calculateDailyPoints(rawInputs)` (activity-weighted points)
  - `salesStrain = calculateSalesStrain(rawInputs, activityInputs, recoveryInputs)`
  - `salesRecovery = calculateSalesRecovery(recoveryInputs)`
  - `salesProductivity = calculateSalesProductivity(rawInputs, activityInputs, dailyScore)`
  - `goalMet = dailyScore >= 8 || productivity >= 75`
- **WHOOP tie:** none in the scoring path. `whoop_daily_metrics` is read by `useWhoopPatterns` / `useGoodDayMetrics` for trend overlays and by `weekly-patterns` edge function, but is **not fed into** `calculateJournalScores` — they're parallel datasets surfaced side-by-side in Trends/WeeklyReview, not combined.

---

## 6. Tasks (terse)

`src/pages/Tasks.tsx` (+ `tasks/*` components). Plain `tasks` table CRUD via `useDataSync.ts`. Auto-generation: `extract-tasks` edge function (parses transcripts/screenshots into task drafts) and `useSignalTriggeredTasks` (signals → tasks). Dave tools (`components/dave/tools/tasks.ts`) read/write tasks. **No Todoist** anywhere (grep: 0 hits). Self-contained.

---

## 7. End-to-end / Dead / Legacy

- **Working:** Calendar sync (Outlook ICS), journal modals, dashboard, tasks CRUD, daily training assignment generation.
- **Broken:** `work_schedule_config` insert leak — silent, settings updates land on a random duplicate row.
- **Architectural break:** DailyAssignment doesn't write `user_competency` → "completing today's training" doesn't move the Train ladder.
- **Dead-ish:** `JournalPromptManager` exists but auto-prompts disabled per its own header comment; only kept for programmatic triggers.
- **Legacy content:** `rg "lifecycle|martech|acoustic|loyalty|campaign"` against journal/time-block/journal-nudge surfaces returns 0 hits. **The LOOP subsystem is the only audited area so far with no Acoustic contamination.**

---

## Recommended follow-ups (not executed)

1. Fix `work_schedule_config` writer — add `UNIQUE(user_id)` constraint, switch to `upsert({…}, { onConflict: 'user_id' })`, scope reads with `.eq('user_id', user.id)`, dedupe existing rows.
2. Make `AuthProvider` initialization idempotent (track `initializedUserRef` was already added but the error path still re-fires).
3. Decide on the DailyAssignment ↔ TRAIN v2 bridge: either route daily-assignment drills through the TRAIN v2 atom flow (so they advance `user_competency`), or accept that DailyAssignment is a "warm-up loop" decoupled from ladder progress and label it as such.
4. Optional: pipe WHOOP recovery into `calculateSalesRecovery` so the "Sales Recovery" axis isn't ignoring physiological data already in the DB.
