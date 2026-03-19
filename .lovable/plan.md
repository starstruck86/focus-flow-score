
What I found

- The override fix is in place: `useConversation({ overrides: ... })` is now correct.
- The backend token endpoint is working: `dave-conversation-token` is returning a signed URL plus a ~20k-char Dave context.
- The remaining likely failure is transport setup in `src/components/DaveConversationMode.tsx`: the code starts with `startSession({ signedUrl: url })`, but the ElevenLabs SDK docs show signed URLs are for WebSocket sessions and should be started with `connectionType: "websocket"`.
- Your screenshot matches that failure mode: Dave reaches the overlay, then lands in a plain `Disconnected` state without a useful error, which means the UI is handling an early disconnect badly.

Do I know what the issue is?

Likely yes: the app fixed prompt overrides, but it is still starting the signed-URL session with an incomplete transport config and weak disconnect diagnostics.

Plan

1. Fix the Dave transport
- Update `src/components/DaveConversationMode.tsx` so signed-URL sessions start with:
  ```text
  conversation.startSession({
    signedUrl: url,
    connectionType: "websocket",
  })
  ```
- Keep overrides in `useConversation`; that part should stay as-is.

2. Make disconnects debuggable
- In `src/components/DaveConversationMode.tsx`, treat an immediate `onDisconnect` after connect/start as an actionable error instead of leaving the UI at a passive “Disconnected”.
- Always surface a retry CTA after failed start/disconnect.
- Add temporary logs around:
  - session source (cached vs fresh)
  - signed URL usage
  - `startSession` success/returned conversation ID
  - `onConnect`, `onError`, and `onDisconnect` ordering

3. Tighten the Dave session flow
- Reduce ambiguity from the duplicate `useDaveContext()` usage between `Layout.tsx` and `DaveConversationMode.tsx`.
- Keep prefetching in `Layout.tsx`, but avoid unnecessary second background fetches from inside the modal unless needed for reconnects.

4. Add a fallback path if WebSocket is still unstable
- If `signedUrl + websocket` still disconnects, switch Dave to conversation-token + `connectionType: "webrtc"` while keeping overrides at the hook level.
- This is the SDK’s recommended transport and is usually more reliable on mobile.

5. Verify end-to-end
- Test signed-in mobile flow:
  - open Dave
  - tap to talk
  - confirm `onConnect` fires
  - confirm Dave speaks the injected first message
  - confirm transcript receives `agent_response`
- If it still fails, the new diagnostics will tell us whether it is:
  - transport mismatch
  - origin/allowlist rejection
  - mic permission failure
  - expired/invalid signed URL

Technical details

Files to touch:
- `src/components/DaveConversationMode.tsx` — primary fix
- `src/components/Layout.tsx` — session/open flow cleanup
- `src/hooks/useDaveContext.ts` — only if we simplify duplicate fetching
- `supabase/functions/dave-conversation-token/index.ts` — only if we switch to conversation tokens/WebRTC

Confidence
- High that this is the next correct fix, because the current code now matches the override docs but still misses the signed-URL transport requirement shown in the SDK docs.
