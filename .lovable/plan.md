

# Dave QA Report — Issues Found & Fix Plan

## QA Method
Full code audit of: `DaveConversationMode.tsx`, `clientTools.ts` (1501 lines, 52 tools), `register-dave-tools/index.ts`, `dave-conversation-token/index.ts`, `dave-health-check/index.ts`, `useDaveContext.ts`, `useDaveConversation.ts`, `Layout.tsx` (retry-via-remount), and database schema validation.

## Architecture Status: Sound
The core architecture is solid — retry-via-remount pattern, session contract assertions, greeting watchdog, concurrency backoff, context assembly, and diagnostics panel all look correct.

## Issues Found

### Issue 1: `account_name` field doesn't exist on `tasks` table (BREAKS data)
**Location:** `dave-conversation-token/index.ts` line ~205
The CRM context builder selects `account_name` from `tasks`, but the table only has `linked_account_id`. This means:
- Task context sent to Dave shows `account_name: null` for every task
- Dave can never tell the user which account a task is linked to

Similarly, `list_tasks` in `clientTools.ts` (line 789) selects `linked_account_id` but doesn't resolve it to a name — tasks are shown without account context.

**Fix:** In the token function, join or resolve `linked_account_id` to an account name. In `list_tasks`, add a follow-up query to resolve account names.

### Issue 2: `one_time_amount` doesn't exist on `opportunities` table
**Location:** `clientTools.ts` line 1115 — `commission_detail` selects `one_time_amount` from opportunities.
The `opportunities` table in the schema has no `one_time_amount` column. This will return null/undefined but won't crash — just gives wrong commission data.

**Fix:** Remove `one_time_amount` from the select, or check if the column exists in the DB and add it if needed.

### Issue 3: Tool count mismatch — code says 51 but there are 52
**Location:** `register-dave-tools/index.ts` comment line 29 says "ALL 51 TOOLS" but `clientTools.ts` has 52 handlers. Need to verify all tools in the registration array match the client handlers.

**Fix:** Count tools in both files and ensure 1:1 match.

### Issue 4: `as any` type casts on tables that exist in types
**Location:** `clientTools.ts` lines 230, 326 — `opportunity_methodology` and `dave_transcripts` are cast with `as any` even though they exist in the generated types.
This isn't a bug, but it means TypeScript won't catch schema mismatches.

**Fix:** Remove `as any` casts and use proper types.

### Issue 5: `bulk_update` security concern
**Location:** `clientTools.ts` line 1333
The `bulk_update` tool accepts arbitrary `filter_field` and `update_field` strings from the voice agent and passes them directly to Supabase queries. While RLS protects against cross-user access, there's no validation that the field names are valid columns. An LLM hallucination could send invalid field names causing Postgres errors.

**Fix:** Add a whitelist of valid fields per entity.

### Issue 6: Console warning (non-Dave, minor)
`MeetingCard` in `MeetingPrepPrompt.tsx` has a ref forwarding issue — cosmetic warning, not a Dave blocker.

## Summary of Fixes

| # | Fix | File | Severity |
|---|-----|------|----------|
| 1 | Resolve `linked_account_id` → account name in task context | `dave-conversation-token/index.ts` | High |
| 2 | Remove `one_time_amount` from commission_detail | `clientTools.ts` | Medium |
| 3 | Verify tool count parity (registration vs client) | Both files | Medium |
| 4 | Remove unnecessary `as any` casts | `clientTools.ts` | Low |
| 5 | Add field whitelists to `bulk_update` | `clientTools.ts` | Medium |
| 6 | Fix `list_tasks` to resolve account names | `clientTools.ts` | Medium |

## Implementation

### `supabase/functions/dave-conversation-token/index.ts`
- Change tasks query to select `linked_account_id` instead of `account_name`
- After fetching tasks and accounts, resolve `linked_account_id` to account name using the accounts data already fetched

### `src/components/dave/clientTools.ts`
- `list_tasks`: After fetching tasks with `linked_account_id`, batch-resolve to account names
- `commission_detail`: Remove `one_time_amount` from the select
- `bulk_update`: Add field whitelists for accounts, opportunities, and tasks
- Remove `as any` casts where types exist

### `supabase/functions/register-dave-tools/index.ts`
- Audit and fix the comment to match actual tool count

