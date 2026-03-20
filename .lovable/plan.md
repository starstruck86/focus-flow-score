

# Easiest Way: Edge Function Script to Bulk-Register All 36 Tools

Since your ElevenLabs API key and Agent ID are already stored as secrets, the easiest path is an edge function that registers all 36 tools in one HTTP call. You run it once, done.

## How it works

1. I create an edge function `register-dave-tools` that:
   - Reads your `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID` from secrets
   - Fetches your current agent config via `GET /v1/convai/agents/{agent_id}`
   - PATCHes the agent with all 36 client tool definitions in one API call
   - Returns a success/failure report

2. You invoke it once from the app (or I call it for you)
3. All 36 tools appear in your ElevenLabs dashboard instantly

## Your steps

1. **Approve this plan** — I build the edge function
2. **Click one button** (or I invoke it) — all tools registered
3. **Verify in ElevenLabs dashboard** — you should see 36 client tools on your agent

## Technical details

- Single file: `supabase/functions/register-dave-tools/index.ts`
- Uses `PATCH /v1/convai/agents/{agent_id}` with the full `conversation_config.agent.prompt.tools` array
- Each tool defined with `type: "client"`, `name`, `description`, `parameters` (JSON schema), and `expects_response: true`
- One-time use — can be deleted after

