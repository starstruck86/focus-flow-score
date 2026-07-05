// Drill Review edge function
// Actions: approve (promote staged drill to ki_curriculum), reject (move to drills_rejected)
// Auth: JWT required + is_approved_user(auth.uid())=true
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

type Body = {
  action: "approve" | "reject";
  job: string;
  row_id: string;
  reason?: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "missing_auth" }, 401);
    }

    // Identify caller
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "invalid_auth" }, 401);
    const userId = userData.user.id;

    // Service-role client for gated writes
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: approved, error: apprErr } = await admin.rpc("is_approved_user", {
      _user_id: userId,
    });
    if (apprErr) return json({ error: "approval_check_failed", detail: apprErr.message }, 500);
    if (!approved) return json({ error: "forbidden" }, 403);

    const body = (await req.json()) as Body;
    if (!body?.action || !body?.job || !body?.row_id) {
      return json({ error: "bad_request" }, 400);
    }

    // Load the staged row
    const { data: staged, error: stagedErr } = await admin
      .from("_agent_staging")
      .select("job,row_id,payload,created_at")
      .eq("job", body.job)
      .eq("row_id", body.row_id)
      .maybeSingle();

    if (stagedErr) return json({ error: "load_failed", detail: stagedErr.message }, 500);
    if (!staged) return json({ error: "not_found" }, 404);

    if (body.action === "approve") {
      const p = (staged.payload ?? {}) as Record<string, unknown>;
      const update = {
        drill_scenario: p.drill_scenario ?? null,
        drill_spoken_task: p.drill_spoken_task ?? null,
        drill_response_shape: p.drill_response_shape ?? null,
        drill_model_answer: p.drill_model_answer ?? null,
        drill_rubric: p.drill_rubric ?? null,
        drill_teach_script: p.drill_teach_script ?? null,
        drill_ready: true,
      };
      const { error: updErr } = await admin
        .from("ki_curriculum")
        .update(update)
        .eq("id", body.row_id);
      if (updErr) return json({ error: "promote_failed", detail: updErr.message }, 500);

      await admin
        .from("_agent_staging")
        .delete()
        .eq("job", body.job)
        .eq("row_id", body.row_id);

      return json({ ok: true, action: "approve" });
    }

    if (body.action === "reject") {
      const payload = {
        ...(staged.payload as Record<string, unknown>),
        rejected_reason: body.reason ?? null,
        rejected_at: new Date().toISOString(),
        rejected_by: userId,
        source_job: body.job,
      };
      const { error: insErr } = await admin.from("_agent_staging").insert({
        job: "drills_rejected",
        row_id: body.row_id,
        payload,
      });
      if (insErr) return json({ error: "reject_stage_failed", detail: insErr.message }, 500);

      await admin
        .from("_agent_staging")
        .delete()
        .eq("job", body.job)
        .eq("row_id", body.row_id);

      return json({ ok: true, action: "reject" });
    }

    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "unhandled", detail: String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
