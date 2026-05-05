/**
 * TEMPORARY — Phase 3.5C live validation proxy.
 * Reads STRATEGY_VALIDATION_KEY server-side and forwards to run-phase35b-validation.
 * DELETE THIS FUNCTION after validation is complete.
 *
 * Auth: accepts any authenticated request (JWT or apikey).
 * The proxy itself is short-lived and will be deleted after validation.
 * The downstream run-phase35b-validation is still gated by STRATEGY_VALIDATION_KEY.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Verify caller is an approved user
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("authorization") ?? "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "auth required" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Verify JWT
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "invalid auth" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // Check approved user
  const admin = createClient(supabaseUrl, serviceKey);
  const { data: approved } = await admin.from("approved_users")
    .select("id")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  
  if (!approved) {
    return new Response(JSON.stringify({ error: "not approved" }), {
      status: 403, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const caseId = url.searchParams.get("case") || "";
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
      "apikey": anonKey,
    },
  });

  const body = await resp.text();
  return new Response(body, {
    status: resp.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
