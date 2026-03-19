

# Make Dave Bulletproof — Connection Stability & Responsiveness

## Problems Found

1. **Reconnect loop fetches a new token every time** — each reconnect calls `fetchSession()` which hits the edge function for a brand new ElevenLabs token (350ms-2s+). By the time it returns, the connection may drop again, creating a vicious cycle. Also clears the transcript on every reconnect (`setTranscript([])`).

2. **`isOpen` is stale in `onDisconnect` closure** — the `useConversation` hook captures `isOpen` at creation time. If the user closes Dave while a reconnect timer is pending, the stale `true` value triggers another reconnect after close.

3. **No stability window** — `onConnect` immediately resets `reconnectAttemptRef` to 0. If the connection drops 500ms later, it restarts from attempt 0 with a 1-second delay, enabling rapid cycling.

4. **Dave is silent between 10 AM–4 PM** — `buildFirstMessage` returns `null` during midday. So when you say "Hey Dave," the agent starts with no first message and may not respond because there's no prompt to engage.

5. **`endConversation` captures stale `transcript`** — the `useCallback` dependency on `transcript` means every new message recreates `endConversation`, but voice dismissal's `setTimeout` may hold a stale reference.

## Plan

### Step 1: Cache token, reuse on reconnect
- After the first successful `fetchSession()`, store the result in a `sessionDataRef`
- On reconnect, reuse the cached token instead of hitting the edge function again
- Only clear transcript on initial open, not on reconnect (use an `isReconnectRef` flag)

### Step 2: Fix stale closures with refs
- Create `isOpenRef` that mirrors `isOpen` — use this in `onDisconnect` instead of the prop
- Store transcript in a `transcriptRef` alongside the state so `endConversation` always saves the latest messages

### Step 3: Add connection stability window
- After `onConnect`, set a 3-second timer before resetting `reconnectAttemptRef` to 0
- If the connection drops within 3 seconds, treat it as an unstable connect and increment the attempt counter instead of resetting

### Step 4: Reduce reconnects, increase delays
- Reduce max reconnects from 3 to 2
- Use fixed delays of 2s and 5s instead of exponential backoff starting at 1s
- Show "Reconnecting (1/2)..." in the status text so the user knows what's happening

### Step 5: Always provide a first message (midday fix)
- Update `buildFirstMessage` in the edge function to return a greeting for 10 AM–4 PM:
  `"Hey! I'm here whenever you need me. What can I help with?"`
- This ensures Dave always speaks first, confirming the connection is live

### Step 6: Guard against double-start
- Add a `connectedAtRef` timestamp so the auto-start `useEffect` won't fire if we just connected moments ago
- Add `conversation.status` to the auto-start effect's dependency array

## Files Modified
- `src/components/DaveConversationMode.tsx` — token caching, ref-based state tracking, stability window, reconn