/**
 * run-catchup — Processes items from a reconciliation snapshot in phases.
 * Respects resource routing: audio/video → transcript pipeline,
 * pdf/url → enrich then extract, text → direct extract, repeated failures → manual assist.
 *
 * POST /run-catchup
 * Body: { run_id, phase: 'enrich' | 'extract' | 'activate' | 'surface_to_qa', limit?: number }
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

// ── Asset-aware server-side route derivation ──────────────
type Pipeline = "transcript_pipeline" | "enrich_then_extract" | "direct_extract" | "manual_assist";
type AssetKind = "lesson_text" | "transcript_text" | "parsed_content" | "manual_text" | "audio_file" | "video_file" | "uploaded_file" | "url";
type ExtractionMethod = "standard" | "dense_teaching" | "lesson" | "summary_first";
type RouteConfidence = "high" | "medium" | "low";

const ASSET_PRIORITY: AssetKind[] = [
  "lesson_text", "transcript_text", "parsed_content", "manual_text",
  "audio_file", "video_file", "uploaded_file", "url",
];

function hasTextAsset(a: AssetKind): boolean {
  return a === "lesson_text" || a === "transcript_text" || a === "parsed_content" || a === "manual_text";
}

interface RouteOverride {
  pipeline?: Pipeline;
  extraction_method?: ExtractionMethod;
  primary_asset?: AssetKind;
  reason?: string;
}

interface DerivedRoute {
  pipeline: Pipeline;
  extraction_method: ExtractionMethod;
  primary_asset: AssetKind;
  confidence: RouteConfidence;
  has_override: boolean;
}

function deriveRoute(resource: any): DerivedRoute {
  const url = resource.file_url || "";
  const resourceType = resource.resource_type || "";
  const title = resource.title || "";
  const contentLength = resource.content_length || 0;
  const failureCount = (resource.failure_count || 0) + (resource.advanced_extraction_attempts || 0);
  const enrichmentStatus = resource.enrichment_status || "";
  const hasContent = contentLength > 200;
  const isLesson = title.includes(" > ");

  const isAudio = resourceType === "audio" || resourceType === "podcast_episode" ||
    /\.mp3|\.m4a|\.wav|\.ogg/i.test(url) ||
    /spotify\.com|podcasts\.apple\.com|anchor\.fm/i.test(url);
  const isVideo = resourceType === "video" || /\.mp4/i.test(url) ||
    /youtube\.com|youtu\.be|vimeo\.com/i.test(url);

  // Detect available assets
  const assets: AssetKind[] = [];
  if (isLesson && hasContent) assets.push("lesson_text");
  const hasTranscript = resource.has_transcript || resource.transcript_text ||
    (enrichmentStatus === "deep_enriched" && (isAudio || isVideo));
  if (hasTranscript && hasContent) assets.push("transcript_text");
  const parsedStatuses = ["deep_enriched", "content_ready", "enriched"];
  if (parsedStatuses.includes(enrichmentStatus) && hasContent && !isLesson && !hasTranscript) assets.push("parsed_content");
  if ((resource.manual_content_present || resource.resolution_method === "resolved_manual") && hasContent) assets.push("manual_text");
  if (hasContent && assets.length === 0 && !isAudio) assets.push("parsed_content");
  if (isAudio) assets.push("audio_file");
  if (isVideo) assets.push("video_file");
  if (url.includes(".pdf") || resourceType === "pdf" || resourceType === "doc") assets.push("uploaded_file");
  if (url.startsWith("http") && !assets.includes("audio_file") && !assets.includes("video_file") && !assets.includes("uploaded_file")) assets.push("url");
  if (assets.length === 0 && url) assets.push("url");

  // Select primary asset
  let primary_asset: AssetKind = "url";
  for (const a of ASSET_PRIORITY) {
    if (assets.includes(a)) { primary_asset = a; break; }
  }

  // Pipeline based on primary asset
  let pipeline: Pipeline;
  if (failureCount >= 3 && enrichmentStatus !== "deep_enriched" && !hasTextAsset(primary_asset)) {
    pipeline = "manual_assist";
  } else if (hasTextAsset(primary_asset)) {
    pipeline = "direct_extract";
  } else if (primary_asset === "audio_file" || primary_asset === "video_file") {
    pipeline = "transcript_pipeline";
  } else if (primary_asset === "uploaded_file" || primary_asset === "url") {
    pipeline = "enrich_then_extract";
  } else {
    pipeline = "manual_assist";
  }

  // Extraction method
  let extraction_method: ExtractionMethod = "standard";
  if (isLesson) {
    extraction_method = "lesson";
  } else if (contentLength > 8000 || (contentLength > 10000 && (isAudio || isVideo))) {
    extraction_method = "dense_teaching";
  } else if ((resource.advanced_extraction_attempts || 0) >= 3) {
    extraction_method = "summary_first";
  }

  // Outcome-aware learning: avoid repeated failures
  if (enrichmentStatus === "failed" && failureCount >= 2) {
    if ((isAudio || isVideo) && pipeline === "transcript_pipeline") {
      pipeline = "manual_assist";
    } else if (pipeline === "enrich_then_extract") {
      pipeline = "manual_assist";
    }
  }

  // Confidence
  let confidence: RouteConfidence;
  if (hasTextAsset(primary_asset) && contentLength > 2000) {
    confidence = "high";
  } else if (hasTextAsset(primary_asset) || primary_asset === "audio_file" || primary_asset === "video_file") {
    confidence = "medium";
  } else if (primary_asset === "url" && enrichmentStatus === "deep_enriched") {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  if (failureCount >= 3 && confidence === "high") {
    confidence = "medium";
  }

  let has_override = false;

  // Apply route override
  const override = resource.route_override as RouteOverride | undefined;
  if (override) {
    has_override = true;
    if (override.pipeline) pipeline = override.pipeline;
    if (override.extraction_method) extraction_method = override.extraction_method;
    if (override.primary_asset && assets.includes(override.primary_asset)) primary_asset = override.primary_asset;
    confidence = "high";
  }

  return { pipeline, extraction_method, primary_asset, confidence, has_override };
}

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

    // Fetch resource details for routing decisions
    const resourceIds = items.map((i) => i.resource_id);
    const { data: resources } = await supabase
      .from("resources")
      .select("id, resource_type, file_url, title, content_length, failure_count, advanced_extraction_attempts, enrichment_status, manual_content_present, has_transcript, transcript_text, resolution_method, route_override")
      .in("id", resourceIds);

    const resourceMap = new Map((resources || []).map((r) => [r.id, r]));

    // Process each item based on phase + route
    for (const item of items) {
      try {
        const resource = resourceMap.get(item.resource_id);
        const route = resource ? deriveRoute(resource) : { pipeline: "enrich_then_extract" as Pipeline, extraction_method: "standard", primary_asset: "url" as AssetKind };

        let outcome: Record<string, any> = {
          phase,
          processed_at: new Date().toISOString(),
          route_pipeline: route.pipeline,
          route_extraction_method: route.extraction_method,
        };

        console.log(`[route] resource=${item.resource_id} pipeline=${route.pipeline} method=${route.extraction_method} primary_asset=${route.primary_asset}`);

        if (phase === "enrich") {
          if (run.mode === "dry_run") {
            outcome.action = "would_enrich";
            outcome.status = "dry_run";
            results.skipped++;
          } else if (route.pipeline === "manual_assist") {
            // Route to QA instead of auto-enriching
            outcome.action = "routed_to_manual_assist";
            outcome.status = "manual_required";
            results.qa_flagged++;
            await supabase
              .from("library_reconciliation_items")
              .update({ qa_flagged: true, qa_reason: "Routed to manual assist after repeated failures" })
              .eq("id", item.id);
          } else if (route.pipeline === "direct_extract") {
            // Skip enrichment — content already present
            outcome.action = "skip_enrichment_content_present";
            outcome.status = "skipped";
            results.skipped++;
          } else {
            // Queue for enrichment
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
          } else if (route.pipeline === "manual_assist") {
            outcome.action = "routed_to_manual_assist";
            results.qa_flagged++;
            await supabase
              .from("library_reconciliation_items")
              .update({ qa_flagged: true, qa_reason: "Extraction routed to manual assist" })
              .eq("id", item.id);
          } else {
            // Queue extraction with method hint
            const { error: updateErr } = await supabase
              .from("resources")
              .update({
                extraction_status: "queued",
                extraction_method: route.extraction_method,
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
              outcome.extraction_method = route.extraction_method;
              results.succeeded++;
            }
          }
        } else if (phase === "activate") {
          if (run.mode === "dry_run") {
            outcome.action = "would_activate";
            outcome.status = "dry_run";
            results.skipped++;
          } else {
            outcome.action = "queued_for_activation";
            results.succeeded++;
          }
        } else if (phase === "surface_to_qa") {
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
