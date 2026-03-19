

# Test and Optimize Dave Voice Pipeline

## Issues Found

### Bug 1: Request body consumed twice (edge function)
Line 171 calls `req.json()` to get `tzOffsetHours`, but the request body stream was never consumed earlier — however, if the user is unauthenticated (`userId` is null), this code is skipped entirely and `tzOffsetHours` is never read. The body should be parsed once at the top before any branching.

### Bug 2: Missing `id` in voice_reminders select
Line 97 selects `message, remind_at` but lines 155-163 try to access `r.id` and `msg.id` to mark reminders as delivered. The `id` column is not in the select, so updates silently fail.

### Bug 3: 502 from ElevenLabs token endpoint
The edge function returns 502, meaning ElevenLabs rejected the request. The error message is swallowed. Need to surface the actual ElevenLabs error for debugging and add better logging.

### Optimization 1: Reminder updates are sequential
Lines 158-163 update reminders one-by-one in a loop. Should batch with `.in('id', ids)`.

### Optimization 2: Token fetch blocks on context queries
The ElevenLabs token and CRM context queries are independent but run sequentially. They should run in parallel.

### Optimization 3: Client-side connection resilience
No auto-reconnect on unexpected disconnect. The `useEffect` auto-start only fires once.

---

## Plan

### Step 1: Fix and optimize the edge function (`dave-conversation-token/index.ts`)

- Parse `req.json()` once at the top of the handler
- Run ElevenLabs token fetch in parallel with CRM context queries
- Add `id` to `voice_reminders` select
- Batch reminder updates with `.in('id', ids)` instead of sequential loop
- Surface actual ElevenLabs error body in the 502 response for debugging
- Add timing logs for performance monitoring

### Step 2: Harden the client component (`DaveConversationMode.tsx`)

- Add auto-reconnect logic on unexpected disconnect (with backoff)
- Memoize `clientTools` object to prevent unnecessary re-renders
- Add connection timeout handling (10s)
- Prevent double-start race condition in the `useEffect`

### Step 3: Deploy and test

- Deploy the updated edge function
- Invoke it to verify the token endpoint works
- Check logs if it still fails (likely an ElevenLabs API key or agent config issue)

---

## Technical Details

**Edge function changes:**
```text
Before:
  1. Check secrets
  2. Authenticate user
  3. Fetch ElevenLabs token  ← blocks
  4. Fetch CRM context (5 parallel queries)
  5. Parse body for timezone  ← second body read
  6. Build response

After:
  1. Parse body once
  2. Check secrets + authenticate
  3. Fetch token + CRM context in parallel  ← faster
  4. Build response with better error details
```

**Files modified:**
- `supabase/functions/dave-conversation-token/index.ts` — fix bugs, parallelize
- `src/components/DaveConversationMode.tsx` — resilience, memoization

