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

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
