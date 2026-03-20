
# Five Features — COMPLETED

## 1. ✅ Dave Guided Journal Walkthrough
- `guided_journal` tool fetches today's entry, returns structured checklist of missing vs completed fields
- `update_journal_field` writes qualitative/wellness fields (what_worked, blocker, reflection, energy, stress, etc.) with strict whitelist
- Both emit `dave-metrics-updated` for UI sync

## 2. ✅ Background AI Actions
- `askBackground()` added to CopilotContext — streams AI responses via persistent toast while user navigates
- Toast updates to "AI response ready — tap to view" with action button to open Copilot
- MeetingPrepPrompt AI buttons (Meeting Brief, Deal Strategy, Recap Email) now use `askBackground`

## 3. ✅ Expanded Inline Search Bar
- GlobalSearch redesigned from tiny button to full-width input spanning header center
- Popover dropdown shows grouped results (accounts, opportunities, renewals, contacts, tasks) inline as user types
- Layout header restructured: `[brand] [search flex-1] [actions]`

## 4. ✅ Task Reminders
- DB: `reminder_at` column added to tasks table
- TaskEditDialog: datetime picker for setting reminders with clear button
- TaskCard: bell icon showing reminder time
- useVoiceReminders: polls both voice_reminders AND tasks with due reminder_at
- Dave tools: `create_task` sets reminder_at from dueTime, new `set_task_reminder` tool

## 5. ✅ Dave Follow-up Questions
- Clarification Protocol added to DAVE_INSTRUCTIONS prompt
- Journal Walkthrough instructions added to prompt
- Dave now asks clarifying questions for ambiguous requests

## ElevenLabs Registration
- 3 new tools registered: `guided_journal`, `update_journal_field`, `set_task_reminder`
- Total tools: 55 (was 52)

## Files Modified
- `src/components/dave/clientTools.ts` — 3 new tools + create_task reminder_at
- `supabase/functions/register-dave-tools/index.ts` — 3 new tool registrations
- `supabase/functions/dave-conversation-token/index.ts` — Journal walkthrough + clarification protocol
- `src/contexts/CopilotContext.tsx` — askBackground(), backgroundResult state
- `src/components/dashboard/MeetingPrepPrompt.tsx` — askBackground for AI actions
- `src/components/GlobalSearch.tsx` — Full redesign to inline search + popover
- `src/components/Layout.tsx` — Header restructured for wide search bar
- `src/types/index.ts` — reminderAt on Task interface
- `src/components/tasks/TaskEditDialog.tsx` — Reminder datetime picker
- `src/components/tasks/TaskCard.tsx` — Bell indicator for reminders
- `src/hooks/useVoiceReminders.ts` — Task reminder polling
- DB migration: `ALTER TABLE tasks ADD COLUMN reminder_at timestamptz`
