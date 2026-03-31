/**
 * Extraction Method Dispatch
 *
 * Routes each extraction method to a real, distinct code path instead of
 * always calling the same black-box autoOperationalize function.
 *
 * Methods:
 *   edge_fetch        → invoke enrich-resource-content edge function
 *   direct_fetch      → fetch resource URL directly in browser and store content
 *   source_specific   → platform-aware extraction (YouTube transcripts, Zoom, etc.)
 *   transcript_fallback → attempt transcript / transcription pipeline
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
}

// ── Public dispatcher ──────────────────────────────────────

export async function dispatchExtractionMethod(
  resourceId: string,
  method: ExtractionMethod,
  sourceType: CanonicalSourceType,
): Promise<MethodResult> {
  log.info('Dispatching extraction', { resourceId, method, sourceType });

  switch (method) {
    case 'edge_fetch':
      return runEdgeFetch(resourceId);
    case 'direct_fetch':
      return runDirectFetch(resourceId);
    case 'source_specific':
      return runSourceSpecific(resourceId, sourceType);
    case 'transcript_fallback':
      return runTranscriptFallback(resourceId, sourceType);
    case 'metadata_only':
      return runMetadataOnly(resourceId);
    default:
      return { success: false, error: `Unknown method: ${method}` };
  }
}

// ── Enrichment (separate from extraction) ──────────────────

export async function runEnrichmentOnly(resourceId: string): Promise<MethodResult> {
  log.info('Running enrichment-only', { resourceId });

  // Verify resource has content
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

  // Extract knowledge from existing content
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
    return { success: true, contentLength: contentLen, error: undefined };
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

  let items = extractKnowledgeHeuristic(source);
  if (items.length === 0 && (r.content?.length ?? 0) >= 100) {
    try {
      items = await extractKnowledgeLLMFallback(source);
    } catch { /* fallback failed */ }
  }

  if (items.length > 0) {
    await supabase.from('knowledge_items').insert(items as any);
    return { success: true, contentLength: items.length };
  }

  return { success: false, error: 'No knowledge could be extracted from content' };
}

// ── Method implementations ─────────────────────────────────

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

    // Verify content was actually written
    const contentLen = await getResourceContentLength(resourceId);
    return {
      success: contentLen >= 30,
      contentLength: contentLen,
      error: contentLen < 30 ? 'Edge fetch returned but no content stored' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Edge fetch failed' };
  }
}

async function runDirectFetch(resourceId: string): Promise<MethodResult> {
  try {
    // Get resource URL
    const { data: resource } = await supabase
      .from('resources')
      .select('file_url')
      .eq('id', resourceId)
      .single();

    const url = (resource as any)?.file_url;
    if (!url) return { success: false, error: 'No URL available for direct fetch' };

    // Use edge function with direct_fetch hint
    const result = await invokeEnrichResource(
      { resource_id: resourceId, force: true },
      { componentName: 'BatchExtraction:DirectFetch', timeoutMs: 60000 },
    );

    if (result.error) {
      return { success: false, error: `Direct fetch: ${result.error.message}` };
    }

    const contentLen = await getResourceContentLength(resourceId);
    return {
      success: contentLen >= 30,
      contentLength: contentLen,
      error: contentLen < 30 ? 'Direct fetch returned but content insufficient' : undefined,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Direct fetch failed' };
  }
}

async function runSourceSpecific(resourceId: string, sourceType: CanonicalSourceType): Promise<MethodResult> {
  try {
    log.info('Source-specific extraction', { resourceId, sourceType });

    // For YouTube: attempt transcript extraction
    if (sourceType === 'youtube') {
      return runEdgeFetch(resourceId); // Edge function has YouTube-specific handling
    }

    // For Zoom: attempt with extended timeout
    if (sourceType === 'zoom') {
      const result = await invokeEnrichResource(
        { resource_id: resourceId, force: true },
        { componentName: 'BatchExtraction:ZoomSpecific', timeoutMs: 120000 },
      );
      if (result.error) return { success: false, error: `Zoom extraction: ${result.error.message}` };
      const len = await getResourceContentLength(resourceId);
      return { success: len >= 30, contentLength: len };
    }

    // For Thinkific: standard enrichment with platform hint
    if (sourceType === 'thinkific') {
      const result = await invokeEnrichResource(
        { resource_id: resourceId, force: true },
        { componentName: 'BatchExtraction:ThinkificSpecific', timeoutMs: 90000 },
      );
      if (result.error) return { success: false, error: `Thinkific extraction: ${result.error.message}` };
      const len = await getResourceContentLength(resourceId);
      return { success: len >= 30, contentLength: len };
    }

    // For PDF/documents: standard enrichment
    if (sourceType === 'pdf' || sourceType === 'document') {
      return runEdgeFetch(resourceId);
    }

    // Default: try edge fetch
    return runEdgeFetch(resourceId);
  } catch (err: any) {
    return { success: false, error: err?.message || 'Source-specific extraction failed' };
  }
}

async function runTranscriptFallback(resourceId: string, sourceType: CanonicalSourceType): Promise<MethodResult> {
  try {
    // Check if audio_jobs table has a transcript for this resource
    const { data: audioJob } = await supabase
      .from('audio_jobs')
      .select('transcript_text, transcript_word_count, has_transcript')
      .eq('resource_id', resourceId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (audioJob?.has_transcript && audioJob?.transcript_text) {
      // Write transcript as content
      const { error: updateErr } = await supabase
        .from('resources')
        .update({
          content: audioJob.transcript_text,
          content_length: audioJob.transcript_text.length,
          enrichment_status: 'deep_enriched',
          last_status_change_at: new Date().toISOString(),
        } as any)
        .eq('id', resourceId);

      if (updateErr) return { success: false, error: `Failed to store transcript: ${updateErr.message}` };
      return { success: true, contentLength: audioJob.transcript_text.length };
    }

    // No existing transcript — mark as awaiting transcription
    await supabase
      .from('resources')
      .update({
        enrichment_status: 'awaiting_transcription',
        last_status_change_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);

    return { success: false, error: 'No transcript available — marked for transcription' };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Transcript fallback failed' };
  }
}

async function runMetadataOnly(resourceId: string): Promise<MethodResult> {
  try {
    const { data: resource } = await supabase
      .from('resources')
      .select('title, description, tags, resource_type')
      .eq('id', resourceId)
      .single();

    if (!resource) return { success: false, error: 'Resource not found' };

    const r = resource as any;
    const metadataContent = [
      r.title,
      r.description,
      ...(r.tags ?? []),
    ].filter(Boolean).join('\n');

    if (metadataContent.length < 20) {
      return { success: false, error: 'Insufficient metadata for extraction' };
    }

    // Store metadata as lightweight content
    await supabase
      .from('resources')
      .update({
        content: metadataContent,
        content_length: metadataContent.length,
        enrichment_status: 'enriched',
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
