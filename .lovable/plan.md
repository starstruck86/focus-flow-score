

# Dave QA Report — Remaining Issues & Fix Plan

## Audit Scope
Full line-by-line review of: `dave-conversation-token/index.ts` (570 lines), `clientTools.ts` (1528 lines, 52 tools), `register-dave-tools/index.ts` (244 lines), `DaveConversationMode.tsx` (line 326), and database schema types.

## What's Working
- 52 tools registered, parameter schemas aligned between registration and client handlers
- Task context resolves `linked_account_id` → account names (lines 352-353)
- Transcript context resolves `account_id` → account names (lines 454-455)
- Field whitelists on `bulk_update` present and correct
- Commission detail uses correct `new_arr_quota` / `renewal_arr_quota` columns
- Concurrency backoff, retry-via-remount, greeting watchdog all intact

## Issues Still Present

### Issue 1 (HIGH): Quota context uses non-existent columns
**File:** `dave-conversation-token/index.ts` line 436
```
`QUOTA: annual=$${q.annual_target...} quarterly=$${q.quarterly_target...} period=${q.quota_period...}`
```
The `quota_targets` table has: `new_arr_quota`, `renewal_arr_quota`, `fiscal_year_start`, `fiscal_year_end`, `new_arr_acr`, `renewal_arr_acr`. There is NO `annual_target`, `quarterly_target`, or `quota_period`. Dave's quota context always shows blanks/undefined.

**Fix:** Replace line 436 with:
```
const totalQuota = (q.new_arr_quota || 0) + (q.renewal_arr_quota || 0);
sections.push(`QUOTA: total=$${totalQuota.toLocaleString()} new_logo=$${(q.new_arr_quota || 0).toLocaleString()} renewal=$${(q.renewal_arr_quota || 0).toLocaleString()} FY:${q.fiscal_year_start || "—"} to ${q.fiscal_year_end || "—"}`);
```

### Issue 2 (MEDIUM): Pipeline context shows raw account_id UUIDs
**File:** `dave-conversation-token/index.ts` line 373
`acct:${o.account_id || "—"}` outputs raw UUIDs. The `accountIdMap` built at line 454 (for transcripts) should be built earlier and reused here.

**Fix:** Move the `accountIdMap` construction (lines 454-455) to right after the accounts are loaded (after line 339), then use it at line 373 and line 403.

### Issue 3 (MEDIUM): Contacts context shows raw account_id UUIDs
**File:** `dave-conversation-token/index.ts` line 403
Same as Issue 2 — `acct:${c.account_id || "—"}` is a raw UUID.

**Fix:** Use the same `accountIdMap` to resolve.

### Issue 4 (LOW): `dave_transcripts` insert uses unnecessary `as any` casts
**File:** `DaveConversationMode.tsx` line 326
```typescript
await (supabase.from('dave_transcripts' as any) as any).insert({...})
```
The `dave_transcripts` table exists in generated types with proper schema. The cast bypasses TypeScript safety.

**Fix:** Replace with:
```typescript
await supabase.from('dave_transcripts').insert({
  user_id: user.id,
  messages: currentTranscript as unknown as Json,
  duration_seconds: durationSeconds,
});
```

### Issue 5 (LOW): CORS headers in register-dave-tools missing Supabase client headers
**File:** `register-dave-tools/index.ts` line 5-6
Currently: `"authorization, x-client-info, apikey, content-type"`
Missing the newer platform headers that other edge functions include.

**Fix:** Update to match the standard set:
```
"authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version"
```

## Summary

| # | Issue | File | Severity |
|---|-------|------|----------|
| 1 | Quota context uses non-existent columns | `dave-conversation-token/index.ts` | HIGH |
| 2 | Pipeline context shows raw UUIDs | `dave-conversation-token/index.ts` | MEDIUM |
| 3 | Contacts context shows raw UUIDs | `dave-conversation-token/index.ts` | MEDIUM |
| 4 | `dave_transcripts` uses `as any` | `DaveConversationMode.tsx` | LOW |
| 5 | Missing CORS headers | `register-dave-tools/index.ts` | LOW |

## Files to Modify

1. **`supabase/functions/dave-conversation-token/index.ts`** — Fix quota context (line 434-437), build accountIdMap early (after line 339) and use it in pipeline (line 373) and contacts (line 403) sections
2. **`src/components/DaveConversationMode.tsx`** — Remove `as any` casts on line 326
3. **`supabase/functions/register-dave-tools/index.ts`** — Update CORS headers (line 5-6)

