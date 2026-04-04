/**
 * run-catchup — Processes items from a reconciliation snapshot in phases.
 *
 * POST /run-catchup
 * Body: { run_id, phase: 'enrich' | 'extract' | 'activate' | 'surface_to_qa', limit?: number }
 *
 * Processes items belonging to the given phase's bucket from the persisted snapshot.
 * Writes per-item outcomes back to reconciliation_items.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Phase = "enrich" | "extract" | "activate" | "surface_to_qa";

const PHASE_BUCKETS: Record<Phase, string[]> = {
  enrich: ["needs_enrichment", "needs_re_enrichment"],
  extract: ["needs_extraction", "needs_re_extraction"],
  activate: ["needs_activation"],
  surface_to_qa: ["needs_qa_review", "blocked"],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const {
      data: { user },
      error: authErr,
    } = await anonClient.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const { run_id, phase, limit = 50 } = body as {
      run_id: string;
      phase: Phase;
      limit?: number;
    };

    if (!run_id || !phase || !PHASE_BUCKETS[phase]) {
      return new Response(
        JSON.stringify({ error: "Missing run_id or invalid phase" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Verify run exists and belongs to user
    const { data: run, error: runErr } = await supabase
      .from("library_reconciliation_runs")
      .select("id, status, mode")
      .eq("id", run_id)
      .eq("user_id", user.id)
      .single();

    if (runErr || !run) {
      return new Response(JSON.stringify({ error: "Run not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check not cancelled
    if (run.status === "cancelled") {
      return new Response(JSON.stringify({ error: "Run was cancelled" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update run status
    await supabase
      .from("library_reconciliation_runs")
      .update({
        status: "running",
        current_phase: phase,
      })
      .eq("id", run_id);

    // Fetch unprocessed items for this phase's buckets
    const buckets = PHASE_BUCKETS[phase];
    const { data: items, error: itemsErr } = await supabase
      .from("library_reconciliation_items")
      .select("id, resource_id, bucket, issues, severity")
      .eq("run_id", run_id)
      .eq("processed", false)
      .in("bucket", buckets)
      .order("severity", { ascending: false })
      .limit(limit);

    if (itemsErr) throw itemsErr;

    const results = {
      phase,
      total: items?.length || 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      qa_flagged: 0,
      skipped: 0,
    };

    if (!items || items.length === 0) {
      // Phase complete — no items
      const phaseProgress = run.phase_progress || {};
      phaseProgress[phase] = { ...results, status: "complete" };
      await supabase
        .from("library_reconciliation_runs")
        .update({ phase_progress: phaseProgress })
        .eq("id", run_id);

      return new Response(JSON.stringify(results), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process each item based on phase
    for (const item of items) {
      try {
        let outcome: Record<string, any> = { phase, processed_at: new Date().toISOString() };

        if (phase === "enrich") {
          // For dry_run, just mark as would-process
          if (run.mode === "dry_run") {
            outcome.action = "would_enrich";
            outcome.status = "dry_run";
            results.skipped++;
          } else {
            // Queue for enrichment by updating resource status
            const targetStatus =
              item.bucket === "needs_re_enrichment"
                ? "queued_for_reenrich"
                : "queued_for_deep_enrich";
            const { error: updateErr } = await supabase
              .from("resources")
              .update({
                enrichment_status: targetStatus,
                last_status_change_at: new Date().toISOString(),
              })
              .eq("id", item.resource_id)
              .eq("user_id", user.id);

            if (updateErr) {
              outcome.action = "enrich_queue_failed";
              outcome.error = updateErr.message;
              results.failed++;
            } else {
              outcome.action = "queued_for_enrichment";
              outcome.status = targetStatus;
              results.succeeded++;
            }
          }
        } else if (phase === "extract") {
          if (run.mode === "dry_run") {
            outcome.action = "would_extract";
            outcome.status = "dry_run";
            results.skipped++;
          } else {
            // Queue by setting extraction_status
            const { error: updateErr } = await supabase
              .from("resources")
              .update({
                extraction_status: "queued",
                last_status_change_at: new Date().toISOString(),
              })
              .eq("id", item.resource_id)
              .eq("user_id", user.id);

            if (updateErr) {
              outcome.action = "extract_queue_failed";
              outcome.error = updateErr.message;
              results.failed++;
            } else {
              outcome.action = "queued_for_extraction";
              results.succeeded++;
            }
          }
        } else if (phase === "activate") {
          if (run.mode === "dry_run") {
            outcome.action = "would_activate";
            outcome.status = "dry_run";
            results.skipped++;
          } else {
            // Mark for activation
            outcome.action = "queued_for_activation";
            results.succeeded++;
          }
        } else if (phase === "surface_to_qa") {
          // Always surface — just flag
          outcome.action = "surfaced_to_qa";
          results.qa_flagged++;
          await supabase
            .from("library_reconciliation_items")
            .update({ qa_flagged: true, qa_reason: item.issues?.join("; ") })
            .eq("id", item.id);
        }

        // Mark item processed with outcome
        await supabase
          .from("library_reconciliation_items")
          .update({
            processed: true,
            phase_outcomes: outcome,
          })
          .eq("id", item.id);

        results.processed++;
      } catch (itemErr) {
        console.error(`Error processing item ${item.id}:`, itemErr);
        results.failed++;
        await supabase
          .from("library_reconciliation_items")
          .update({
            processed: true,
            phase_outcomes: {
              phase,
              error: itemErr.message,
              processed_at: new Date().toISOString(),
            },
          })
          .eq("id", item.id);
      }
    }

    // Update run phase progress
    const { data: currentRun } = await supabase
      .from("library_reconciliation_runs")
      .select("phase_progress")
      .eq("id", run_id)
      .single();

    const phaseProgress = (currentRun?.phase_progress as Record<string, any>) || {};
    phaseProgress[phase] = { ...results, status: "complete" };

    // Check if all phases done
    const allPhases: Phase[] = ["enrich", "extract", "activate", "surface_to_qa"];
    const completedPhases = allPhases.filter((p) => phaseProgress[p]?.status === "complete");
    const isComplete = completedPhases.length === allPhases.length;

    await supabase
      .from("library_reconciliation_runs")
      .update({
        phase_progress: phaseProgress,
        status: isComplete ? "completed" : "running",
        completed_at: isComplete ? new Date().toISOString() : null,
      })
      .eq("id", run_id);

    return new Response(JSON.stringify(results), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("run-catchup error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
