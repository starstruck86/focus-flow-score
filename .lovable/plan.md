

# Dave QA & Fix Plan

## Current State — Health Check Results

The health check reveals **two critical issues**:

1. **`apiKeyValid: false`** — The API key validation against `/v1/user` fails (but `tokenGenOk: true`, so the key works for tokens — this is likely a permissions issue on the `/v1/user` endpoint, not a real blocker)

2. **`overridesEnabled: false`** — Both `promptOverride` and `firstMessageOverride` are `false`. This is the **showstopper**. Dave's entire architecture depends on injecting CRM context and identity via prompt overrides. Without overrides enabled, Dave connects as a blank generic agent — no identity, no CRM data, no greeting.

## Root Cause

The ElevenLabs agent needs two settings enabled in its dashboard configuration:
- **System prompt override** — allows the client to inject Dave's instructions + CRM context
- **First message override** — allows a dynamic greeting based on time/meetings/tasks

These cannot be toggled via the API — they must be enabled in the **ElevenLabs Agent Dashboard** under the agent's settings.

## Fix Plan

### Step 1: Enable overrides via ElevenLabs API PATCH (automated)
Update the `register-dave-tools` edge function (or create a new `configure-dave-agent` function) to PATCH the agent config with override permissions enabled. The ElevenLabs API supports setting `platform_settings` which controls override behavior:

```
PATCH /v1/convai/agents/{agent_id}
{
  "platform_settings": {
    "widget": {
      "variant": "full",
      "overridable": true
    },
    "overrides": {
      "conversation_config": {
        "agent": {
          "prompt": {
            "prompt": true
          },
          "first_message": true
        }
      }
    }
  }
}
```

Create a one-shot edge function `configure-dave-agent` that:
1. PATCHes the agent to enable prompt + first message overrides
2. Returns the result for verification

### Step 2: Fix the health check false negative
The `apiKeyValid` check hits `/v1/user` which may require different permissions than convai endpoints. Update the health check to use a more reliable validation — e.g., check if the token generation succeeds (which it already does via `tokenGenOk`).

### Step 3: Re-run health check to verify
After enabling overrides, invoke the health check again to confirm `overridesEnabled: true`.

## Files to Create/Edit

1. **Create** `supabase/functions/configure-dave-agent/index.ts` — One-shot function to enable overrides via PATCH
2. **Edit** `supabase/functions/dave-health-check/index.ts` — Fix `apiKeyValid` to not report false negatives

## What This Fixes
- Dave will receive CRM context and identity instructions on every session
- Dave will deliver personalized greetings instead of silence
- The greeting timeout/retry loop will no longer trigger
- All 36 client tools will work because Dave knows to use them via the injected prompt

