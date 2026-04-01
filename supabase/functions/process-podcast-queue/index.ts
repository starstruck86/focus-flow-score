/**
 * process-podcast-queue
 * ---------------------
 * Processes one podcast_import_queue item through the pipeline:
 * Claim → Dedup → Resolve → Transcribe → Validate → Preprocess → Validate Structure → Save
 * 
 * After transcript is saved, ki_status = 'awaiting_approval'.
 * KI extraction is NEVER auto-triggered. User must approve then generate.
 * 
 * Reprocess modes:
 *   - "structure": re-runs preprocess-transcript from raw_transcript (no re-transcription)
 *   - "full": full pipeline re-run (default for queued items)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;

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
  if (u.endsWith(".mp3") || u.endsWith(".m4a") || u.endsWith(".wav")) return "direct_audio";
  if (u.includes("/feed") || u.includes("rss") || u.includes(".xml")) return "rss_direct";
  return "unknown";
}

// ── Content validation ──
function validateContent(content: string): { valid: boolean; reason: string | null; details: Record<string, any> } {
  const details: Record<string, any> = { length: content.length };

  if (content.length < 200) {
    return { valid: false, reason: "content_too_short", details: { ...details, min_required: 200 } };
  }

  if (HTML_PATTERNS.test(content)) {
    const htmlMatches = content.match(/<[a-z][^>]*>/gi) || [];
    details.html_tag_count = htmlMatches.length;
    if (htmlMatches.length > 5) {
      return { valid: false, reason: "content_invalid_html", details };
    }
  }

  if (CSS_PATTERNS.test(content)) {
    return { valid: false, reason: "content_invalid_css", details };
  }

  if (BOT_PATTERNS.test(content)) {
    return { valid: false, reason: "content_bot_or_login_wall", details };
  }

  // Check content density — if mostly short lines, probably UI fragments
  const lines = content.split("\n").filter(l => l.trim().length > 0);
  const avgLineLen = content.length / Math.max(lines.length, 1);
  if (lines.length > 20 && avgLineLen < 15) {
    details.avg_line_length = avgLineLen;
    return { valid: false, reason: "content_ui_fragments", details };
  }

  return { valid: true, reason: null, details };
}

// ── Structured transcript validation ──
function validateStructuredTranscript(
  structured: string,
  rawLength: number,
): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  const headingCount = (structured.match(/^## /gm) || []).length;
  const retentionRatio = structured.length / Math.max(rawLength, 1);

  if (headingCount < 2) {
    issues.push(`too_few_headings (${headingCount})`);
  }
  if (retentionRatio < 0.15) {
    issues.push(`over_compressed (${Math.round(retentionRatio * 100)}% retained)`);
  }
  if (structured.length < 200) {
    issues.push(`too_short (${structured.length} chars)`);
  }

  return { valid: issues.length === 0, issues };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  try {
    // ── Step 1: Claim one queued item ──
    const { data: candidates } = await supabase
      .from("podcast_import_queue")
      .select("*")
      .eq("status", "queued")
      .order("created_at", { ascending: true })
      .limit(1);

    if (!candidates?.length) {
      return json({ message: "No queued items", processed: 0 });
    }

    const queueItem = candidates[0];
    const isReprocessStructure = queueItem.transcript_status === "transcript_ready" && queueItem.raw_transcript;

    const { error: claimErr } = await supabase
      .from("podcast_import_queue")
      .update({
        status: "processing",
        updated_at: now(),
        platform: detectPlatform(queueItem.episode_url),
        transcript_status: isReprocessStructure ? "transcript_ready" : "resolving_link",
      })
      .eq("id", queueItem.id)
      .eq("status", "queued");

    if (claimErr) {
      return json({ message: "Failed to claim item", error: claimErr.message }, 500);
    }

    console.log(`Processing: ${queueItem.id} — ${queueItem.episode_title}${isReprocessStructure ? " (reprocess-structure)" : ""}`);

    // ── Reprocess Structure path: skip steps 2-4, use existing raw_transcript ──
    let transcriptText: string;

    if (isReprocessStructure) {
      transcriptText = queueItem.raw_transcript;
    } else {
      // ── Step 2: Dedup check ──
      const { data: existing } = await supabase
        .from("resources")
        .select("id")
        .eq("user_id", queueItem.user_id)
        .eq("file_url", queueItem.episode_url)
        .limit(1);

      if (existing?.length) {
        await updateQueueItem(supabase, queueItem.id, {
          status: "complete",
          resource_id: existing[0].id,
          processed_at: now(),
          transcript_status: "skipped_duplicate",
          ki_status: "skipped",
          error_message: "Already imported (dedup)",
        });
        return json({ processed: 1, result: "skipped_duplicate", resource_id: existing[0].id });
      }

      // ── Step 3: Resolve podcast episode ──
      let resolveResult: any;
      try {
        const resolveResp = await fetch(`${supabaseUrl}/functions/v1/resolve-podcast-episode`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            url: queueItem.episode_url,
            user_id: queueItem.user_id,
          }),
        });

        if (!resolveResp.ok) {
          const errText = await resolveResp.text();
          throw new Error(`HTTP ${resolveResp.status}: ${errText}`);
        }

        resolveResult = await resolveResp.json();
      } catch (err) {
        await handleFailure(supabase, queueItem, `Resolution failed: ${err.message}`, "audio_unresolvable");
        return json({ processed: 1, result: "failed", error: err.message });
      }

      const hasTranscriptFromResolve = resolveResult?.transcript && resolveResult.transcript.length > 200;
      const hasAudioUrl = resolveResult?.audio_url || resolveResult?.resolved_audio_url;

      if (!hasTranscriptFromResolve && !hasAudioUrl) {
        await handleFailure(supabase, queueItem, "No transcript or audio URL found", "transcript_unavailable_from_link");
        return json({ processed: 1, result: "failed", error: "No transcript or audio" });
      }

      // ── Step 4: Transcribe if needed ──
      transcriptText = hasTranscriptFromResolve ? resolveResult.transcript : "";

      if (!hasTranscriptFromResolve && hasAudioUrl) {
        await updateQueueItem(supabase, queueItem.id, {
          transcript_status: "audio_resolved",
        });

        try {
          await updateQueueItem(supabase, queueItem.id, {
            transcript_status: "transcribing",
          });

          const audioUrl = resolveResult.audio_url || resolveResult.resolved_audio_url;
          const transcribeResp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              audio_url: audioUrl,
              user_id: queueItem.user_id,
            }),
          });

          if (!transcribeResp.ok) {
            const errText = await transcribeResp.text();
            throw new Error(`HTTP ${transcribeResp.status}: ${errText}`);
          }

          const transcribeResult = await transcribeResp.json();
          transcriptText = transcribeResult?.transcript || transcribeResult?.text || "";
        } catch (err) {
          await handleFailure(supabase, queueItem, `Transcription failed: ${err.message}`, "transcript_unavailable_from_link");
          return json({ processed: 1, result: "failed", error: err.message });
        }
      }

      // ── Step 5: Validate raw transcript content ──
      const validation = validateContent(transcriptText);
      await updateQueueItem(supabase, queueItem.id, {
        content_validation: validation.details,
      });

      if (!validation.valid) {
        await supabase
          .from("podcast_import_queue")
          .update({
            status: "failed",
            transcript_status: "transcript_failed",
            failure_type: validation.reason,
            error_message: `Content validation failed: ${validation.reason}`,
            processed_at: now(),
            content_validation: validation.details,
            updated_at: now(),
          })
          .eq("id", queueItem.id);

        return json({ processed: 1, result: "content_invalid", reason: validation.reason });
      }

      // Save raw transcript — never overwritten
      await updateQueueItem(supabase, queueItem.id, {
        transcript_status: "transcript_ready",
        raw_transcript: transcriptText,
      });
    }

    // ── Step 6: Preprocess transcript into structured markdown ──
    let structuredContent = transcriptText;
    let sectionCount = 0;

    try {
      const preprocessResp = await fetch(`${supabaseUrl}/functions/v1/preprocess-transcript`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
        },
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

        // ── Validate structured output ──
        const structValidation = validateStructuredTranscript(structured, transcriptText.length);
        const ppValidation = preprocessResult.validation || { valid: true, issues: [] };

        const allIssues = [...structValidation.issues, ...(ppValidation.issues || [])];

        if (allIssues.length > 0) {
          console.warn(`Preprocess validation failed: ${allIssues.join(", ")}`);

          await supabase
            .from("podcast_import_queue")
            .update({
              status: "failed",
              transcript_status: "transcript_failed",
              failure_type: "preprocess_invalid",
              error_message: `Preprocessing guardrails failed: ${allIssues.join("; ")}`,
              processed_at: now(),
              transcript_length: transcriptText.length,
              transcript_section_count: sectionCount,
              transcript_preview: transcriptText.slice(0, 500),
              structured_transcript: structured,
              content_validation: {
                preprocess_issues: allIssues,
                retention_ratio: structured.length / Math.max(transcriptText.length, 1),
              },
              updated_at: now(),
            })
            .eq("id", queueItem.id);

          return json({ processed: 1, result: "preprocess_invalid", issues: allIssues });
        }

        structuredContent = structured;
        console.log(`Preprocessed: ${transcriptText.length} → ${structuredContent.length} chars, ${sectionCount} sections`);
      } else {
        console.warn(`Preprocessing failed (${preprocessResp.status}), using raw transcript`);
        sectionCount = 0;
      }
    } catch (err) {
      console.warn(`Preprocessing error: ${err.message}, using raw transcript`);
    }

    // Save structured transcript and preview data
    await updateQueueItem(supabase, queueItem.id, {
      transcript_status: "transcript_structured",
      structured_transcript: structuredContent,
      transcript_length: structuredContent.length,
      transcript_section_count: sectionCount,
      transcript_preview: structuredContent.slice(0, 500),
    });

    // ── Step 7: Create or update resource ──
    let resourceId = queueItem.resource_id;

    if (resourceId && isReprocessStructure) {
      // Update existing resource with new structured content
      await supabase
        .from("resources")
        .update({
          content: structuredContent,
          content_length: structuredContent.length,
          updated_at: now(),
        })
        .eq("id", resourceId);
    } else {
      // Create new resource
      try {
        let folderId: string | null = null;
        const folderName = "Podcasts";
        const { data: folders } = await supabase
          .from("resource_folders")
          .select("id")
          .eq("user_id", queueItem.user_id)
          .is("parent_id", null)
          .ilike("name", folderName)
          .limit(1);

        folderId = folders?.[0]?.id || null;
        if (!folderId) {
          const { data: newF } = await supabase
            .from("resource_folders")
            .insert({ name: folderName, user_id: queueItem.user_id })
            .select("id")
            .single();
          folderId = newF?.id || null;
        }

        const description = [
          queueItem.episode_guest ? `Guest: ${queueItem.episode_guest}` : null,
          queueItem.show_author ? `Show: ${queueItem.show_author}` : null,
          `Source: podcast · Ingested ${new Date().toISOString().split("T")[0]}`,
        ].filter(Boolean).join("\n");

        const insertPayload: Record<string, any> = {
          user_id: queueItem.user_id,
          title: queueItem.episode_title || queueItem.episode_url,
          description,
          resource_type: "transcript",
          tags: ["podcast", detectPlatform(queueItem.episode_url)].filter(t => t !== "unknown"),
          folder_id: folderId,
          file_url: queueItem.episode_url,
          content: structuredContent,
          content_status: "enriched",
          content_length: structuredContent.length,
        };

        if (queueItem.source_registry_id) {
          insertPayload.source_registry_id = queueItem.source_registry_id;
        }
        if (queueItem.episode_guest) {
          insertPayload.author_or_speaker = queueItem.episode_guest;
        } else if (queueItem.show_author) {
          insertPayload.author_or_speaker = queueItem.show_author;
        }
        if (queueItem.episode_published) {
          insertPayload.source_published_at = queueItem.episode_published;
        }

        const { data: resource, error: insertErr } = await supabase
          .from("resources")
          .insert(insertPayload)
          .select("id")
          .single();

        if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
        resourceId = resource.id;
      } catch (err) {
        await handleFailure(supabase, queueItem, `Save failed: ${err.message}`, "extraction_blocked");
        return json({ processed: 1, result: "failed", error: err.message });
      }
    }

    // ── Step 8: Mark complete — awaiting user approval ──
    await updateQueueItem(supabase, queueItem.id, {
      status: "complete",
      resource_id: resourceId,
      processed_at: now(),
      ki_status: "awaiting_approval",
      failure_type: null,
      error_message: null,
      review_reason: null,
    });

    return json({
      processed: 1,
      result: "complete",
      resource_id: resourceId,
      ki_status: "awaiting_approval",
    });
  } catch (err) {
    console.error("process-podcast-queue fatal error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});

// ── Helpers ──

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

  await supabase
    .from("podcast_import_queue")
    .update({
      status: newStatus,
      attempts: newAttempts,
      error_message: errorMessage,
      failure_type: failureType || null,
      transcript_status: newStatus === "failed" ? "transcript_failed" : "pending",
      ...(newStatus === "failed" ? { processed_at: now() } : {}),
      updated_at: now(),
    })
    .eq("id", item.id);

  console.log(`Queue item ${item.id}: ${newStatus} (attempt ${newAttempts}/${MAX_ATTEMPTS}) — ${errorMessage}`);
}
