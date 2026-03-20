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

  const url = new URL(req.url);
  const debug = url.searchParams.get("debug") === "true";

  if (!apiKey || !agentId) {
    return new Response(
      JSON.stringify({ error: "Missing ELEVENLABS_API_KEY or ELEVENLABS_AGENT_ID" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // If debug mode, just fetch and return the current agent config's tools section
  if (debug) {
    const getRes = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
      headers: { "xi-api-key": apiKey },
    });
    const data = await getRes.json();
    const tools = data?.conversation_config?.agent?.prompt?.tools;
    const topKeys = Object.keys(data?.conversation_config?.agent?.prompt || {});
    return new Response(
      JSON.stringify({ 
        promptKeys: topKeys,
        toolsType: typeof tools,
        toolsIsArray: Array.isArray(tools),
        toolsLength: Array.isArray(tools) ? tools.length : null,
        toolsSample: Array.isArray(tools) ? tools.slice(0, 2) : tools,
        // Also check if tools are at a different path
        agentKeys: Object.keys(data?.conversation_config?.agent || {}),
        convConfigKeys: Object.keys(data?.conversation_config || {}),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ error: "Use ?debug=true" }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
