/**
 * TEMPORARY — Phase 3.5C live validation proxy.
 * Reads STRATEGY_VALIDATION_KEY server-side and forwards to run-phase35b-validation.
 * DELETE THIS FUNCTION after validation is complete.
 *
 * No external auth needed — this function self-authenticates using server-side secrets.
 * Security: function will be deleted immediately after validation run.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const validationKey = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";

  if (!validationKey) {
    return new Response(JSON.stringify({ error: "STRATEGY_VALIDATION_KEY not set" }), {
      status: 503, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const caseId = url.searchParams.get("case") || "";

  const targetUrl = caseId
    ? `${supabaseUrl}/functions/v1/run-phase35b-validation?case=${encodeURIComponent(caseId)}`
    : `${supabaseUrl}/functions/v1/run-phase35b-validation`;

  try {
    const resp = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-validation-key": validationKey,
        "apikey": anonKey,
      },
    });

    const body = await resp.text();
    return new Response(body, {
      status: resp.status,
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err).slice(0, 500) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
