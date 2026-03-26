import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trace-id",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("ELEVENLABS_API_KEY");
  const agentId = Deno.env.get("ELEVENLABS_AGENT_ID");

  const result = {
    apiKeySet: !!apiKey,
    apiKeyValid: false,
    agentIdSet: !!agentId,
    tokenGenOk: false,
    overridesEnabled: null as boolean | null,
    overrideDetails: null as { promptOverride: boolean; firstMessageOverride: boolean } | null,
    error: null as string | null,
  };

  // Try generating a conversation token (validates both API key and agent)
  if (apiKey && agentId) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      const data = await res.json();
      result.tokenGenOk = !!data?.token;
      result.apiKeyValid = res.ok;
      if (!result.tokenGenOk) {
        result.error = `Token gen failed: ${JSON.stringify(data)}`;
      }
    } catch (e) {
      result.error = `Token gen error: ${e.message}`;
    }
  }

  // Check agent config for override permissions
  if (apiKey && agentId) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/agents/${agentId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      if (res.ok) {
        const agentData = await res.json();
        // Correct path: platform_settings.overrides.conversation_config_override.agent
        const overrideAgent = agentData?.platform_settings?.overrides?.conversation_config_override?.agent;

        const promptOverride = !!overrideAgent?.prompt?.prompt;
        const firstMessageOverride = !!overrideAgent?.first_message;

        result.overrideDetails = { promptOverride, firstMessageOverride };
        result.overridesEnabled = promptOverride && firstMessageOverride;
      } else {
        result.error = (result.error ? result.error + "; " : "") + `Agent config fetch failed: ${res.status}`;
      }
    } catch (e) {
      result.error = (result.error ? result.error + "; " : "") + `Agent config error: ${e.message}`;
    }
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
