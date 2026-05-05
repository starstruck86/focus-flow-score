// Tiny relay: reads STRATEGY_VALIDATION_KEY from env and calls run-production-evidence.
// TEMPORARY — delete after evidence capture.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Only accept service role key in Authorization header
  const authHeader = req.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceRoleKey || bearerToken !== serviceRoleKey) {
    return new Response(JSON.stringify({ error: "Service role required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const body = await req.text();
  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");

  const resp = await fetch(`${supabaseUrl}/functions/v1/run-production-evidence`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-strategy-validation-key": validationKey!,
    },
    body,
  });

  const result = await resp.text();
  return new Response(result, {
    status: resp.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
