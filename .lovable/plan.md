

## Plan: Fix All Three Dave Failure Modes

### Issue 1: Stop the Concurrency Cascade
**File: `src/hooks/useDaveContext.ts`**
- Remove the `setInterval(prefetch, CACHE_TTL_MS)` and the mount-time `prefetch()` call (lines 103-107)
- Tokens are fetched on-demand only when the user taps the mic
- Add a `lastErrorRef` with timestamp — if the last error was a concurrency limit within 30s, block the request and show a countdown instead of hammering the API
- Add exponential backoff: 5s → 15s → 60s for repeated failures

### Issue 2: Detect Missing Dashboard Overrides
**File: `supabase/functions/dave-health-check/index.ts`**
- After generating a test token, make a test `GET` to `https://api.elevenlabs.io/v1/convai/agents/{agent_id}` to check if the agent's `platform_settings` include override permissions
- Return `overridesEnabled: true/false` in the health check response
- Surface this in the diagnostics panel and Settings smoke test so the user sees: "System prompt override: OFF — Dave will ignore your identity instructions"

### Issue 3: Structured Error Responses
**File: `supabase/functions/dave-conversation-token/index.ts`**
- Parse the ElevenLabs error body for known statuses: `workspace_concurrency_limit_exceeded`, `invalid_api_key`, `agent_not_found`
- Return a structured JSON error: `{ error: "...", errorType: "concurrency_limit" | "auth_failed" | "agent_error" | "unknown" }`

**File: `src/hooks/useDaveContext.ts`**
- Parse `errorType` from the response
- For `concurrency_limit`: set a 30s cooldown, show specific message "Dave is at capacity — try again in 30s"
- For `auth_failed`: show "ElevenLabs API key invalid"
- For `agent_error`: show "ElevenLabs agent configuration issue"

**File: `src/components/Layout.tsx`**
- In `handleOpenDave` and `handleDaveRetry`, check for concurrency errors and block auto-retry — show a manual "Try Again" button with countdown instead

### Issue 4: Diagnostics + Settings Updates
**File: `src/components/dave/DaveDiagnosticsPanel.tsx`**
- Add override permission status from health check
- Show cooldown timer if concurrency-limited

**File: `src/pages/Settings.tsx`**
- Smoke test now also checks override permissions
- Show clear pass/fail for: API Key ✅ | Agent ID ✅ | Token Gen ✅ | Overrides Enabled ❓

### Files Changed

| File | Change |
|------|--------|
| `src/hooks/useDaveContext.ts` | Remove pre-fetch interval, add backoff + cooldown for concurrency errors, parse structured error types |
| `supabase/functions/dave-conversation-token/index.ts` | Return structured `errorType` field on failures |
| `supabase/functions/dave-health-check/index.ts` | Check agent override permissions via ElevenLabs API |
| `src/components/Layout.tsx` | Block auto-retry on concurrency errors, show specific messages |
| `src/components/dave/DaveDiagnosticsPanel.tsx` | Show override status + cooldown timer |
| `src/pages/Settings.tsx` | Smoke test checks override permissions |

### What This Solves

After this, every failure has a specific label and a specific fix:
- "Concurrency limit" → wait 30s, don't hammer
- "Overrides not enabled" → go to ElevenLabs dashboard, enable toggles
- "API key invalid" → update the secret
- "Connected but silent for 12s" → retry-via-remount (already built)

No more guessing.

