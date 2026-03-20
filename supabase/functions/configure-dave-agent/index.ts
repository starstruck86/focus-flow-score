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

  if (!apiKey || !agentId) {
    return new Response(
      JSON.stringify({ error: "Missing secrets" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });
    const data = await res.json();

    return new Response(
      JSON.stringify({
        platform_settings: data.platform_settings,
        conversation_config_agent_keys: Object.keys(data?.conversation_config?.agent || {}),
        prompt_keys: Object.keys(data?.conversation_config?.agent?.prompt || {}),
      }, null, 2),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
