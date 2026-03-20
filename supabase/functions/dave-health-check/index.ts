import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

  // Validate API key by hitting a lightweight endpoint
  if (apiKey) {
    try {
      const res = await fetch("https://api.elevenlabs.io/v1/user", {
        headers: { "xi-api-key": apiKey },
      });
      result.apiKeyValid = res.ok;
    } catch (e) {
      result.error = `API key check failed: ${e.message}`;
    }
  }

  // Try generating a conversation token
  if (apiKey && agentId) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=${agentId}`,
        { headers: { "xi-api-key": apiKey } }
      );
      const data = await res.json();
      result.tokenGenOk = !!data?.token;
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
        // Check platform_settings or conversation_config for override flags
        const platformSettings = agentData?.platform_settings || {};
        const convConfig = agentData?.conversation_config || {};
        const agent = convConfig?.agent || {};

        // ElevenLabs uses different structures — check common paths
        const promptOverride = !!(
          platformSettings?.overrides?.prompt_overridable ||
          agent?.prompt?.overridable ||
          platformSettings?.widget?.overridable_prompt
        );
        const firstMessageOverride = !!(
          platformSettings?.overrides?.first_message_overridable ||
          agent?.first_message_overridable ||
          platformSettings?.widget?.overridable_first_message
        );

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
