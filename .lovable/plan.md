

# Add "Re-register Dave Tools" Button to Settings

## What was done
I just ran `register-dave-tools` successfully: **55/55 tools created, 0 failures**. All 3 new tools (`guided_journal`, `update_journal_field`, `set_task_reminder`) are now live on the ElevenLabs agent.

## What to build
Add a one-click "Re-register Tools" button in the existing `DaveHealthSection` component on the Settings page so you can re-sync tools anytime without needing to ask.

## Changes

### `src/pages/Settings.tsx`
- Add `registering` state to `DaveHealthSection`
- Add a `registerTools` async function that calls `supabase.functions.invoke('register-dave-tools')` and shows a toast with success/failure count
- Render a new button next to "Health Check" labeled "Sync Tools" with a RefreshCw icon
- Shows result count in toast (e.g., "55/55 tools registered")

### Location
Insert between the Health Check button (line 194) and the health results section — or inline next to the existing button as a second action.

