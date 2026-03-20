

# Dave Data Sync & Resilience — Expanded Fix Plan

## Problem Summary
Dave writes directly to the database via Supabase, but the UI reads from an in-memory Zustand store. These two data stores are completely disconnected for **daily metrics** and **partially disconnected** for CRM entities. This causes:
- "Log 5 dials" via Dave → DB updated, Activity Rings still show 0
- Tasks created by Dave don't appear in the task list until page reload
- Accounts/opps updated by Dave don't reflect in UI until refresh
- No journal hydration from DB on app load

## Root Cause Analysis

### Data Flow Gap: Daily Metrics (the user's reported bug)

```text
Dave: "Log 5 dials"
  → clientTools.update_daily_metrics
    → writes to daily_journal_entries table (DB)
    → shows toast "Dials updated: 0 → 5"
    → DONE (no Zustand update, no event)

Activity Rings read from:
  → useStore().currentDay.activityInputs.dials  (Zustand, still 0)
  → NEVER reads from daily_journal_entries

Manual ring tap:
  → updates Zustand store only
  → DataSync does NOT sync daily_journal_entries (only accounts/opps/renewals/contacts/tasks)
  → Value lost on reload
```

### Data Flow Gap: CRM Entities (tasks, accounts, opps)
Dave's `create_task`, `update_account`, `move_deal`, `complete_task`, `create_opportunity`, `smart_debrief`, `create_account`, `add_contact`, `log_touch`, `update_renewal`, `update_methodology`, `bulk_update` all write directly to the DB, bypassing Zustand. The UI won't reflect changes until the next full page reload triggers DataSync hydration.

## What's Missing (6 Issues)

### Issue 6 (HIGH): Daily metrics — Dave writes to DB, Rings read from Zustand
Dave's `update_daily_metrics` writes to `daily_journal_entries`. Activity Rings and MomentumHeader read from `currentDay.activityInputs` / `currentDay.rawInputs` in Zustand. There's zero bridge between them.

**Fix — 3 parts:**

**A. Hydrate Zustand from DB on load** — In `useDataSync.ts`, after hydrating accounts/opps/etc., also fetch today's `daily_journal_entries` row and call `updateActivityInputs()` / `updateRawInputs()` with DB values.

Field mapping:
| DB column | Store path |
|---|---|
| `dials` | `activityInputs.dials` |
| `conversations` | `rawInputs.coldCallsWithConversations` |
| `manual_emails` | `activityInputs.emailsTotal` |
| `meetings_set` | `rawInputs.initialMeetingsSet` |
| `prospects_added` | `rawInputs.prospectsAddedToCadence` |
| `customer_meetings_held` | `activityInputs.customerMeetingsHeld` |
| `opportunities_created` | `rawInputs.opportunitiesCreated` |
| `personal_development` | `rawInputs.personalDevelopment` |
| `accounts_researched` | `activityInputs (new)` |
| `contacts_prepped` | `activityInputs (new)` |

**B. Dave emits event after DB write** — After `update_daily_metrics` succeeds, dispatch `window.dispatchEvent(new CustomEvent('dave-metrics-updated'))`. ActivityRings and MomentumHeader listen for this event and re-fetch from DB to update the store.

**C. Manual ring taps persist to DB** — When ActivityRings `handleUpdate` fires, also upsert the value to `daily_journal_entries` so manual changes survive reload.

### Issue 7 (HIGH): CRM writes bypass Zustand — UI stale after Dave mutations
All 14 CRM-mutating tools write to DB but don't update the Zustand store. The DataSync write-back watcher only catches Zustand→DB direction, not DB→Zustand.

**Fix:** After each Dave DB mutation, dispatch a typed `CustomEvent('dave-data-changed', { detail: { table: 'tasks' | 'accounts' | ... } })`. A new listener in `useDataSync.ts` re-fetches the affected table and updates Zustand. This is surgical — only re-fetches the table that changed, not everything.

### Issue 8 (MEDIUM): `set_reminder` has no delivery mechanism
Dave can create voice reminders in `voice_reminders` table, and the token endpoint marks them as delivered, but there's no client-side polling or notification that actually alerts the user when a reminder fires.

**Fix:** Add a lightweight polling hook (`useVoiceReminders`) that checks for due reminders every 60 seconds and shows a toast + optional browser notification.

### Issue 9 (MEDIUM): `complete_task` doesn't set `completed_at`
The `complete_task` tool sets `status: 'done'` but doesn't set `completed_at`, which other UI components use for streak tracking and completion timestamps.

**Fix:** Add `completed_at: new Date().toISOString()` to the update payload.

### Issue 10 (LOW): `update_renewal` allows arbitrary field writes
Unlike `bulk_update` which has field whitelists, `update_renewal` falls back to using the raw `params.field` as `dbField` if it's not in `RENEWAL_FIELDS`. This could cause DB errors or unintended column writes.

**Fix:** Add validation that `dbField` is in a known list, return an error if not.

### Issue 11 (LOW): `create_account` uses `ilike` for duplicate check — false positives
Searching `ilike '%Acme%'` would match "Acme Corp" when creating "Acme Industries", blocking legitimate creation.

**Fix:** Use exact match (`eq('name', params.name)`) for duplicate detection instead of fuzzy `ilike`.

## Files to Modify

1. **`src/hooks/useDataSync.ts`** — Add journal hydration on load; add `dave-data-changed` event listener to re-fetch affected tables
2. **`src/components/dave/clientTools.ts`** — Dispatch `dave-metrics-updated` event in `update_daily_metrics`; dispatch `dave-data-changed` event in all CRM-mutating tools; fix `complete_task` to set `completed_at`; fix `update_renewal` field whitelist; fix `create_account` duplicate check
3. **`src/components/ActivityRings.tsx`** — Listen for `dave-metrics-updated`; persist manual ring changes to DB
4. **`src/components/tasks/MomentumHeader.tsx`** — Listen for `dave-metrics-updated` to refresh
5. **New: `src/hooks/useVoiceReminders.ts`** — Polling hook for reminder delivery
6. **`src/components/Layout.tsx`** — Mount `useVoiceReminders`

