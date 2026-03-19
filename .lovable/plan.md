

# Make Dave Bulletproof — Combined iOS Fix + Connection Stability

## The Real Problem

On iOS Safari and PWA Home Screen mode, `getUserMedia` **must** be called directly inside a user tap handler. The current flow breaks this:

1. User taps mic → `setDaveOpen(true)` (React state update)
2. React re-renders → `useEffect` fires → calls `startConversation()`
3. `startConversation()` calls `getUserMedia` — gesture context is **lost**

iOS silently denies mic access, causing immediate failure, which triggers reconnect (also no gesture), creating the infinite disconnect/reconnect loop. This also explains why Dave can't hear you — the mic stream was never actually granted.

Additionally, the auto-start `useEffect` (line 234) creates a competing start path that can double-fire or race with reconnect logic.

## Plan

### Step 1: Acquire mic in the tap handler (iOS fix)
**Files: `VoiceCommandButton.tsx`, `Layout.tsx`**

- In `VoiceCommandButton.onClick`, call `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })` directly in the click handler — this preserves the iOS gesture chain
- If mic is denied, show a toast and don't open Dave
- Store the `MediaStream` in Layout state and pass it as a prop to `DaveConversationMode`

### Step 2: Accept mic stream as prop, remove auto-start useEffect
**File: `DaveConversationMode.tsx`**

- Accept `micStream: MediaStream` as a new prop
- Remove the auto-start `useEffect` entirely (lines 234-245) — this is the primary source of double-starts and the iOS gesture break
- Instead, start the session once on mount via a single `useEffect` that runs when `micStream` is available
- Remove the `getUserMedia` call from `startConversation()` — the stream is already acquired

### Step 3: Reuse mic stream on reconnect
**File: `DaveConversationMode.tsx`**

- On reconnect, check if existing stream tracks are still `live`; if ended, show "Mic disconnected" instead of silently failing
- Never call `getUserMedia` again during reconnects

### Step 4: Handle `?dave=1` URL opens (Siri Shortcuts)
**File: `Layout.tsx`**

- When `?dave=1` is detected on load, show a "Tap to talk to Dave" overlay button instead of auto-opening
- This ensures the gesture requirement is met for URL-triggered opens

### Step 5: Single start path, kill competing timers
**File: `DaveConversationMode.tsx`**

- Add a `reconnectTimerRef` to track the pending reconnect `setTimeout`
- Clear it on manual close, successful end, and unmount
- `onDisconnect` only schedules a reconnect if no timer is already pending
- `endConversation` sets `reconnectAttemptRef = MAX_RECONNECTS` before ending (already done) AND clears the timer

### Step 6: Stop mic tracks on close
**File: `DaveConversationMode.tsx`**

- In `endConversation` and unmount cleanup, call `micStream.getTracks().forEach(t => t.stop())` to release the hardware
- This prevents the iOS mic indicator from staying active after closing Dave

## Files Modified
- `src/components/VoiceCommandButton.tsx` — mic acquisition in click handler
- `src/components/Layout.tsx` — stream state, pass as prop, `?dave=1` tap prompt
- `src/components/DaveConversationMode.tsx` — accept stream prop, remove auto-start, reuse stream, cleanup

## Expected Outcome
- Dave works on iOS Safari and PWA Home Screen mode
- No more disconnect/reconnect loops
- Mic is always granted before Dave opens
- "Hey Dave" gets a response every time
- Siri Shortcut opens require one tap to start (gesture requirement)

