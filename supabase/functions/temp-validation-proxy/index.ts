/**
 * TEMPORARY — Phase 3.5C live validation proxy.
 * Reads STRATEGY_VALIDATION_KEY server-side and forwards to run-phase35b-validation.
 * DELETE THIS FUNCTION after validation is complete.
 *
 * Auth: requires service role key in Authorization header.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Auth gate: service role only
  const auth = req.headers.get("authorization") ?? "";
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7) : "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || bearer !== serviceKey) {
    return new Response(JSON.stringify({ error: "service role required" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const caseId = url.searchParams.get("case") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";

  if (!validationKey) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not set" }), {
      status: 503, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const targetUrl = caseId
    ? `${supabaseUrl}/functions/v1/run-phase35b-validation?case=${encodeURIComponent(caseId)}`
    : `${supabaseUrl}/functions/v1/run-phase35b-validation`;

  const resp = await fetch(targetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-validation-key": validationKey,
      "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
    },
  });

  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
