/**
 * Zoom Session-Assisted Capture
 *
 * Generates a capture script that runs in the user's browser on a Zoom recording page.
 * The script reads the authenticated DOM to extract transcript, caption URLs, media URLs,
 * and player config — data only available in a logged-in browser session.
 *
 * Two delivery mechanisms:
 *   1. Bookmarklet — user drags to bookmark bar, clicks on Zoom page
 *   2. Console paste — user copies script, pastes into DevTools console on Zoom page
 *
 * The capture script posts results back to the opener window via postMessage.
 */

import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';

// ── Types ──────────────────────────────────────────────

export interface ZoomCaptureResult {
  transcript_text: string | null;
  transcript_tab_visible: boolean;
  caption_url: string | null;
  media_url: string | null;
  player_loaded: boolean;
  meeting_topic: string | null;
  meeting_id: string | null;
  duration: string | null;
  recording_date: string | null;
  page_title: string | null;
  runtime_config_keys: string[];
  raw_html_length: number;
  capture_strategies_tried: string[];
  capture_strategies_succeeded: string[];
  error: string | null;
}

export type ZoomSessionState =
  | 'idle'
  | 'waiting_for_capture'
  | 'processing'
  | 'succeeded'
  | 'failed';

// ── Capture Script ─────────────────────────────────────

/**
 * Generate the JavaScript capture script that runs on the Zoom recording page.
 * The script is self-contained and posts results back via window.opener.postMessage
 * or copies to clipboard as fallback.
 */
export function generateCaptureScript(originUrl: string): string {
  // This script runs in the context of the Zoom recording page
  return `(function(){
  'use strict';
  var result = {
    transcript_text: null,
    transcript_tab_visible: false,
    caption_url: null,
    media_url: null,
    player_loaded: false,
    meeting_topic: null,
    meeting_id: null,
    duration: null,
    recording_date: null,
    page_title: document.title || null,
    runtime_config_keys: [],
    raw_html_length: document.documentElement.innerHTML.length,
    capture_strategies_tried: [],
    capture_strategies_succeeded: [],
    error: null
  };

  try {
    /* ── Strategy 1: Transcript tab capture ── */
    result.capture_strategies_tried.push('transcript_tab');
    var transcriptPanel = document.querySelector('[class*="transcript"], [id*="transcript"], [data-testid*="transcript"]');
    if (!transcriptPanel) {
      var tabs = document.querySelectorAll('button, [role="tab"], a');
      for (var i = 0; i < tabs.length; i++) {
        if (/transcript/i.test(tabs[i].textContent || '')) {
          tabs[i].click();
          result.transcript_tab_visible = true;
          break;
        }
      }
      if (result.transcript_tab_visible) {
        // Wait briefly for transcript content to render
        var waitStart = Date.now();
        while (Date.now() - waitStart < 2000) { /* busy wait for sync script */ }
        transcriptPanel = document.querySelector('[class*="transcript"], [id*="transcript"], [data-testid*="transcript"]');
      }
    } else {
      result.transcript_tab_visible = true;
    }
    if (transcriptPanel) {
      var lines = transcriptPanel.querySelectorAll('p, span, div, [class*="sentence"], [class*="line"], [class*="text"]');
      var texts = [];
      var seen = new Set();
      lines.forEach(function(el) {
        var t = (el.textContent || '').trim();
        if (t.length > 2 && !seen.has(t)) { seen.add(t); texts.push(t); }
      });
      if (texts.length > 3) {
        result.transcript_text = texts.join('\\n');
        result.capture_strategies_succeeded.push('transcript_tab');
      }
    }

    /* ── Strategy 2: Caption / VTT endpoint from network or config ── */
    result.capture_strategies_tried.push('caption_endpoint');
    var html = document.documentElement.innerHTML;
    var captionMatch = html.match(/["'](https?:\\/\\/[^"']*\\.(vtt|srt|json)[^"']*caption[^"']*)["']/i)
      || html.match(/["'](https?:\\/\\/[^"']*caption[^"']*\\.(vtt|srt|json)[^"']*)["']/i)
      || html.match(/["'](https?:\\/\\/[^"']*cc_url[^"']*)["']/i);
    if (captionMatch) {
      result.caption_url = captionMatch[1];
      result.capture_strategies_succeeded.push('caption_endpoint');
    }
    // Also check for transcript download URLs
    var dlMatch = html.match(/["'](https?:\\/\\/[^"']*download[^"']*transcript[^"']*)["']/i)
      || html.match(/["'](https?:\\/\\/[^"']*transcript[^"']*download[^"']*)["']/i);
    if (dlMatch && !result.caption_url) {
      result.caption_url = dlMatch[1];
      result.capture_strategies_succeeded.push('caption_endpoint');
    }

    /* ── Strategy 3: Media URL from runtime config ── */
    result.capture_strategies_tried.push('media_url');
    var mediaMatch = html.match(/["'](https?:\\/\\/[^"']*\\.mp4[^"']*)["']/i)
      || html.match(/viewMp4Url["']?\\s*[:=]\\s*["'](https?:\\/\\/[^"']+)["']/i)
      || html.match(/["'](https?:\\/\\/[^"']*recording[^"']*\\.mp4[^"']*)["']/i);
    if (mediaMatch) {
      result.media_url = mediaMatch[1];
      result.capture_strategies_succeeded.push('media_url');
    }

    /* ── Strategy 4: Runtime config / bootstrap JSON ── */
    result.capture_strategies_tried.push('runtime_config');
    var scripts = document.querySelectorAll('script');
    for (var s = 0; s < scripts.length; s++) {
      var src = scripts[s].textContent || '';
      if (src.length > 500 && (/meetingTopic|recording|fileUrl|viewMp4/i.test(src))) {
        result.player_loaded = true;
        // Extract meeting metadata from config
        var topicM = src.match(/meetingTopic["']?\\s*[:=]\\s*["']([^"']+)/i);
        if (topicM) result.meeting_topic = topicM[1];
        var idM = src.match(/meetingId["']?\\s*[:=]\\s*["']?([\\d]+)/i);
        if (idM) result.meeting_id = idM[1];
        var durM = src.match(/duration["']?\\s*[:=]\\s*["']?([\\d:]+)/i);
        if (durM) result.duration = durM[1];
        // Collect config keys for provenance
        var keyMatches = src.match(/["']?(\\w{4,})["']?\\s*:/g);
        if (keyMatches) {
          result.runtime_config_keys = keyMatches.slice(0, 30).map(function(k){ return k.replace(/[:"']/g,'').trim(); });
        }
        // Check for caption URL in config
        var ccMatch = src.match(/cc_url["']?\\s*[:=]\\s*["'](https?:\\/\\/[^"']+)/i);
        if (ccMatch && !result.caption_url) {
          result.caption_url = ccMatch[1];
          result.capture_strategies_succeeded.push('runtime_caption');
        }
        // Check for media URL in config
        var mpMatch = src.match(/viewMp4Url["']?\\s*[:=]\\s*["'](https?:\\/\\/[^"']+)/i)
          || src.match(/fileUrl["']?\\s*[:=]\\s*["'](https?:\\/\\/[^"']+\\.mp4[^"']*)/i);
        if (mpMatch && !result.media_url) {
          result.media_url = mpMatch[1];
          result.capture_strategies_succeeded.push('runtime_media');
        }
        result.capture_strategies_succeeded.push('runtime_config');
        break;
      }
    }

    /* ── Strategy 5: Page metadata fallback ── */
    result.capture_strategies_tried.push('page_metadata');
    if (!result.meeting_topic) {
      var ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) result.meeting_topic = ogTitle.getAttribute('content');
    }
    var dateEl = document.querySelector('[class*="date"], [class*="time"], time');
    if (dateEl) result.recording_date = (dateEl.textContent || '').trim();

    /* ── Detect player loaded ── */
    if (document.querySelector('video, [class*="player"], [id*="player"]')) {
      result.player_loaded = true;
    }

  } catch(e) {
    result.error = e.message || String(e);
  }

  /* ── Deliver result ── */
  var origin = ${JSON.stringify(originUrl)};
  if (window.opener) {
    window.opener.postMessage({ type: 'ZOOM_CAPTURE_RESULT', payload: result }, origin);
    alert('✅ Capture complete — returning to app. You can close this tab.');
  } else {
    // Fallback: copy to clipboard
    var json = JSON.stringify(result, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json).then(function(){
        alert('✅ Capture data copied to clipboard. Paste it back in the app.');
      });
    } else {
      prompt('Copy this capture data and paste it back in the app:', json);
    }
  }
})();`;
}

/**
 * Generate a bookmarklet URL from the capture script.
 */
export function generateBookmarklet(originUrl: string): string {
  const script = generateCaptureScript(originUrl);
  return 'javascript:' + encodeURIComponent(script);
}

// ── Processing captured data ───────────────────────────

/**
 * Process a ZoomCaptureResult: fetch transcript from caption URL if needed,
 * persist content to resource, record attempt, re-enrich.
 */
export async function processZoomCapture(
  resourceId: string,
  userId: string,
  capture: ZoomCaptureResult,
): Promise<{ success: boolean; message: string; contentLength: number }> {
  const now = new Date().toISOString();
  let finalText = capture.transcript_text || '';
  let captionFetched = false;

  // If we got a caption URL but no transcript text, try fetching it
  if (!finalText && capture.caption_url) {
    try {
      const resp = await fetch(capture.caption_url);
      if (resp.ok) {
        const raw = await resp.text();
        finalText = cleanCaptionText(raw);
        captionFetched = true;
      }
    } catch {
      // Caption URL may be expired or auth-gated
    }
  }

  // Build metadata from whatever we captured
  const metadata: Record<string, any> = {
    meeting_topic: capture.meeting_topic,
    meeting_id: capture.meeting_id,
    duration: capture.duration,
    recording_date: capture.recording_date,
    page_title: capture.page_title,
    player_loaded: capture.player_loaded,
    transcript_tab_visible: capture.transcript_tab_visible,
    caption_url_found: !!capture.caption_url,
    media_url_found: !!capture.media_url,
    runtime_config_keys: capture.runtime_config_keys,
    strategies_tried: capture.capture_strategies_tried,
    strategies_succeeded: capture.capture_strategies_succeeded,
    raw_html_length: capture.raw_html_length,
    caption_fetched: captionFetched,
  };

  // If we still have no text, build metadata-only text from what we found
  if (!finalText && (capture.meeting_topic || capture.meeting_id)) {
    const parts: string[] = [];
    if (capture.meeting_topic) parts.push(`Topic: ${capture.meeting_topic}`);
    if (capture.meeting_id) parts.push(`Meeting ID: ${capture.meeting_id}`);
    if (capture.duration) parts.push(`Duration: ${capture.duration}`);
    if (capture.recording_date) parts.push(`Date: ${capture.recording_date}`);
    finalText = parts.join('\n');
  }

  const hasContent = finalText.length >= 50;
  const strategy = capture.capture_strategies_succeeded.length > 0
    ? `zoom_session_${capture.capture_strategies_succeeded[0]}`
    : 'zoom_session_capture';

  // Record the attempt
  await (supabase as any).from('enrichment_attempts').insert({
    resource_id: resourceId,
    user_id: userId,
    attempt_type: 'zoom_session_capture',
    strategy,
    platform: 'zoom',
    result: hasContent ? 'success' : capture.capture_strategies_succeeded.length > 0 ? 'partial' : 'failed',
    content_found: hasContent,
    transcript_url_found: !!capture.caption_url,
    media_url_found: !!capture.media_url,
    caption_url_found: !!capture.caption_url,
    shell_rejected: false,
    runtime_config_found: capture.runtime_config_keys.length > 0,
    content_length_extracted: finalText.length,
    completed_at: now,
    metadata,
    error_message: capture.error,
  });

  if (hasContent) {
    // Update resource with captured content
    await (supabase as any).from('resources').update({
      content: finalText,
      content_status: 'full',
      enrichment_status: 'not_enriched',
      failure_reason: null,
      failure_count: 0,
      content_length: finalText.length,
      manual_content_present: true,
      manual_input_required: false,
      recovery_status: 'pending_reprocess',
      resolution_method: 'zoom_session_capture',
      extraction_method: strategy,
      advanced_extraction_status: 'zoom_session_assist_succeeded',
      platform_status: 'zoom_session_captured',
      last_status_change_at: now,
    }).eq('id', resourceId);

    // Re-enrich
    try {
      await invokeEnrichResource(
        { resource_id: resourceId, force: true },
        { componentName: 'ZoomSessionCapture', timeoutMs: 90000 },
      );
    } catch {
      // Enrichment may fail but content is saved
    }

    return {
      success: true,
      message: `Captured ${finalText.length} chars via ${strategy}`,
      contentLength: finalText.length,
    };
  }

  // No content but we may have found useful metadata / URLs
  const partialInfo: string[] = [];
  if (capture.media_url) partialInfo.push('media URL found');
  if (capture.caption_url) partialInfo.push('caption URL found');
  if (capture.meeting_topic) partialInfo.push(`topic: ${capture.meeting_topic}`);

  // Update resource with what we found
  await (supabase as any).from('resources').update({
    advanced_extraction_status: partialInfo.length > 0 ? 'zoom_session_assist_partial' : 'zoom_session_assist_failed',
    platform_status: partialInfo.length > 0 ? 'zoom_session_partial' : 'zoom_session_no_content',
    recovery_status: 'zoom_session_capture_incomplete',
    last_status_change_at: now,
  }).eq('id', resourceId);

  if (capture.media_url) {
    // Store media URL for potential transcription pipeline
    await (supabase as any).from('resources').update({
      file_url: capture.media_url,
    }).eq('id', resourceId);
  }

  return {
    success: false,
    message: partialInfo.length > 0
      ? `Partial capture: ${partialInfo.join(', ')}. Full transcript not found.`
      : 'Browser capture found no extractable content.',
    contentLength: finalText.length,
  };
}

/**
 * Parse a manually pasted JSON capture result (fallback when postMessage isn't available).
 */
export function parseCaptureJson(json: string): ZoomCaptureResult | null {
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && 'capture_strategies_tried' in parsed) {
      return parsed as ZoomCaptureResult;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Helpers ────────────────────────────────────────────

function cleanCaptionText(raw: string): string {
  return raw
    .replace(/WEBVTT[\s\S]*?\n\n/, '')
    .replace(/\d+\n/g, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
