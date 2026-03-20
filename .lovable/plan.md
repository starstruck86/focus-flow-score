

# Five Features: Journal Walkthrough, Background AI, Expanded Search, Task Reminders, Dave Follow-ups

## 1. Dave Guided Journal Walkthrough

Two new client tools so Dave can walk users through their daily journal step by step.

**`guided_journal`** — Fetches today's `daily_journal_entries` row, identifies which fields are empty/zero, and returns a structured checklist telling Dave what to ask next. Categories: activity metrics (dials, connects, emails, meetings), qualitative reflections (what_worked_today, biggest_blocker, tomorrow_priority, daily_reflection), wellness (energy, focus_quality, stress), and accountability (personal_development, prepped_for_all_calls_tomorrow).

**`update_journal_field`** — Writes text/boolean/numeric fields that `update_daily_metrics` doesn't cover (e.g., `what_worked_today`, `biggest_blocker`, `tomorrow_priority`, `daily_reflection`, `energy`, `focus_quality`, `stress`, `personal_development`). Uses a strict field whitelist.

Both tools emit `dave-metrics-updated` so the UI stays in sync.

**Files:**
- `src/components/dave/clientTools.ts` — Add both tool handlers
- `supabase/functions/register-dave-tools/index.ts` — Register `guided_journal` and `update_journal_field` with ElevenLabs

## 2. Background AI Actions

Users can trigger AI actions (Meeting Prep, Deal Strategy) and navigate away while they run.

**Approach:** Add `askBackground()` to `CopilotContext`. Instead of opening the Copilot dialog, it shows a persistent toast ("Building meeting brief..."), streams the response in the background, then updates to "Meeting brief ready — tap to view" which opens the dialog with the completed result.

**Files:**
- `src/contexts/CopilotContext.tsx` — Add `askBackground(question, mode, accountId)` method, store `backgroundResult` state
- `src/components/TerritoryCopilot.tsx` — When opened with a pre-loaded background result, display it immediately instead of streaming
- `src/components/dashboard/MeetingPrepPrompt.tsx` — Change AI action buttons (Build Meeting Brief, Deal Strategy) to call `askBackground` instead of `ask`
- `src/lib/territoryCopilot.ts` — Add `streamToString()` helper that collects streamed tokens into a final string

## 3. Expanded Inline Search Bar

Replace the small ghost button with a wide search input spanning the header center.

**Layout change:** Restructure the header from `[brand] ... [actions]` to `[brand] [search-bar flex-1] [actions]`. The search bar renders as a visible input with a search icon, always present.

**Inline results:** Instead of opening a full CommandDialog, show a Popover dropdown below the input with grouped results (accounts, opportunities, contacts, tasks) that update as the user types. Keep the existing search logic but render inline.

**Files:**
- `src/components/GlobalSearch.tsx` — Redesign: replace `Button` + `CommandDialog` with an inline `Input` + `Popover` pattern. Add task search. Make component accept `className` for flex sizing.
- `src/components/Layout.tsx` — Move `GlobalSearch` between brand and action buttons, give it `flex-1`

## 4. Task Reminders

Add reminder timestamps to tasks for time-critical follow-ups.

**Database:** Add `reminder_at` column to `tasks` table via migration.

**UI:** Add a datetime picker in `TaskEditDialog` for setting reminders. Show a bell icon on `TaskCard`/`TaskRow` when a reminder is set.

**Delivery:** Extend `useVoiceReminders` to also poll `tasks` where `reminder_at <= now()` and `status != 'done'`, showing toast notifications. After firing, null out `reminder_at` to prevent re-firing.

**Dave tools:**
- Update `create_task` to accept and set `reminder_at` when `dueTime` is provided
- Add `set_task_reminder` tool to set reminders on existing tasks
- Register `set_task_reminder` in ElevenLabs

**Files:**
- Database migration — `ALTER TABLE tasks ADD COLUMN reminder_at timestamptz;`
- `src/types/index.ts` — Add `reminderAt?: string` to Task interface
- `src/components/tasks/TaskEditDialog.tsx` — Add reminder datetime picker
- `src/components/tasks/TaskCard.tsx` — Show reminder indicator
- `src/hooks/useVoiceReminders.ts` — Also poll tasks with due reminders
- `src/components/dave/clientTools.ts` — Update `create_task`, add `set_task_reminder`
- `supabase/functions/register-dave-tools/index.ts` — Register `set_task_reminder`

## 5. Dave Follow-up Questions

Update Dave's system prompt to explicitly instruct him to ask clarifying questions when requests are ambiguous.

Add to `DAVE_INSTRUCTIONS` in `dave-conversation-token/index.ts`:

```
CLARIFICATION PROTOCOL:
- If the user's request is ambiguous or missing critical info, ask ONE clarifying question before executing.
- Examples: "Which deal?" if multiple exist, "What priority?" if not specified, "When is that due?" for tasks.
- Never guess — confirm first, then act.
```

**Files:**
- `supabase/functions/dave-conversation-token/index.ts` — Add clarification instructions to DAVE_INSTRUCTIONS

## ElevenLabs Tool Registration Summary

Three new tools to register in `register-dave-tools/index.ts`:

1. **`guided_journal`** — No params. Returns a checklist of missing journal fields for Dave to walk through.
2. **`update_journal_field`** — Params: `field` (string, enum of journal fields), `value` (string). Writes qualitative/wellness fields.
3. **`set_task_reminder`** — Params: `taskTitle` (string, required), `reminderTime` (string — ISO datetime or relative like "in 30 minutes").

## Files Modified (Complete List)

| File | Changes |
|---|---|
| `src/components/dave/clientTools.ts` | Add `guided_journal`, `update_journal_field`, `set_task_reminder`; update `create_task` for `reminder_at` |
| `supabase/functions/register-dave-tools/index.ts` | Register 3 new tools |
| `supabase/functions/dave-conversation-token/index.ts` | Add clarification protocol to prompt |
| `src/contexts/CopilotContext.tsx` | Add `askBackground()`, `backgroundResult` state |
| `src/components/TerritoryCopilot.tsx` | Support pre-loaded background results |
| `src/components/dashboard/MeetingPrepPrompt.tsx` | Use `askBackground` for AI actions |
| `src/lib/territoryCopilot.ts` | Add `streamToString()` helper |
| `src/components/GlobalSearch.tsx` | Redesign to inline search bar with popover results |
| `src/components/Layout.tsx` | Restructure header for wide search bar |
| `src/types/index.ts` | Add `reminderAt` to Task |
| `src/components/tasks/TaskEditDialog.tsx` | Add reminder picker |
| `src/components/tasks/TaskCard.tsx` | Reminder indicator |
| `src/hooks/useVoiceReminders.ts` | Poll task reminders too |
| Database migration | `ALTER TABLE tasks ADD COLUMN reminder_at timestamptz` |

