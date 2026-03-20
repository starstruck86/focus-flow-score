

## Plan: Make Dave Reliable and QA-able

### Root Cause Analysis

The token fetch works perfectly (200, 20k context, 174-char firstMessage). The problem is downstream — after the WebRTC connection opens. Three likely causes:

1. **Double-context blast**: On connect, the code sends the entire 20k context *again* via `sendContextualUpdate` (line 110-116). The context was already injected via `overrides` in the hook constructor. Sending 20k chars immediately after connect can overwhelm the agent, causing it to freeze or skip the greeting.

2. **ElevenLabs agent settings**: The overrides (system prompt + firstMessage) only work if "System prompt override" and "First message override" are **explicitly enabled** in the ElevenLabs agent dashboard. If these toggles are off, the agent silently ignores the overrides — connects fine but uses its default empty/generic prompt and no greeting.

3. **No diagnostic visibility**: When something fails, you see a green orb and "Listening..." with zero insight into what went wrong. There's no way to tell if the greeting was sent, if audio is flowing, or if the prompt was accepted.

### What Gets Built

#### 1. Remove redundant `sendContextualUpdate` blast
Delete the "belt-and-suspenders" `sendContextualUpdate` call in `onConnect`. The overrides in the constructor already handle prompt injection. Sending 20k chars again is harmful, not helpful.

#### 2. Add Dave Diagnostics Panel
A toggleable debug overlay (tap status text 3x to reveal) showing:
- Connection status + uptime
- Token age and context size
- Messages received count
- Last message type + timestamp
- VAD score (live)
- Whether firstMessage was set
- Error history

This lets you immediately see: "Connected, but 0 messages received in 12s → greeting not firing → overrides not enabled."

#### 3. Add greeting watchdog with auto-retry
The current watchdog only `console.warn`s after 8s. Upgrade it to:
- After 8s with no agent message: show visible warning "Dave connected but isn't responding"
- After 12s: auto-disconnect, fetch fresh token, and retry once
- After second failure: show actionable error "Dave's voice agent may need configuration — check ElevenLabs agent settings"

#### 4. Add connection health-check edge function
New lightweight `dave-health-check` edge function that:
- Verifies `ELEVENLABS_API_KEY` is set and valid (test API call)
- Verifies `ELEVENLABS_AGENT_ID` is set
- Checks if a conversation token can be generated
- Returns a structured health report

The diagnostics panel calls this on first open and shows green/red indicators.

#### 5. Surface ElevenLabs config requirements in Settings
Add a "Dave Voice Assistant" section in Settings page with:
- Health check status (API key valid, agent ID set)
- Reminder: "System prompt override" and "First message override" must be enabled in ElevenLabs
- Test button that opens Dave with diagnostics visible

### Files Changed

| File | Change |
|------|--------|
| `src/components/DaveConversationMode.tsx` | Remove `sendContextualUpdate`, add diagnostics panel, upgrade greeting watchdog |
| `supabase/functions/dave-health-check/index.ts` | **NEW** — lightweight health check |
| `src/pages/Settings.tsx` | Add Dave health section with test button |

### QA Protocol After Implementation

With the diagnostics panel, you can verify each step:
1. Open Dave → diagnostics show "Token: ✅, Context: 20035 chars, FirstMessage: ✅"
2. After connect → "Status: connected, Messages: 0" → within 3s → "Messages: 1 (agent_response)"
3. Speak → "VAD: active, Messages: 2 (user_transcript)" → agent responds → "Messages: 3"
4. If anything fails, the exact failure point is visible immediately

