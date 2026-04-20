// ════════════════════════════════════════════════════════════════
// strategy-stress-runner
//
// One-shot validation entrypoint. Service-role-gated by virtue of
// running inside the edge runtime where SUPABASE_SERVICE_ROLE_KEY is
// available. Hard-codes nothing about the suite — the caller passes
// `as_user_id`, `thread_id`, `prompts`, `label`. Used to drive the
// 8-prompt hostile-validation suite from the sandbox without a
// browser session.
//
// POST { as_user_id, thread_id, label, prompts[] }
//   → impersonates the user and forwards into strategy-stress-test
//
// Auth gate: requires `x-validation-key` header matching a value
// that only the validator (me) and the user know. Until that secret
// is configured the function refuses.
// ════════════════════════════════════════════════════════════════

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-strategy-validation-key",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const VALIDATION_KEY = Deno.env.get("STRATEGY_VALIDATION_KEY") ?? "";

interface Body {
  as_user_id: string;
  thread_id: string;
  label: string;
  prompts: string[];
  notes?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!VALIDATION_KEY) {
    return new Response(JSON.stringify({
      error: "STRATEGY_VALIDATION_KEY not configured",
    }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const provided = req.headers.get("x-strategy-validation-key") ?? "";
  if (provided !== VALIDATION_KEY) {
    return new Response(JSON.stringify({ error: "invalid validation key" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!body?.as_user_id || !body?.thread_id || !body?.label || !Array.isArray(body?.prompts)) {
    return new Response(JSON.stringify({
      error: "as_user_id, thread_id, label, prompts[] required",
    }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Mint an access token for the target user
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: targetUser, error: targetErr } = await admin.auth.admin
    .getUserById(body.as_user_id);
  if (targetErr || !targetUser?.user) {
    return new Response(JSON.stringify({
      error: "as_user_id not found",
      detail: targetErr?.message,
    }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: linkData, error: linkErr } = await admin.auth.admin
    .generateLink({
      type: "magiclink",
      email: targetUser.user.email!,
    });
  if (linkErr || !linkData?.properties?.hashed_token) {
    return new Response(JSON.stringify({
      error: "generateLink failed",
      detail: linkErr?.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const { data: verifyData, error: verifyErr } = await admin.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (verifyErr || !verifyData?.session?.access_token) {
    return new Response(JSON.stringify({
      error: "verifyOtp failed",
      detail: verifyErr?.message,
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const accessToken = verifyData.session.access_token;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const fwd = await fetch(`${SUPABASE_URL}/functions/v1/strategy-stress-test`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: anonKey,
    },
    body: JSON.stringify({
      thread_id: body.thread_id,
      label: body.label,
      prompts: body.prompts,
      notes: body.notes,
    }),
  });
  const text = await fwd.text();
  return new Response(text, {
    status: fwd.status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
