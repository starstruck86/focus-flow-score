

# Store ElevenLabs Agent ID

## What's happening
The user has provided their ElevenLabs Agent ID: `agent_6001km2x7vrzf639x30t3ewxe3m7`. This needs to be saved as the `ELEVENLABS_AGENT_ID` secret so the `dave-conversation-token` edge function can use it to generate WebRTC conversation tokens.

## Steps
1. **Add the secret** `ELEVENLABS_AGENT_ID` with the provided value
2. **Verify** the edge function can use it by testing the token endpoint

## After storing
Once saved, the full Dave conversational AI pipeline will be connected:
- Layout opens DaveConversationMode overlay
- Hook calls `dave-conversation-token` edge function
- Edge function uses `ELEVENLABS_AGENT_ID` + `ELEVENLABS_API_KEY` to get a WebRTC token
- Client connects via `@elevenlabs/react` SDK

No code changes needed — just the secret.

