// Temporary validation proxy — reads STRATEGY_VALIDATION_KEY from env
// and calls run-phase35b-validation with it. Delete after validation.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  if (!validationKey) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not set" }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const caseParam = url.searchParams.get("case");
  const targetUrl = `${supabaseUrl}/functions/v1/run-phase35b-validation${caseParam ? `?case=${caseParam}` : ""}`;

  const resp = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-validation-key": validationKey,
      "apikey": anonKey,
    },
    body: await req.text(),
  });

  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
