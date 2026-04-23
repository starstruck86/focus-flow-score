// ════════════════════════════════════════════════════════════════
// run-discovery-prep-step — processes ONE authoring batch per
// invocation, then HTTP self-invokes for the next batch (or runs
// assembly when the last batch completes).
//
// This function is the "progressive job" runtime: each call lives
// in its own edge isolate, so the 12-batch ladder cannot be killed
// by a single isolate eviction. State is persisted in
// task_run_sections; idempotent via the (run_id, batch_index)
// unique constraint.
//
// Auth: this is an internal function. The caller (run-discovery-prep
// or a previous step) presents the service-role key as Bearer, and
// the function trusts the supplied user_id (we don't have a user
// session in a self-invoke).
// ════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  TOTAL_BATCHES,
  assembleAndFinalize,
  invokeNextStep,
  processOneBatch,
} from "../_shared/strategy-orchestrator/progressiveDriver.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-call",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const auth = req.headers.get("authorization") || "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!auth.includes(serviceKey)) {
      return jsonResponse({ error: "Unauthorized (internal call only)" }, 401);
    }

    const body = await req.json();
    const runId: string = body.run_id;
    const batchIndex: number = Number(body.batch_index);
    const userId: string = body.user_id;
    const taskType: string = body.task_type || "discovery_prep";

    if (!runId || Number.isNaN(batchIndex) || !userId) {
      return jsonResponse({ error: "run_id, batch_index, user_id required" }, 400);
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    console.log(JSON.stringify({
      tag: "[progressive-step:start]",
      run_id: runId,
      batch_index: batchIndex,
      total: TOTAL_BATCHES,
    }));

    const work = (async () => {
      try {
        const result = await processOneBatch({
          supabase, runId, userId, batchIndex, taskType,
        });
        console.log(JSON.stringify({
          tag: "[progressive-step:batch_done]",
          run_id: runId,
          batch_index: batchIndex,
          ...result,
        }));
      } catch (e: any) {
        console.error(JSON.stringify({
          tag: "[progressive-step:batch_error]",
          run_id: runId,
          batch_index: batchIndex,
          error: String(e?.message || e).slice(0, 300),
        }));
      }

      // Chain: invoke the next batch, OR assemble if this was the last.
      const nextIndex = batchIndex + 1;
      if (nextIndex < TOTAL_BATCHES) {
        invokeNextStep({ runId, batchIndex: nextIndex, userId });
      } else {
        try {
          const fin = await assembleAndFinalize({ supabase, runId, taskType });
          console.log(JSON.stringify({
            tag: "[progressive-step:assembled]",
            run_id: runId,
            ...fin,
          }));
        } catch (e: any) {
          console.error(JSON.stringify({
            tag: "[progressive-step:assemble_error]",
            run_id: runId,
            error: String(e?.message || e).slice(0, 300),
          }));
          await supabase
            .from("task_runs")
            .update({
              status: "failed",
              progress_step: "failed",
              error: `assembly: ${String(e?.message || e).slice(0, 500)}`,
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", runId);
        }
      }
    })();

    // @ts-ignore
    if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
      // @ts-ignore
      EdgeRuntime.waitUntil(work);
    } else {
      work.catch(() => { /* logged */ });
    }

    return jsonResponse({ run_id: runId, batch_index: batchIndex, accepted: true });
  } catch (e: any) {
    console.error("[run-discovery-prep-step] error:", e);
    return jsonResponse({ error: e?.message || "Internal error" }, 500);
  }
});
