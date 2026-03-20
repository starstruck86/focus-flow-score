
# Dave Data Sync & Resilience — COMPLETED

## What Was Fixed

### Issue 6 ✅ Daily metrics sync (Dave ↔ Rings ↔ DB)
- **Journal hydration on load**: `useDataSync.ts` now fetches today's `daily_journal_entries` and populates Zustand's `activityInputs`/`rawInputs`
- **Dave emits events**: `update_daily_metrics` dispatches `dave-metrics-updated` after DB writes, triggering re-hydration
- **Manual ring taps persist to DB**: `ActivityRings.handleUpdate` upserts to `daily_journal_entries`

### Issue 7 ✅ CRM writes sync to UI
- All 14 CRM-mutating tools now dispatch `dave-data-changed` with the affected table name
- `useDataSync.ts` listens for this event and surgically re-fetches only the changed table into Zustand
- Tools covered: `create_task`, `complete_task`, `update_account`, `update_opportunity`, `move_deal`, `update_methodology`, `log_touch`, `add_contact`, `create_opportunity`, `create_account`, `update_renewal`, `smart_debrief`, `create_recurring_task`, `bulk_update`

### Issue 8 ✅ Voice reminders delivery
- New `useVoiceReminders` hook polls every 60s for due reminders
- Shows toast notifications and marks as delivered
- Mounted in `Layout.tsx`

### Issue 9 ✅ `complete_task` sets `completed_at`
- Now sets `completed_at: new Date().toISOString()` alongside `status: 'done'`

### Issue 10 ✅ `update_renewal` field whitelist
- Now returns an error if the field is not in the known whitelist (was falling through to raw field name)

### Issue 11 ✅ `create_account` exact duplicate check
- Changed from `ilike '%name%'` to `eq('name', params.name)` to prevent false positives

## Files Modified
1. `src/lib/daveEvents.ts` — NEW: centralized event dispatchers
2. `src/hooks/useVoiceReminders.ts` — NEW: reminder polling hook
3. `src/hooks/useDataSync.ts` — Journal hydration, dave-data-changed listener, dave-metrics-updated listener
4. `src/components/dave/clientTools.ts` — Event dispatches on all mutations + bug fixes
5. `src/components/ActivityRings.tsx` — DB persistence on manual ring taps
6. `src/components/Layout.tsx` — Mount useVoiceReminders

## Remaining from Original Plan (Issues 1-5)
See previous plan entries for Dave QA Report items (quota context columns, pipeline UUID resolution, etc.)
