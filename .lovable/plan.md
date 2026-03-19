

# Confidence: 4 out of 10

The current plan has a fundamental flaw that explains why Dave connects but can't hear you — on **both desktop and mobile**.

## What's Actually Wrong

I verified the backend is working perfectly — token, context, and firstMessage all return correctly. The problem is 100% client-side, and it's this:

**We're fighting the ElevenLabs SDK for the microphone.**

The SDK's `conversation.startSession()` calls its own internal `getUserMedia()`. It does **not** accept a custom `MediaStream`. Our code grabs the mic first in the click handler, then the SDK tries to grab it again. On many devices, having two competing `getUserMedia` calls on the same mic causes the second one (the SDK's — the one that actually matters) to get a **silent or dead stream**.

That's why you see "Connected" but Dave can't hear you. The WebRTC signaling succeeds, but the audio track feeding the SDK is empty.

On iOS, there's a second problem: `startSession()` runs inside a `useEffect` after mount, not in the click handler. Even with our "gesture fix," the SDK's internal `getUserMedia` still happens outside the gesture context because it's separated by the `await fetchSession()` call and the React render cycle.

## What Gets Us to 10/10

### 1. Remove ALL manual getUserMedia calls
Stop grabbing the mic ourselves. The SDK handles it internally — our stream is never used and actively interferes. Remove `micStream` prop, state, and the pre-capture in `VoiceCommandButton`.

### 2. Pre-fetch the token in the background
Fetch and cache the Dave session token when the app loads (and refresh every 3 minutes). This eliminates the async `fetchSession()` gap between tap and `startSession()`.

### 3. Call startSession directly from the click handler
When the user taps the mic button, call `conversation.startSession()` **immediately** with the cached token — no prior `await`, no React state update, no `useEffect`. The SDK's internal `getUserMedia` runs within the gesture context on iOS, and gets an uncontested mic on desktop.

### 4. Add VAD score monitoring
Use `onVadScore` callback to show whether the mic is actually picking up speech. This gives immediate visual feedback and helps diagnose any remaining issues.

### 5. Log all SDK messages
Log every `onMessage` event (not just transcripts) to see exactly what the SDK is sending. This catches silent errors, missing event types, or configuration issues.

## Architecture Change

```text
CURRENT (broken):
  Tap → getUserMedia (ours) → setState → render → useEffect → fetchSession → startSession → getUserMedia (SDK, gets dead mic)

FIXED:
  App load → fetchSession (cached in background)
  Tap → startSession(cachedToken) → getUserMedia (SDK, clean mic, in gesture context)
```

## Files to Change

- `src/components/VoiceCommandButton.tsx` — remove getUserMedia, call startSession directly with cached token
- `src/components/Layout.tsx` — remove micStream state, add token pre-fetch, simplify Dave open/close
- `src/components/DaveConversationMode.tsx` — remove micStream prop, remove mount useEffect, accept pre-fetched session data, add onVadScore, log all messages
- `src/hooks/useDaveContext.ts` — add background token caching with TTL refresh

## Expected Outcome
- SDK gets exclusive, clean mic access
- No gesture chain breaks on iOS
- VAD feedback shows whether Dave hears you
- Greeting plays on connect (already working server-side)
- Works identically on desktop and mobile

