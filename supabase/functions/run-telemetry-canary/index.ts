// Temporary canary — will be deleted after verification
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const batchKey = req.headers.get("x-batch-key");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!batchKey || batchKey !== serviceKey) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey!,
  );

  const body = await req.json();
  const action = body.action || "trigger";

  if (action === "query") {
    const { run_ids } = body;
    const { data, error } = await supabase
      .from("task_runs")
      .select("id, task_type, status, draft_output, meta, error, completed_at")
      .in("id", run_ids);
    return new Response(JSON.stringify({ data, error }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // trigger runs
  const userId = body.user_id;
  if (!userId) return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });

  const tasks = ["account_brief", "ninety_day_plan", "discovery_prep"];
  const results: Record<string, any> = {};

  for (const taskType of tasks) {
    const { data: row, error } = await supabase
      .from("task_runs")
      .insert({
        user_id: userId,
        task_type: taskType,
        inputs: { company_name: "Canary Corp", __canary: true },
        status: "pending",
        progress_step: "queued",
      })
      .select("id")
      .single();
    results[taskType] = { run_id: row?.id, error };
  }

  return new Response(JSON.stringify(results), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
