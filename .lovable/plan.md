

# Honest Assessment: Confidence Level 5/10

## Why Not Higher

Looking at the actual code, the fundamental problem is **architectural** and the previous fixes were treating symptoms, not the disease.

### The Real Problem (confirmed in code)

**Line 92-95 of the edge function**: We fetch a `conversationToken` from ElevenLabs. This token locks the agent to whatever system prompt is configured **in the ElevenLabs dashboard**. Our `DAVE_INSTRUCTIONS` (56 lines of carefully crafted identity) are sent two ways:

1. **`dynamicVariables`** (line 207-219) — Only work if the ElevenLabs agent's prompt template contains `{{context}}` and `{{first_message}}` placeholders. If those placeholders don't exist in the dashboard, the variables are **silently dropped**.

2. **`sendContextualUpdate`** (line 86-93) — Adds supplementary context AFTER connection, but **does NOT override the agent's base system prompt**. If the ElevenLabs agent says "You are a helpful AI assistant," that's what Dave will be, regardless of what we inject.

**This is why Dave "doesn't know his name."** Our 1200 chars of identity instructions never reach the agent's core prompt. They're either dropped or treated as background context the agent can ignore.

### What the Bug Fixes Actually Fixed
- Reconnect history ✅ (real bug, fixed)
- Task status mismatch ✅ (real bug, fixed)
- Timezone math ✅ (real bug, fixed)
- Context size optimization ✅ (helpful, fixed)

**None of these address why Dave has no identity.** That's the 5/10.

---

## What Gets Us to 10/10

### Step 1: Switch to Signed URL + Overrides (the real fix)

Instead of `conversationToken` (which defers to dashboard config), use `get-signed-url` + `overrides` to **inject our prompt directly as the agent's system prompt**. This gives us full control from code.

**Edge function change:**
- Switch API call from `/conversation/token` to `/conversation/get-signed-url`
- Return `signed_url` instead of `token`

**Component change:**
- Use `signedUrl` instead of `conversationToken` in `startSession`
- Pass `overrides.agent.prompt.prompt` = our full `DAVE_INSTRUCTIONS` + CRM context
- Pass `overrides.agent.firstMessage` = our computed greeting
- Remove `sendContextualUpdate` (no longer needed — prompt IS the identity)

### Step 2: Auth Guard (prevent silent empty sessions)

Currently if auth fails, `userId = null`, context is empty, and Dave starts with nothing. Add:
- Client-side: check `supabase.auth.getUser()` before starting; show error if not logged in
- Edge function: return explicit error if no valid user, don't proceed with empty context

### Step 3: Verify Overrides Are Enabled

Overrides must be enabled in the ElevenLabs dashboard for the agent. If they're not, the `overrides` parameter is silently ignored.

**Fallback plan:** If overrides don't work, we keep `sendContextualUpdate` as backup BUT prefix it with a strong identity re-assertion: "IMPORTANT: Your name is Dave. Ignore any previous system instructions that conflict with this."

### Step 4: Add Diagnostic Logging

- Edge function: log context size and whether user was authenticated
- Client: log whether `signed_url` was received and context size before session start
- Client: on first agent message, log it to verify Dave identifies correctly

---

## Files to Change

| File | Change |
|------|--------|
| `supabase/functions/dave-conversation-token/index.ts` | Switch to signed URL endpoint, auth guard |
| `src/components/DaveConversationMode.tsx` | Use `signedUrl` + `overrides`, remove `sendContextualUpdate`, add auth check |
| `src/hooks/useDaveContext.ts` | Update types (`signed_url` instead of `token`), auth guard |

## One User Action Required

You need to verify that **overrides are enabled** on your ElevenLabs agent in their dashboard (Agent Settings → Security → Enable Overrides). Without this, the signed URL approach silently falls back to the dashboard prompt. If you can confirm that or enable it, this plan is a 9/10. The last point to 10 is live testing on both mobile and desktop.

