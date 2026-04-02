/**
 * Extraction Method Dispatch
 *
 * Routes each extraction method to a REAL, distinct code path.
 *
 * Methods:
 *   edge_fetch        → invoke enrich-resource-content edge function (Firecrawl-backed)
 *   direct_fetch      → fetch URL directly from browser, parse HTML, store text
 *   source_specific   → platform-aware extraction (YouTube captions, Zoom, etc.)
 *   transcript_fallback → pull existing transcript from audio_jobs or mark awaiting
 *   metadata_only     → lightweight extraction from title/description/tags only
 */

import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';
import { extractKnowledgeHeuristic, extractKnowledgeLLMFallback, type ExtractionSource } from '@/lib/knowledgeExtraction';
import { createLogger } from '@/lib/logger';
import type { CanonicalSourceType } from '@/lib/sourceTypeNormalizer';

const log = createLogger('ExtractionDispatch');

export type ExtractionMethod = 'edge_fetch' | 'direct_fetch' | 'source_specific' | 'transcript_fallback' | 'metadata_only';

export interface MethodResult {
  success: boolean;
  contentLength?: number;
  error?: string;
  methodUsed?: string;
  qualityPassed?: boolean;
}

// ── Quality gate ───────────────────────────────────────────

const MIN_QUALITY_CHARS = 100;
const JUNK_PATTERNS = [
  /^<!doctype/i,
  /^<html/i,
  /^{"error/i,
  /^undefined$/,
  /^null$/,
  /^not found$/i,
  /^access denied/i,
  /^sign in/i,
  /^please log in/i,
  /^404/,
  /^403/,
];

function passesQualityGate(content: string | null | undefined): { passed: boolean; reason?: string } {
  if (!content) return { passed: false, reason: 'No content' };
  const trimmed = content.trim();
  if (trimmed.length < MIN_QUALITY_CHARS) {
    return { passed: false, reason: `Too short (${trimmed.length} chars, min ${MIN_QUALITY_CHARS})` };
  }
  for (const pattern of JUNK_PATTERNS) {
    if (pattern.test(trimmed.slice(0, 200))) {
      return { passed: false, reason: `Junk content detected: ${pattern.source}` };
    }
  }
  // Check for meaningful word count (not just boilerplate)
  const words = trimmed.split(/\s+/).filter(w => w.length > 2);
  if (words.length < 15) {
    return { passed: false, reason: `Too few words (${words.length})` };
  }
  return { passed: true };
}

// ── Public dispatcher ──────────────────────────────────────

export async function dispatchExtractionMethod(
  resourceId: string,
  method: ExtractionMethod,
  sourceType: CanonicalSourceType,
): Promise<MethodResult> {
  log.info('Dispatching extraction', { resourceId, method, sourceType });

  let result: MethodResult;
  switch (method) {
    case 'edge_fetch':
      result = await runEdgeFetch(resourceId);
      break;
    case 'direct_fetch':
      result = await runDirectFetch(resourceId);
      break;
    case 'source_specific':
      result = await runSourceSpecific(resourceId, sourceType);
      break;
    case 'transcript_fallback':
      result = await runTranscriptFallback(resourceId);
      break;
    case 'metadata_only':
      result = await runMetadataOnly(resourceId);
      break;
    default:
      result = { success: false, error: `Unknown method: ${method}` };
  }

  result.methodUsed = method;

  // Apply quality gate on success
  if (result.success && result.contentLength !== undefined) {
    const content = await getResourceContent(resourceId);
    const quality = passesQualityGate(content);
    result.qualityPassed = quality.passed;
    if (!quality.passed) {
      log.warn('Quality gate failed', { resourceId, method, reason: quality.reason });
      result.success = false;
      result.error = `Quality gate: ${quality.reason}`;
    }
  }

  return result;
}

// ── Enrichment (separate from extraction) ──────────────────

export async function runEnrichmentOnly(resourceId: string): Promise<MethodResult> {
  log.info('Running enrichment-only', { resourceId });

  const { data: resource } = await supabase
    .from('resources')
    .select('id, title, content, description, tags, resource_type, content_length')
    .eq('id', resourceId)
    .single();

  if (!resource) return { success: false, error: 'Resource not found' };

  const r = resource as any;
  const contentLen = Math.max(r.content?.length ?? 0, r.content_length ?? 0);

  if (contentLen < 30) {
    return { success: false, error: `Insufficient content for enrichment (${contentLen} chars)` };
  }

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData?.user?.id;
  if (!userId) return { success: false, error: 'Not authenticated' };

  // Check if KIs already exist
  const { data: existingKI } = await supabase
    .from('knowledge_items')
    .select('id')
    .eq('source_resource_id', resourceId)
    .limit(1);

  if ((existingKI?.length ?? 0) > 0) {
    return { success: true, contentLength: contentLen };
  }

  const source: ExtractionSource = {
    resourceId,
    userId,
    title: r.title ?? '',
    content: r.content ?? '',
    description: r.description ?? '',
    tags: r.tags ?? [],
    resourceType: r.resource_type ?? 'document',
  };

  // Always prefer LLM extraction — produces structured KIs with framework, attribution, etc.
  // Heuristic only runs as last resort (it produces low-quality sentence fragments)
  let items: any[] = [];

  if ((r.content?.length ?? 0) >= 100) {
    try {
      items = await extractKnowledgeLLMFallback(source);
    } catch { /* LLM failed */ }
  }

  // Heuristic fallback only for non-audio document types (audio/podcast heuristic produces garbage fragments)
  const isAudioType = ['transcript', 'podcast', 'audio', 'podcast_episode', 'video', 'recording'].includes(
    (r.resource_type ?? '').toLowerCase()
  );
  if (items.length === 0 && !isAudioType) {
    items = extractKnowledgeHeuristic(source);
  }

  if (items.length > 0) {
    await supabase.from('knowledge_items').insert(items as any);
    return { success: true, contentLength: items.length };
  }

  return { success: false, error: 'No knowledge could be extracted from content' };
}

// ── Method implementations ─────────────────────────────────

/**
 * Edge Fetch: calls the enrich-resource-content edge function
 * which uses Firecrawl for web scraping + platform-specific handlers
 */
async function runEdgeFetch(resourceId: string): Promise<MethodResult> {
  try {
    const result = await invokeEnrichResource(
      { resource_id: resourceId, force: true },
      { componentName: 'BatchExtraction:EdgeFetch', timeoutMs: 90000 },
    );

    if (result.error) {
      return {
        success: false,
        error: `Edge fetch: ${result.error.category} — ${result.error.message}`,
      };
    }

    const contentLen = await getResourceContentLength(resourceId);
    return {
      success: contentLen >= MIN_QUALITY_CHARS,
      contentLength: contentLen,
      error: contentLen < MIN_QUALITY_CHARS ? 'Edge fetch returned but content below quality threshold' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Edge fetch failed' };
  }
}

/**
 * Direct Fetch: fetches the URL directly from the browser context
 * (no edge function / no Firecrawl). Useful as a fallback when
 * the edge function is unreachable or slow.
 */
async function runDirectFetch(resourceId: string): Promise<MethodResult> {
  try {
    const { data: resource } = await supabase
      .from('resources')
      .select('file_url')
      .eq('id', resourceId)
      .single();

    const url = (resource as any)?.file_url;
    if (!url) return { success: false, error: 'No URL available for direct fetch' };

    // Skip non-HTTP URLs
    if (!url.startsWith('http')) {
      return { success: false, error: 'URL is not fetchable (non-HTTP)' };
    }

    // Skip known auth-gated / JS-heavy domains where direct fetch won't work
    const skipDomains = [
      /youtube\.com/i, /youtu\.be/i, /zoom\.(us|com)/i,
      /thinkific\.com/i, /teachable\.com/i, /kajabi\.com/i,
      /linkedin\.com/i, /facebook\.com/i, /instagram\.com/i,
    ];
    if (skipDomains.some(p => p.test(url))) {
      return { success: false, error: 'Domain requires JS rendering or auth — direct fetch unsuitable' };
    }

    // Actually fetch the page directly
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; FocusFlowBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/pdf',
      },
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return { success: false, error: `Direct fetch HTTP ${response.status}` };
    }

    const contentType = response.headers.get('content-type') ?? '';
    // Skip binary content
    if (contentType.includes('audio/') || contentType.includes('video/') || contentType.includes('image/')) {
      return { success: false, error: `Direct fetch: binary content type (${contentType})` };
    }

    const text = await response.text();

    // Parse HTML to extract text content
    let extractedText = text;
    if (contentType.includes('html')) {
      // Strip HTML tags, scripts, styles
      extractedText = text
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[\s\S]*?<\/header>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Cap at 60k chars
    const capped = extractedText.slice(0, 60000);

    if (capped.length < MIN_QUALITY_CHARS) {
      return { success: false, error: `Direct fetch: extracted text too short (${capped.length} chars)` };
    }

    // Store the content
    await supabase
      .from('resources')
      .update({
        content: capped,
        content_length: capped.length,
        enrichment_status: 'enriched',
        extraction_method: 'direct_browser_fetch',
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);

    return { success: true, contentLength: capped.length };
  } catch (err: any) {
    const msg = err?.message || 'Direct fetch failed';
    return {
      success: false,
      error: msg.includes('abort') ? 'Direct fetch: timeout (30s)' : msg,
    };
  }
}

/**
 * Source-specific: runs platform-aware extraction via the edge function
 * with extended timeouts for platforms that need it.
 */
async function runSourceSpecific(resourceId: string, sourceType: CanonicalSourceType): Promise<MethodResult> {
  try {
    const timeouts: Record<string, number> = {
      youtube: 90000,
      zoom: 120000,
      thinkific: 90000,
      audio: 120000,
      video: 120000,
    };

    const result = await invokeEnrichResource(
      { resource_id: resourceId, force: true },
      {
        componentName: `BatchExtraction:SourceSpecific:${sourceType}`,
        timeoutMs: timeouts[sourceType] ?? 90000,
      },
    );

    if (result.error) {
      return { success: false, error: `Source-specific (${sourceType}): ${result.error.message}` };
    }

    const contentLen = await getResourceContentLength(resourceId);
    return {
      success: contentLen >= MIN_QUALITY_CHARS,
      contentLength: contentLen,
      error: contentLen < MIN_QUALITY_CHARS ? `Source-specific: content below threshold (${contentLen})` : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Source-specific extraction failed' };
  }
}

/**
 * Transcript fallback: checks audio_jobs for existing transcripts,
 * stores them as content, or marks the resource as awaiting_transcription.
 */
async function runTranscriptFallback(resourceId: string): Promise<MethodResult> {
  try {
    const { data: audioJob } = await supabase
      .from('audio_jobs')
      .select('transcript_text, transcript_word_count, has_transcript')
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (audioJob?.has_transcript && audioJob?.transcript_text) {
      const transcript = audioJob.transcript_text;
      await supabase
        .from('resources')
        .update({
          content: transcript,
          content_length: transcript.length,
          enrichment_status: 'deep_enriched',
          extraction_method: 'transcript_fallback',
          last_status_change_at: new Date().toISOString(),
        } as any)
        .eq('id', resourceId);

      return { success: true, contentLength: transcript.length };
    }

    // Mark as awaiting transcription
    await supabase
      .from('resources')
      .update({
        enrichment_status: 'awaiting_transcription',
        next_best_action: 'Upload a transcript (.txt/.vtt/.srt) or wait for transcription to complete',
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);

    return { success: false, error: 'No transcript available — marked for transcription' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Transcript fallback failed' };
  }
}

/**
 * Metadata-only: lightweight extraction from title/description/tags.
 * Last resort — creates minimal content from available metadata.
 */
async function runMetadataOnly(resourceId: string): Promise<MethodResult> {
  try {
    const { data: resource } = await supabase
      .from('resources')
      .select('title, description, tags, resource_type')
      .eq('id', resourceId)
      .single();

    if (!resource) return { success: false, error: 'Resource not found' };

    const r = resource as any;
    const parts = [
      r.title && `Title: ${r.title}`,
      r.description && `Description: ${r.description}`,
      r.tags?.length > 0 && `Tags: ${r.tags.join(', ')}`,
      r.resource_type && `Type: ${r.resource_type}`,
    ].filter(Boolean);

    const metadataContent = parts.join('\n\n');

    if (metadataContent.length < 20) {
      return { success: false, error: 'Insufficient metadata for extraction' };
    }

    await supabase
      .from('resources')
      .update({
        content: metadataContent,
        content_length: metadataContent.length,
        enrichment_status: 'enriched',
        extraction_method: 'metadata_only',
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);

    return { success: true, contentLength: metadataContent.length };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Metadata extraction failed' };
  }
}

// ── Helpers ────────────────────────────────────────────────

async function getResourceContentLength(resourceId: string): Promise<number> {
  const { data } = await supabase
    .from('resources')
    .select('content, content_length')
    .eq('id', resourceId)
    .single();

  if (!data) return 0;
  const r = data as any;
  return Math.max(r.content?.length ?? 0, r.content_length ?? 0);
}

async function getResourceContent(resourceId: string): Promise<string | null> {
  const { data } = await supabase
    .from('resources')
    .select('content')
    .eq('id', resourceId)
    .single();

  return (data as any)?.content ?? null;
}
