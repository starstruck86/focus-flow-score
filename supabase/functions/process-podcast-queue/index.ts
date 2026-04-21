/**
 * process-podcast-queue
 * ---------------------
 * Processes up to CONCURRENCY podcast_import_queue items in parallel.
 * Each item runs the full pipeline independently:
 *   Claim → Dedup → Resolve → Transcribe → Validate → Preprocess → Save → Generate KIs → Complete
 * 
 * KI generation is automatic for items that pass guardrails.
 * Each item updates pipeline_stage at every step for live UI tracking.
 * Batch rollup is updated after each invocation.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logServiceRoleUsage, logAuthMethod } from '../_shared/securityLog.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;
const CONCURRENCY = 3;
const CIRCUIT_BREAKER_THRESHOLD = 10;

// ── Content validation patterns ──
const HTML_PATTERNS = /<(div|meta|style|script|span|link|head|body|html|nav|footer|header|iframe)\b/i;
const CSS_PATTERNS = /(::after|::before|font-family:|display:\s*(?:flex|block|grid|none)|@media\s|{color:|background-color:)/i;
const BOT_PATTERNS = /(recaptcha|captcha|install.app|sign.in.to|cookie.consent|create.an.account|subscribe.to.continue|verify.you.are.human|access.denied|403.forbidden|404.not.found|page.not.found)/i;

// ── Platform detection ──
function detectPlatform(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("spotify.com") || u.includes("open.spotify")) return "spotify";
  if (u.includes("apple.com/podcast") || u.includes("podcasts.apple")) return "apple";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.includes("anchor.fm") || u.includes("podcasters.spotify")) return "anchor";
  if (u.includes("buzzsprout.com")) return "buzzsprout";
  if (u.includes("libsyn.com")) return "libsyn";
  if (u.includes("podbean.com")) return "podbean";
  if (u.includes("transistor.fm")) return "transistor";
  if (u.includes("simplecast.com")) return "simplecast";
  if (u.includes("pdst.fm") || u.includes("megaphone.fm") || u.includes("traffic.megaphone")) return "direct_audio";
  if (u.endsWith(".mp3") || u.endsWith(".m4a") || u.endsWith(".wav")) return "direct_audio";
  if (u.match(/\.(mp3|m4a|ogg|wav)(\?|$)/)) return "direct_audio";
  if (u.includes("/feed") || u.includes("rss") || u.includes(".xml")) return "rss_direct";
  return "unknown";
}

function isDirectAudioUrl(url: string): boolean {
  const u = url.toLowerCase();
  return !!(
    u.includes("pdst.fm") ||
    u.includes("megaphone.fm") ||
    u.includes("traffic.megaphone") ||
    u.match(/\.(mp3|m4a|ogg|wav)(\?|$)/)
  );
}

function detectHostPlatform(url: string): string | null {
  if (!url) return null;
  const u = url.toLowerCase();
  if (u.includes("anchor.fm") || u.includes("podcasters.spotify")) return "anchor";
  if (u.includes("buzzsprout.com")) return "buzzsprout";
  if (u.includes("libsyn.com")) return "libsyn";
  if (u.includes("podbean.com")) return "podbean";
  if (u.includes("transistor.fm")) return "transistor";
  if (u.includes("simplecast.com")) return "simplecast";
  if (u.includes("megaphone.fm")) return "megaphone";
  if (u.includes("spreaker.com")) return "spreaker";
  if (u.includes("soundcloud.com")) return "soundcloud";
  if (u.includes("captivate.fm")) return "captivate";
  if (u.includes("blubrry.com")) return "blubrry";
  if (u.includes("acast.com")) return "acast";
  if (u.includes("omny.fm") || u.includes("omnystudio")) return "omny";
  return null;
}

function validateContent(content: string): { valid: boolean; reason: string | null; details: Record<string, any> } {
  const details: Record<string, any> = { length: content.length };
  if (content.length < 200) return { valid: false, reason: "content_too_short", details: { ...details, min_required: 200 } };
  if (HTML_PATTERNS.test(content)) {
    const htmlMatches = content.match(/<[a-z][^>]*>/gi) || [];
    details.html_tag_count = htmlMatches.length;
    if (htmlMatches.length > 5) return { valid: false, reason: "content_invalid_html", details };
  }
  if (CSS_PATTERNS.test(content)) return { valid: false, reason: "content_invalid_css", details };
  if (BOT_PATTERNS.test(content)) return { valid: false, reason: "content_bot_or_login_wall", details };
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const avgLineLen = content.length / Math.max(lines.length, 1);
  if (lines.length > 20 && avgLineLen < 15) {
    details.avg_line_length = avgLineLen;
    return { valid: false, reason: "content_ui_fragments", details };
  }
  return { valid: true, reason: null, details };
}

function validateStructuredTranscript(structured: string, rawLength: number): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const headingCount = (structured.match(/^## /gm) || []).length;
  const retentionRatio = structured.length / Math.max(rawLength, 1);
  if (headingCount < 2) issues.push(`too_few_headings (${headingCount})`);
  if (retentionRatio < 0.15) issues.push(`over_compressed (${Math.round(retentionRatio * 100)}% retained)`);
  if (structured.length < 200) issues.push(`too_short (${structured.length} chars)`);
  return { valid: issues.length === 0, issues };
}

// ══════════════════════════════════════════════════════════════
// YouTube fallback — search YouTube for the episode and pull captions
// ══════════════════════════════════════════════════════════════
async function searchYouTubeVideoId(showTitle: string, episodeTitle: string): Promise<string | null> {
  const query = `${showTitle} ${episodeTitle}`.trim();
  if (!query) return null;

  try {
    const body = {
      context: {
        client: { clientName: "WEB", clientVersion: "2.20240101.00.00", hl: "en" },
      },
      query,
    };

    const resp = await fetch("https://www.youtube.com/youtubei/v1/search?prettyPrint=false", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      console.warn(`YouTube search API returned ${resp.status}`);
      return null;
    }

    const data = await resp.json();
    const contents = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents;
    if (!Array.isArray(contents)) return null;

    for (const section of contents) {
      const items = section?.itemSectionRenderer?.contents;
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const videoId = item?.videoRenderer?.videoId;
        if (videoId) return videoId;
      }
    }
  } catch (e) {
    console.warn(`YouTube search error: ${(e as Error).message}`);
  }
  return null;
}

async function fetchYouTubeTranscript(supabaseUrl: string, serviceRoleKey: string, videoId: string): Promise<string | null> {
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/youtube-captions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({ video_id: videoId }),
    });

    if (!resp.ok) return null;
    const result = await resp.json();
    if (result.success && result.transcript && result.transcript.length > 200) {
      return result.transcript;
    }
  } catch (e) {
    console.warn(`YouTube captions fetch error: ${(e as Error).message}`);
  }
  return null;
}

async function tryYouTubeFallback(supabaseUrl: string, serviceRoleKey: string, showTitle: string, episodeTitle: string): Promise<string | null> {
  const videoId = await searchYouTubeVideoId(showTitle, episodeTitle);
  if (!videoId) {
    console.log(`YouTube fallback: no video found for "${showTitle}" "${episodeTitle}"`);
    return null;
  }
  console.log(`YouTube fallback: found video ${videoId}, fetching captions...`);
  return fetchYouTubeTranscript(supabaseUrl, serviceRoleKey, videoId);
}

// ══════════════════════════════════════════════════════════════
// Per-item pipeline — runs the full flow for one queue item
// ══════════════════════════════════════════════════════════════
async function processItem(
  supabase: any,
  supabaseUrl: string,
  serviceRoleKey: string,
  queueItem: any,
): Promise<{ result: string; resource_id?: string; ki_count?: number; error?: string }> {
  const isReprocessStructure = queueItem.transcript_status === "transcript_ready" && queueItem.raw_transcript;
  const detectedPlatform = detectPlatform(queueItem.episode_url);
  // Mutable resolved metadata — populated during resolve step, used for resource creation
  const resolvedMeta: Record<string, any> = {};

  // ── Post-claim init (already claimed atomically via RPC) ──
  await updateQueueItem(supabase, queueItem.id, {
    platform: detectedPlatform,
    original_episode_url: queueItem.original_episode_url || queueItem.episode_url,
    transcript_status: isReprocessStructure ? "transcript_ready" : "resolving_link",
  });

  console.log(`[${queueItem.id}] Processing: ${queueItem.episode_title}${isReprocessStructure ? " (reprocess)" : ""}`);

  let transcriptText: string;

  if (isReprocessStructure) {
    transcriptText = queueItem.raw_transcript;
  } else {
    // ── Dedup ──
    const { data: existing } = await supabase
      .from("resources")
      .select("id")
      .eq("user_id", queueItem.user_id)
      .eq("file_url", queueItem.episode_url)
      .limit(1);

    if (existing?.length) {
      await updateQueueItem(supabase, queueItem.id, {
        status: "complete",
        pipeline_stage: "complete",
        resource_id: existing[0].id,
        processed_at: now(),
        transcript_status: "skipped_duplicate",
        ki_status: "skipped",
        error_message: "Already imported (dedup)",
      });
      return { result: "skipped_duplicate", resource_id: existing[0].id };
    }

    // ── Resolve ──
    await updateQueueItem(supabase, queueItem.id, { pipeline_stage: "resolving" });

    let embeddedAudioUrl: string | null = null;
    const playMatch = queueItem.episode_url.match(/\/play\/\d+\/(https?%3A%2F%2F[^\s?#]+\.(?:mp3|m4a|ogg|wav))/i);
    if (playMatch) {
      try { embeddedAudioUrl = decodeURIComponent(playMatch[1]); } catch { /* ignore */ }
    }

    let resolveResult: any;
    try {
      const resolveResp = await fetch(`${supabaseUrl}/functions/v1/resolve-podcast-episode`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({ url: queueItem.episode_url, user_id: queueItem.user_id }),
      });
      if (!resolveResp.ok) throw new Error(`HTTP ${resolveResp.status}: ${await resolveResp.text()}`);
      resolveResult = await resolveResp.json();
    } catch (err) {
      if (embeddedAudioUrl) {
        resolveResult = { resolution: { audioEnclosureUrl: embeddedAudioUrl } };
      } else if (isDirectAudioUrl(queueItem.episode_url)) {
        resolveResult = { resolution: { audioEnclosureUrl: queueItem.episode_url } };
      } else {
        await handleFailure(supabase, queueItem, `Resolution failed: ${err.message}`, "audio_unresolvable");
        return { result: "failed", error: err.message };
      }
    }

    const hasTranscriptFromResolve = resolveResult?.transcript && resolveResult.transcript.length > 200;
    const directAudioFallback = isDirectAudioUrl(queueItem.episode_url) ? queueItem.episode_url : null;
    const hasAudioUrl = resolveResult?.audio_url || resolveResult?.resolved_audio_url ||
      resolveResult?.resolution?.audioEnclosureUrl || embeddedAudioUrl || directAudioFallback;

    // Persist resolved metadata (populates the hoisted resolvedMeta object)
    if (resolveResult?.metadata) {
      const m = resolveResult.metadata;
      if (m.title && !queueItem.episode_title) resolvedMeta.episode_title = m.title;
      if (m.showName) resolvedMeta.show_title = m.showName;
      if (m.description) resolvedMeta.episode_description = m.description?.slice(0, 5000);
      if (m.artworkUrl) resolvedMeta.artwork_url = m.artworkUrl;
      if (m.publishDate && !queueItem.episode_published) resolvedMeta.episode_published = m.publishDate;
    }
    if (resolveResult?.resolution) {
      const r = resolveResult.resolution;
      if (r.canonicalPageUrl) resolvedMeta.resolved_url = r.canonicalPageUrl;
      if (r.audioEnclosureUrl) resolvedMeta.audio_url = r.audioEnclosureUrl;
    }
    if (!resolvedMeta.audio_url && directAudioFallback) resolvedMeta.audio_url = directAudioFallback;
    const resolvedAudioUrl = resolveResult?.audio_url || resolveResult?.resolved_audio_url ||
      resolveResult?.resolution?.audioEnclosureUrl || directAudioFallback || '';
    const hostPlatform = detectHostPlatform(resolvedAudioUrl || resolveResult?.resolution?.rssFeedUrl || '');
    if (hostPlatform) resolvedMeta.host_platform = hostPlatform;
    resolvedMeta.resolution_method = hasTranscriptFromResolve ? 'transcript_found' : (hasAudioUrl ? 'transcribed' : 'unresolved');
    resolvedMeta.metadata_status = (resolvedMeta.show_title || resolvedMeta.episode_description) ? 'resolved' : 'partial';
    if (Object.keys(resolvedMeta).length > 0) await updateQueueItem(supabase, queueItem.id, resolvedMeta);

    if (!hasTranscriptFromResolve && !hasAudioUrl) {
      await handleFailure(supabase, queueItem, "No transcript or audio URL found", "transcript_unavailable_from_link");
      return { result: "failed", error: "No transcript or audio" };
    }

    // ── Transcribe ──
    transcriptText = hasTranscriptFromResolve ? resolveResult.transcript : "";

    if (!hasTranscriptFromResolve && hasAudioUrl) {
      await updateQueueItem(supabase, queueItem.id, { pipeline_stage: "transcribing", transcript_status: "transcribing" });

      try {
        const audioUrl = resolveResult.audio_url || resolveResult.resolved_audio_url ||
          resolveResult?.resolution?.audioEnclosureUrl || embeddedAudioUrl || directAudioFallback;
        const transcribeResp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
          body: JSON.stringify({ audio_url: audioUrl, user_id: queueItem.user_id }),
        });
        if (!transcribeResp.ok) throw new Error(`HTTP ${transcribeResp.status}: ${await transcribeResp.text()}`);
        const transcribeResult = await transcribeResp.json();
        transcriptText = transcribeResult?.transcript || transcribeResult?.text || "";
      } catch (err) {
        await handleFailure(supabase, queueItem, `Transcription failed: ${err.message}`, "transcript_unavailable_from_link");
        return { result: "failed", error: err.message };
      }
    }

    // ── Validate raw transcript ──
    const validation = validateContent(transcriptText);
    await updateQueueItem(supabase, queueItem.id, { content_validation: validation.details });

    // ── Trailer detection + YouTube fallback ──
    // If transcript is very short (< 500 words), it's likely a trailer/teaser clip
    const wordCount = transcriptText.split(/\s+/).filter(Boolean).length;
    const isLikelyTrailer = validation.valid && wordCount < 500;
    const isInvalid = !validation.valid;

    if (isLikelyTrailer || isInvalid) {
      const showTitle = queueItem.show_author || queueItem.show_title || "";
      const episodeTitle = queueItem.episode_title || "";
      console.log(`[${queueItem.id}] ${isLikelyTrailer ? `Short transcript (${wordCount} words) — likely trailer` : `Invalid content: ${validation.reason}`}. Trying YouTube fallback...`);

      await updateQueueItem(supabase, queueItem.id, { pipeline_stage: "youtube_fallback" });

      const ytTranscript = await tryYouTubeFallback(supabaseUrl, serviceRoleKey, showTitle, episodeTitle);

      if (ytTranscript && ytTranscript.length > transcriptText.length) {
        console.log(`[${queueItem.id}] YouTube fallback succeeded: ${ytTranscript.length} chars (was ${transcriptText.length})`);
        transcriptText = ytTranscript;
        resolvedMeta.resolution_method = "youtube_fallback";
        await updateQueueItem(supabase, queueItem.id, { resolution_method: "youtube_fallback" });
      } else if (isInvalid) {
        // Original was invalid and YouTube fallback didn't help
        await supabase.from("podcast_import_queue").update({
          status: "failed", pipeline_stage: "failed",
          transcript_status: "transcript_failed", failure_type: validation.reason,
          error_message: `Content validation failed: ${validation.reason}. YouTube fallback also failed.`,
          processed_at: now(), content_validation: validation.details, updated_at: now(),
        }).eq("id", queueItem.id);
        return { result: "content_invalid", error: validation.reason || undefined };
      } else {
        console.log(`[${queueItem.id}] YouTube fallback returned nothing better, using short transcript as-is`);
      }
    }

    await updateQueueItem(supabase, queueItem.id, {
      pipeline_stage: "transcript_ready",
      transcript_status: "transcript_ready",
      raw_transcript: transcriptText,
    });
  }

  // ── Preprocess transcript ──
  await updateQueueItem(supabase, queueItem.id, { pipeline_stage: "preprocessing" });
  let structuredContent = transcriptText;
  let sectionCount = 0;

  try {
    const preprocessResp = await fetch(`${supabaseUrl}/functions/v1/preprocess-transcript`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        transcript: transcriptText,
        episode_title: queueItem.episode_title,
        episode_guest: queueItem.episode_guest,
        show_name: queueItem.show_author,
      }),
    });

    if (preprocessResp.ok) {
      const preprocessResult = await preprocessResp.json();
      const structured = preprocessResult.structured_transcript || "";
      sectionCount = preprocessResult.section_count || 0;

      const structValidation = validateStructuredTranscript(structured, transcriptText.length);
      const ppValidation = preprocessResult.validation || { valid: true, issues: [] };
      const allIssues = [...structValidation.issues, ...(ppValidation.issues || [])];

      if (allIssues.length > 0) {
        console.warn(`[${queueItem.id}] Preprocess validation failed: ${allIssues.join(", ")}`);
        await supabase.from("podcast_import_queue").update({
          status: "failed", pipeline_stage: "failed",
          transcript_status: "transcript_failed", failure_type: "preprocess_invalid",
          error_message: `Preprocessing guardrails failed: ${allIssues.join("; ")}`,
          processed_at: now(), transcript_length: transcriptText.length,
          transcript_section_count: sectionCount, transcript_preview: transcriptText.slice(0, 500),
          structured_transcript: structured,
          content_validation: { preprocess_issues: allIssues, retention_ratio: structured.length / Math.max(transcriptText.length, 1) },
          updated_at: now(),
        }).eq("id", queueItem.id);
        return { result: "preprocess_invalid", error: allIssues.join("; ") };
      }

      structuredContent = structured;
      console.log(`[${queueItem.id}] Preprocessed: ${transcriptText.length} → ${structuredContent.length} chars, ${sectionCount} sections`);
    } else {
      console.warn(`[${queueItem.id}] Preprocessing failed (${preprocessResp.status}), using raw transcript`);
    }
  } catch (err) {
    console.warn(`[${queueItem.id}] Preprocessing error: ${err.message}, using raw transcript`);
  }

  await updateQueueItem(supabase, queueItem.id, {
    pipeline_stage: "saving_resource",
    transcript_status: "transcript_structured",
    structured_transcript: structuredContent,
    transcript_length: structuredContent.length,
    transcript_section_count: sectionCount,
    transcript_preview: structuredContent.slice(0, 500),
  });

  // ── Save resource ──
  let resourceId = queueItem.resource_id;

  if (resourceId && isReprocessStructure) {
    await supabase.from("resources").update({
      content: structuredContent, content_length: structuredContent.length, updated_at: now(),
    }).eq("id", resourceId);
  } else {
    try {
      let folderId: string | null = null;
      const folderName = "Podcasts";
      const { data: folders } = await supabase
        .from("resource_folders").select("id")
        .eq("user_id", queueItem.user_id).is("parent_id", null)
        .ilike("name", folderName).limit(1);
      folderId = folders?.[0]?.id || null;
      if (!folderId) {
        const { data: newF } = await supabase
          .from("resource_folders").insert({ name: folderName, user_id: queueItem.user_id })
          .select("id").single();
        folderId = newF?.id || null;
      }

      const description = [
        queueItem.episode_guest ? `Guest: ${queueItem.episode_guest}` : null,
        queueItem.show_author ? `Show: ${queueItem.show_author}` : null,
        `Source: podcast · Ingested ${new Date().toISOString().split("T")[0]}`,
      ].filter(Boolean).join("\n");

      // Merge resolved metadata over stale queueItem values
      const merged = { ...queueItem, ...resolvedMeta };
      const detectedPlatformTag = detectPlatform(queueItem.episode_url);
      const insertPayload: Record<string, any> = {
        user_id: queueItem.user_id,
        title: merged.episode_title || queueItem.episode_url,
        description,
        resource_type: "transcript",
        tags: ["podcast", detectedPlatformTag].filter(t => t !== "unknown"),
        folder_id: folderId,
        file_url: queueItem.episode_url,
        content: structuredContent,
        content_status: "enriched",
        content_length: structuredContent.length,
        enrichment_status: "deep_enriched",
        enrichment_version: 2,
        validation_version: 2,
        original_url: merged.original_episode_url || queueItem.episode_url,
        audio_url: merged.audio_url || null,
        host_platform: merged.host_platform || null,
        show_title: merged.show_title || queueItem.show_author || null,
        episode_description: merged.episode_description?.slice(0, 5000) || null,
        artwork_url: merged.artwork_url || null,
        transcript_status: "transcript_structured",
        metadata_status: merged.metadata_status || "pending",
        resolution_method: merged.resolution_method || "transcribed",
        content_classification: "audio",
      };

      if (queueItem.source_registry_id) insertPayload.source_registry_id = queueItem.source_registry_id;
      if (queueItem.episode_guest) insertPayload.author_or_speaker = queueItem.episode_guest;
      else if (queueItem.show_author) insertPayload.author_or_speaker = queueItem.show_author;
      if (queueItem.episode_published) insertPayload.source_published_at = queueItem.episode_published;

      const { data: resource, error: insertErr } = await supabase
        .from("resources").insert(insertPayload).select("id").single();
      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
      resourceId = resource.id;
    } catch (err) {
      await handleFailure(supabase, queueItem, `Save failed: ${err.message}`, "extraction_blocked");
      return { result: "failed", error: err.message };
    }
  }

  // ── Auto-generate KIs if guardrails pass ──
  const passesGuardrails = structuredContent.length >= 1000 && sectionCount >= 3;
  let kiCount = 0;

  if (passesGuardrails && resourceId) {
    await updateQueueItem(supabase, queueItem.id, {
      pipeline_stage: "generating_kis",
      ki_status: "extracting",
      resource_id: resourceId,
    });

    try {
      // Call extract-tactics directly (not batch-actionize) for faster, more reliable extraction
      const kiResp = await fetch(`${supabaseUrl}/functions/v1/extract-tactics`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          "x-batch-key": serviceRoleKey,
        },
        body: JSON.stringify({
          resourceId,
          userId: queueItem.user_id,
          persist: true,
          resourceType: "transcript",
          title: queueItem.episode_title || queueItem.source_lesson_title || "Podcast Episode",
          content: structuredContent.slice(0, 60000),
        }),
      });

      if (kiResp.ok) {
        const kiResult = await kiResp.json();
        // extract-tactics returns persistence.saved_count
        kiCount = kiResult?.persistence?.saved_count || kiResult?.items?.length || 0;
        console.log(`[${queueItem.id}] Generated ${kiCount} KIs for resource ${resourceId}`);
      } else {
        const errText = await kiResp.text();
        console.warn(`[${queueItem.id}] KI extraction failed (${kiResp.status}): ${errText}`);
        // Non-fatal: item still completes, KIs can be generated later
      }
    } catch (err) {
      console.warn(`[${queueItem.id}] KI extraction error: ${err.message}`);
    }
  }

  // ── Complete ──
  const kiStatus = kiCount > 0 ? "extracted" : (passesGuardrails ? "ready_for_review" : "awaiting_approval");
  await updateQueueItem(supabase, queueItem.id, {
    status: "complete",
    pipeline_stage: "complete",
    resource_id: resourceId,
    processed_at: now(),
    ki_status: kiStatus,
    ki_count: kiCount,
    failure_type: null,
    error_message: null,
    review_reason: passesGuardrails ? null : "Did not pass auto-approval guardrails",
  });

  console.log(`[${queueItem.id}] Complete: resource=${resourceId}, ki_count=${kiCount}, ki_status=${kiStatus}`);
  return { result: "complete", resource_id: resourceId, ki_count: kiCount };
}

// ══════════════════════════════════════════════════════════════
// Main handler — claims and processes multiple items concurrently
// ══════════════════════════════════════════════════════════════
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  logAuthMethod('process-podcast-queue', 'none', { reason: 'system_cron' });
  logServiceRoleUsage('process-podcast-queue', 'multi_user', { reason: 'queue_processing' });

  try {
    const recoveredStaleKis = await recoverStaleKiGeneration(supabase);
    // Include stale processing rows so claim_podcast_queue_items can run its watchdog
    // and re-queue items stuck after an edge timeout / interrupted KI generation.
    const staleCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count: queuedCount } = await supabase
      .from("podcast_import_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued");
    const { count: staleProcessingCount } = await supabase
      .from("podcast_import_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .lt("updated_at", staleCutoff);

    if ((!queuedCount || queuedCount === 0) && (!staleProcessingCount || staleProcessingCount === 0)) {
      return json({ message: "No queued or stale processing items", processed: 0 });
    }

    // ── Circuit breaker ──
    const { data: recentFailed } = await supabase
      .from("podcast_import_queue")
      .select("failure_type, processed_at")
      .eq("status", "failed")
      .order("processed_at", { ascending: false })
      .limit(CIRCUIT_BREAKER_THRESHOLD);

    if (recentFailed && recentFailed.length >= CIRCUIT_BREAKER_THRESHOLD) {
      const sameError = recentFailed.every((r: any) => r.failure_type === recentFailed[0].failure_type);
      if (sameError) {
        const { count: successAfter } = await supabase
          .from("podcast_import_queue")
          .select("id", { count: "exact", head: true })
          .eq("status", "completed")
          .gt("processed_at", recentFailed[recentFailed.length - 1].processed_at || "1970-01-01");

        if (!successAfter || successAfter === 0) {
          const failureReason = recentFailed[0].failure_type;
          console.error(`CIRCUIT BREAKER: ${CIRCUIT_BREAKER_THRESHOLD} consecutive "${failureReason}" failures. Pausing remaining queued items.`);

          await supabase.from("podcast_import_queue").update({
            status: "failed", pipeline_stage: "failed",
            error_message: `Circuit breaker: ${CIRCUIT_BREAKER_THRESHOLD}+ consecutive "${failureReason}" failures. Queue paused.`,
            failure_type: "circuit_breaker", processed_at: now(), updated_at: now(),
          }).eq("status", "queued");

          return json({ message: "Circuit breaker triggered", failure_type: failureReason, paused_remaining: true });
        }
      }
    }

    // ── Atomically claim items with global concurrency guard ──
    const { data: candidates, error: claimErr } = await supabase
      .rpc("claim_podcast_queue_items", { p_max_items: CONCURRENCY, p_max_processing: CONCURRENCY });

    if (claimErr) {
      console.error("Claim RPC error:", claimErr);
      return json({ error: "Failed to claim items" }, 500);
    }

    if (!candidates?.length) {
      return json({ message: "No queued items (or concurrency cap reached)", processed: 0 });
    }

    console.log(`Atomically claimed ${candidates.length} items for processing`);

    // ── Process all items concurrently ──
    const results = await Promise.allSettled(
      candidates.map((item: any) => processItem(supabase, supabaseUrl, serviceRoleKey, item))
    );

    // ── Update batch rollup for any batch_ids ──
    const batchIds = [...new Set(candidates.map((c: any) => c.batch_id).filter(Boolean))];
    for (const batchId of batchIds) {
      await updateBatchRollup(supabase, batchId);
    }

    // ── Summarize results ──
    const summary = results.map((r, i) => {
      if (r.status === "fulfilled") return { id: candidates[i].id, ...r.value };
      return { id: candidates[i].id, result: "error", error: r.reason?.message || "Unknown" };
    });

    const succeeded = summary.filter(s => s.result === "complete" || s.result === "skipped_duplicate").length;
    const failed = summary.filter(s => s.result === "failed" || s.result === "error").length;
    const totalKIs = summary.reduce((sum, s) => sum + ((s as any).ki_count || 0), 0);

    console.log(`Batch complete: ${succeeded} succeeded, ${failed} failed, ${totalKIs} KIs generated`);

    return json({ processed: candidates.length, succeeded, failed, totalKIs, items: summary });
  } catch (err) {
    console.error("process-podcast-queue fatal error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

// ══════════════════════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════════════════════

function now() {
  return new Date().toISOString();
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function updateQueueItem(supabase: any, id: string, fields: Record<string, any>) {
  await supabase
    .from("podcast_import_queue")
    .update({ ...fields, updated_at: now() })
    .eq("id", id);
}

async function handleFailure(supabase: any, item: any, errorMessage: string, failureType?: string) {
  const newAttempts = (item.attempts || 0) + 1;
  const terminalTypes = ["content_invalid", "content_invalid_html", "content_invalid_css", "content_bot_or_login_wall", "content_ui_fragments", "preprocess_invalid"];
  const isTerminal = failureType && terminalTypes.includes(failureType);
  const newStatus = isTerminal || newAttempts >= MAX_ATTEMPTS ? "failed" : "queued";

  await supabase.from("podcast_import_queue").update({
    status: newStatus,
    pipeline_stage: newStatus === "failed" ? "failed" : "queued",
    attempts: newAttempts,
    error_message: errorMessage,
    failure_type: failureType || null,
    transcript_status: newStatus === "failed" ? "transcript_failed" : "pending",
    ...(newStatus === "failed" ? { processed_at: now() } : {}),
    updated_at: now(),
  }).eq("id", item.id);

  console.log(`[${item.id}] ${newStatus} (attempt ${newAttempts}/${MAX_ATTEMPTS}) — ${errorMessage}`);
}

async function recoverStaleKiGeneration(supabase: any): Promise<number> {
  const staleCutoff = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: staleItems, error } = await supabase
    .from("podcast_import_queue")
    .select("id, resource_id, batch_id, error_message")
    .eq("status", "processing")
    .eq("pipeline_stage", "generating_kis")
    .not("resource_id", "is", null)
    .lt("updated_at", staleCutoff)
    .limit(25);

  if (error) {
    console.warn(`Failed stale KI recovery lookup: ${error.message}`);
    return 0;
  }

  let recovered = 0;
  const batchIds = new Set<string>();
  for (const item of staleItems || []) {
    const { count } = await supabase
      .from("knowledge_items")
      .select("id", { count: "exact", head: true })
      .eq("source_resource_id", item.resource_id);

    const kiCount = count || 0;
    await supabase.from("podcast_import_queue").update({
      status: "complete",
      pipeline_stage: "complete",
      processed_at: now(),
      ki_status: kiCount > 0 ? "extracted" : "ready_for_review",
      ki_count: kiCount,
      error_message: item.error_message || (kiCount > 0
        ? "Recovered after stale KI generation; KIs were already saved."
        : "Recovered after stale KI generation timeout; ready for manual KI generation."),
      updated_at: now(),
    }).eq("id", item.id);

    if (item.batch_id) batchIds.add(item.batch_id);
    recovered++;
  }

  for (const batchId of batchIds) {
    await updateBatchRollup(supabase, batchId);
  }

  if (recovered > 0) console.log(`Recovered ${recovered} stale podcast KI generation item(s)`);
  return recovered;
}

async function updateBatchRollup(supabase: any, batchId: string) {
  try {
    // Count statuses for this batch
    const { data: items } = await supabase
      .from("podcast_import_queue")
      .select("status, ki_count")
      .eq("batch_id", batchId);

    if (!items) return;

    const counts = { succeeded: 0, failed: 0, skipped: 0 };
    let totalKIs = 0;
    for (const item of items) {
      if (item.status === "complete") counts.succeeded++;
      else if (item.status === "failed") counts.failed++;
      else if (item.status === "skipped") counts.skipped++;
      totalKIs += item.ki_count || 0;
    }

    const allDone = counts.succeeded + counts.failed + counts.skipped === items.length;

    await supabase.from("batch_runs").update({
      succeeded: counts.succeeded,
      failed: counts.failed,
      skipped: counts.skipped,
      ...(allDone ? { ended_at: now() } : {}),
    }).eq("id", batchId);
  } catch (err) {
    console.warn(`Failed to update batch rollup for ${batchId}: ${err.message}`);
  }
}
