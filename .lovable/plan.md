

# Fix: Dave Stuck on "Connected" — Confidence Analysis & 10/10 Plan

## Current Confidence: 5/10 (removing mic pre-flight alone)

Removing the mic pre-flight fixes ONE problem, but there's a second, bigger issue hiding behind it.

## The Two Problems

### Problem 1: Mic Pre-flight Steals Hardware (lines 191-203)
On iOS, acquiring the mic then immediately releasing it can cause the SDK's subsequent acquisition to silently fail — returning a dead stream. The SDK reports "connected" (WebRTC handshake succeeded) but no audio flows.

### Problem 2: Auto-start in useEffect Breaks Gesture Chain (lines 277-285)
`DaveConversationMode` auto-calls `startConversation()` inside a `useEffect` on mount. On iOS Safari/PWA, `getUserMedia` **must** be called within a synchronous user-gesture chain. The `useEffect` fires asynchronously after render, and `getSession()` adds another async gap. By the time the SDK requests the mic, iOS no longer considers it gesture-triggered — so the mic request either silently fails or returns a dead stream.

The `?dave=1` path correctly uses a "Tap to talk" intermediary (`DaveTapPrompt` in Layout.tsx), but the **normal FAB/button path** skips this — `handleOpenDave` sets `daveOpen=true`, the component mounts, and `useEffect` fires outside the gesture chain.

This is why it works sometimes on desktop (no gesture requirement) but fails on mobile.

## Plan to Make It 10/10

### 1. Remove mic pre-flight from `DaveConversationMode.tsx`
Delete lines 191-203. The SDK handles mic acquisition internally.

### 2. Replace auto-start useEffect with gesture-driven start
- Remove the auto-start `useEffect` (lines 277-285)
- Add a `needsTap` state that defaults to `true`
- On mount, show a minimal "Tap to start" orb overlay (matches the existing black fullscreen aesthetic — just makes the orb tappable)
- On tap, call `startConversation()` **directly from the click handler** — this preserves the gesture chain on iOS
- Desktop can optionally auto-start (detect via `navigator.maxTouchPoints === 0`), but safest to always require the tap

### 3. Improve `onError` for mic-specific failures
- In the `onError` callback, check for `NotAllowedError` / `NotFoundError` and show "Microphone access required — check your browser settings" instead of generic "Connection error"

### 4. Add connection timeout with better UX
- The existing 15s timeout shows "Connection timed out" but doesn't cancel the SDK session — add `conversation.endSession()` in the timeout handler to clean up

## Confidence After All Fixes: 9/10
The remaining 1/10 is network/token edge cases (bad WiFi, expired ElevenLabs quota) which are already handled by retry logic.

## Files Changed

| File | Change |
|------|--------|
| `src/components/DaveConversationMode.tsx` | Remove mic pre-flight, replace useEffect auto-start with tap-to-start, improve onError, fix timeout cleanup |

