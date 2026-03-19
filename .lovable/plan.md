

# Fix Dave: Remove Overrides from startSession

## Root Cause (confirmed)
Lines 184-189 in `DaveConversationMode.tsx` pass an `overrides` object to `conversation.startSession()`. The ElevenLabs SDK does NOT support overrides in `startSession()` — it silently aborts the agent after the WebRTC handshake succeeds. This is documented in [ElevenLabs GitHub issue #92](https://github.com/elevenlabs/packages/issues/92).

The `as any` cast on line 189 hides the TypeScript error that would have caught this.

## Fix (single file: `DaveConversationMode.tsx`)

### 1. Remove overrides from startSession
Strip lines 172-182 (the overrides object construction) and pass only `conversationToken` and `connectionType` to `startSession()`. Remove the `as any` cast.

### 2. Add mic permission pre-flight
Before calling `startSession()`, call `navigator.mediaDevices.getUserMedia({ audio: true })` and immediately stop the tracks. Per ElevenLabs docs: "Consider allowing access before the Conversation starts." This ensures the browser permission gate is cleared before the SDK tries internally.

### 3. Add greeting watchdog
After successful connection, set a 5-second timeout. If no `agent_response` message arrives, log a diagnostic warning. This helps catch future issues.

### 4. Context delivery via dynamicVariables (best-effort)
Pass the context string via `dynamicVariables` in `startSession()`, which IS a supported parameter. If the ElevenLabs agent dashboard has `{{context}}` configured in its prompt template, this will work. If not, Dave still connects and works — just without personalized context. No silent failure either way.

## What changes

```text
BEFORE (broken):
  startSession({ conversationToken, connectionType, overrides }) as any
  → SDK silently aborts agent

AFTER (fixed):
  getUserMedia → stop tracks (pre-flight)
  startSession({ conversationToken, connectionType, dynamicVariables })
  → SDK activates agent, greeting plays, VAD fires
```

## File changes
- `src/components/DaveConversationMode.tsx` — remove overrides object, clean startSession call, add mic pre-flight, add greeting watchdog

