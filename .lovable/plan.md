

# Fix Dave: Both Diagnostic + WebRTC Switch

## The smart approach

Do both in one shot. The ElevenLabs docs are clear: **WebRTC + conversation token is the recommended path**, and it supports overrides identically. The diagnostic logging goes in alongside, so if anything still fails we'll know exactly why.

## What changes

### 1. Edge function: conversation token instead of signed URL
**File**: `supabase/functions/dave-conversation-token/index.ts`

- Change the ElevenLabs API call from `get-signed-url` to `conversation/token`
- Return `{ token, context, firstMessage }` instead of `{ signed_url, ... }`
- Everything else (CRM context building, DAVE_INSTRUCTIONS, first message logic) stays identical

### 2. Client: WebRTC transport + diagnostic logging
**File**: `src/components/DaveConversationMode.tsx`

- Use `conversationToken` + `connectionType: 'webrtc'` in `startSession`
- Add status transition logging with timestamps in `onConnect`, `onDisconnect`, `onError`
- Log the full error object (not just message) to capture override rejection reasons
- Track whether any `onMessage` was received before disconnect (distinguishes "connected but silent" from "never connected")
- Show last status transition in the UI during connection for debugging

### 3. Update types and references
- **`src/hooks/useDaveContext.ts`**: `DaveSessionData` interface — `signed_url` → `token`
- **`src/components/Layout.tsx`**: React `key` prop — `daveSessionData.signed_url` → `daveSessionData.token`

## What stays the same

- Dave's full 20k CRM context — built identically by the edge function
- DAVE_INSTRUCTIONS — unchanged
- Overrides in `useConversation()` (prompt + firstMessage) — unchanged
- Client tools, dismissal phrases, transcript saving — unchanged
- Post-connect `sendContextualUpdate` backup — unchanged

## Why this is safe

The ElevenLabs docs explicitly state conversation tokens support the same override architecture as signed URLs. The `useConversation({ overrides })` pattern works with both transports. Dave keeps his full brain — only the wire changes from WebSocket to WebRTC.

## Risk mitigation

The diagnostic logging means if WebRTC also fails, we'll see exactly:
- Whether the connection was established at all
- Whether overrides were rejected
- Whether audio was flowing
- The specific error payload from ElevenLabs

No more guessing.

## Files

| File | Change |
|------|--------|
| `supabase/functions/dave-conversation-token/index.ts` | Token endpoint