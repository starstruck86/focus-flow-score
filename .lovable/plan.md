

# Fix: Move Overrides from startSession() to useConversation()

## The Bug (Still Present)

Line 210-220 in `DaveConversationMode.tsx`:
```text
await conversation.startSession({
  signedUrl: sessionData.signed_url,
  overrides: { ... },    ← SDK ignores this, silently dropped
} as any);               ← 'as any' hides the type error
```

The ElevenLabs React SDK only accepts `overrides` in the `useConversation()` hook, not in `startSession()`. The `as any` cast masks the fact that `overrides` is not a valid `startSession` parameter.

## The Fix — 2 Files

### 1. Layout.tsx — Pre-fetch session data, pass as prop

- Call `useDaveContext().getSession()` when Dave is about to open
- Pass the fetched `sessionData` as a prop to `DaveConversationMode`
- Use `key={sessionData.signed_url}` to force re-mount, which re-initializes `use