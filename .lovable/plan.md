

## Plan: Make Dave Mission-Critical Reliable

### The Actual Bug (Found in Code)

**Line 126-135 of `DaveConversationMode.tsx`** — the `useConversation` hook is initialized with `overrides` from the initial `sessionData` prop. But `useConversation` is a hook — its config object is read **once at mount time**. When the greeting watchdog triggers a retry (line 166-176), it:

1. Calls `conversation.endSession()`
2. Fetches a fresh token via `getSession(history)` → stores in `sessionDataRef`
3. Calls `startConversation()` which passes the new token to `startSession()`

**But the overrides (prompt + firstMessage) are still the original values from mount.** The hook doesn't re-read overrides. So on retry, Dave connects with a fresh token but **stale or empty context** — making him a generic assistant with no identity.

Additionally, the component uses `key={daveSessionData.token}` (Layout line 305) which should force a remount — but the retry path inside the component bypasses this by staying mounted and calling `startSession` directly.

### What Gets Built (5 Changes)

#### 1. Fix the Override Staleness Bug
When retry fires, instead of trying to reconnect within the same component instance, close Dave and reopen with fresh session data. This triggers the `key=` remount in Layout, guaranteeing fresh overrides reach the hook constructor.

Alternatively (and more robustly): restructure so the component **always remounts** on retry by having the retry logic live in Layout, not inside DaveConversationMode.

#### 2. Add Session Contract Assertions
At the start of `startConversation()`, assert the contract before proceeding:
- `sessionDataRef.current.token` exists and is non-empty
- `sessionDataRef.current.context` exists and length > 500 (Dave's instructions alone are ~1200 chars)
- `sessionDataRef.current.firstMessage` exists and length > 10
- If any fail, log the exact failure and show actionable error — don't silently connect as a blank agent.

#### 3. Upgrade Diagnostics to Show Override Health
Add to the diagnostics panel:
- Context preview (first 200 chars) — so you can visually confirm Dave's instructions are present
- FirstMessage preview (full text)
- Override freshness: "from mount" vs "from retry" with timestamp
- A "Context contains DAVE_INSTRUCTIONS" boolean check

#### 4. Add a Deterministic Smoke Test Button in Settings
Under the existing Dave health section, add a "Run Smoke Test" that:
1. Fetches a fresh token (verifies auth + token gen)
2. Asserts context contains "DAVE OPERATING INSTRUCTIONS" 
3. Asserts firstMessage is non-empty and contains "Dave"
4. Asserts context length > 1000
5. Reports pass/fail for each check with actual values

This can run without opening a voice session — it validates everything up to the WebRTC handshake.

#### 5. Add Retry-via-Remount Pattern
Move the retry responsibility to Layout:
- DaveConversationMode exposes an `onRetry` callback alongside `onClose`
- When greeting timeout fires or connection fails after exhausting retries, call `onRetry` instead of trying to reconnect internally
- Layout handles `onRetry` by: closing Dave → invalidating cache → fetching fresh session → reopening Dave (triggering full remount with new key)
- This guarantees every retry gets fresh overrides in the hook constructor

### Files Changed

| File | Change |
|------|--------|
| `src/components/DaveConversationMode.tsx` | Add contract assertions, expose `onRetry`, remove internal reconnect-with-stale-overrides path, upgrade diagnostics data |
| `src/components/Layout.tsx` | Handle `onRetry` from Dave — close, fetch fresh session, reopen |
| `src/components/dave/DaveDiagnosticsPanel.tsx` | Show context preview, firstMessage preview, override freshness, instruction presence check |
| `src/pages/Settings.tsx` | Add smoke test button that validates token + context + firstMessage contract |

### Why This Fixes It For Good

The root cause is that `useConversation` captures overrides at mount time. Every code path that starts a session must go through a fresh mount. The retry-via-remount pattern makes this structurally impossible to violate — there is no path where Dave connects without fresh overrides. The contract assertions catch any regression before it reaches ElevenLabs. The smoke test lets you verify the entire chain without needing to debug a live voice session.

