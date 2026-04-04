/**
 * processingRoute.ts — Deterministic routing engine for resource processing.
 * Given a resource, derives the exact pipeline path, methods, and fallbacks.
 * Client-side computed, not persisted.
 */
import type { Resource } from '@/hooks/useResources';
import { isAudioResource } from '@/lib/salesBrain/audioPipeline';

// ── Types ──────────────────────────────────────────────────
export type SourceType = 'audio' | 'video' | 'pdf' | 'url' | 'doc' | 'text';
export type ContentType = 'structured' | 'dense' | 'transcript' | 'light' | 'standard';
export type Pipeline = 'transcript_pipeline' | 'enrich_then_extract' | 'direct_extract' | 'manual_assist';
export type EnrichmentMethod = 'crawler' | 'file_parser' | 'transcription' | 'none';
export type ExtractionMethod = 'standard' | 'dense_teaching' | 'lesson' | 'summary_first';
export type RouteConfidence = 'high' | 'medium' | 'low';

export interface ProcessingRoute {
  source_type: SourceType;
  content_type: ContentType;
  pipeline: Pipeline;
  enrichment_method: EnrichmentMethod;
  extraction_method: ExtractionMethod;
  confidence: RouteConfidence;
  reason: string[];
}

// ── Route labels for display ───────────────────────────────
export const PIPELINE_LABELS: Record<Pipeline, string> = {
  transcript_pipeline: 'Transcript Pipeline',
  enrich_then_extract: 'Enrich → Extract',
  direct_extract: 'Direct Extract',
  manual_assist: 'Manual Assist',
};

export const EXTRACTION_METHOD_LABELS: Record<ExtractionMethod, string> = {
  standard: 'Standard',
  dense_teaching: 'Dense Teaching',
  lesson: 'Lesson',
  summary_first: 'Summary-First',
};

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  url: 'Web URL',
  doc: 'Document',
  text: 'Text / Manual',
};

// ── Derivation ─────────────────────────────────────────────
export function deriveProcessingRoute(resource: Resource): ProcessingRoute {
  const r = resource as any;
  const url = resource.file_url || '';
  const title = resource.title || '';
  const contentLength = r.content_length || 0;
  const resourceType = resource.resource_type || '';
  const failureCount = resource.failure_count || 0;
  const extractionAttempts = r.advanced_extraction_attempts || 0;
  const enrichmentStatus = resource.enrichment_status || '';

  const reason: string[] = [];

  // ── 1. Source type detection ─────────────────────────────
  let source_type: SourceType;
  if (isAudioResource(url, resourceType) || resourceType === 'audio' || resourceType === 'podcast_episode') {
    source_type = 'audio';
    reason.push('Audio resource detected');
  } else if (url.includes('.mp4') || resourceType === 'video' || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) {
    source_type = 'video';
    reason.push('Video resource detected');
  } else if (url.includes('.pdf') || resourceType === 'pdf') {
    source_type = 'pdf';
    reason.push('PDF file detected');
  } else if (url.startsWith('http')) {
    source_type = 'url';
    reason.push('Web URL source');
  } else if (resourceType === 'doc' || resourceType === 'document') {
    source_type = 'doc';
    reason.push('Document file');
  } else {
    source_type = 'text';
    reason.push('Text / manual content');
  }

  // ── 2. Content type detection ────────────────────────────
  let content_type: ContentType;
  const isLesson = title.includes(' > ');

  if (isLesson) {
    content_type = 'structured';
    reason.push('Lesson structure detected (title contains " > ")');
  } else if (source_type === 'audio' || source_type === 'video') {
    content_type = 'transcript';
    reason.push('Transcript-backed content');
  } else if (contentLength > 8000) {
    content_type = 'dense';
    reason.push(`Dense content (${Math.round(contentLength / 1000)}k chars)`);
  } else if (contentLength > 0 && contentLength < 2000) {
    content_type = 'light';
    reason.push(`Light content (${contentLength} chars)`);
  } else {
    content_type = 'standard';
  }

  // ── 3. Pipeline selection ────────────────────────────────
  let pipeline: Pipeline;
  const totalFailures = failureCount + extractionAttempts;

  if (totalFailures >= 3 && enrichmentStatus !== 'deep_enriched') {
    pipeline = 'manual_assist';
    reason.push(`Multiple failures (${totalFailures}) — routed to manual assist`);
  } else if (source_type === 'audio' || source_type === 'video') {
    pipeline = 'transcript_pipeline';
    reason.push('Audio/video routed to transcript pipeline');
  } else if (source_type === 'text' || (r.manual_content_present && contentLength > 0)) {
    pipeline = 'direct_extract';
    reason.push('Content available — direct extraction');
  } else {
    pipeline = 'enrich_then_extract';
    reason.push('Requires enrichment before extraction');
  }

  // ── 4. Enrichment method ─────────────────────────────────
  let enrichment_method: EnrichmentMethod;
  if (pipeline === 'direct_extract') {
    enrichment_method = 'none';
  } else if (source_type === 'audio' || source_type === 'video') {
    enrichment_method = 'transcription';
  } else if (source_type === 'pdf' || source_type === 'doc') {
    enrichment_method = 'file_parser';
  } else {
    enrichment_method = 'crawler';
  }

  // ── 5. Extraction method ─────────────────────────────────
  let extraction_method: ExtractionMethod;
  if (isLesson) {
    extraction_method = 'lesson';
    reason.push('Lesson extraction pipeline');
  } else if (content_type === 'dense' || (content_type === 'transcript' && contentLength > 10000)) {
    extraction_method = 'dense_teaching';
    reason.push('Dense teaching extraction (high-yield content)');
  } else if (extractionAttempts >= 3) {
    extraction_method = 'summary_first';
    reason.push('Summary-first fallback (prior attempts exhausted)');
  } else {
    extraction_method = 'standard';
  }

  // ── 6. Confidence ────────────────────────────────────────
  let confidence: RouteConfidence;
  if (
    (source_type === 'video' || source_type === 'audio' || source_type === 'pdf') ||
    isLesson ||
    (source_type === 'url' && contentLength > 2000)
  ) {
    confidence = 'high';
  } else if (contentLength > 0 || enrichmentStatus === 'deep_enriched') {
    confidence = 'medium';
  } else {
    confidence = 'low';
    reason.push('Ambiguous routing — low confidence');
  }

  return {
    source_type,
    content_type,
    pipeline,
    enrichment_method,
    extraction_method,
    confidence,
    reason,
  };
}

// ── Compact label for cards ────────────────────────────────
export function getRouteLabel(route: ProcessingRoute): string {
  const parts: string[] = [];
  if (route.source_type === 'audio' || route.source_type === 'video') {
    parts.push(SOURCE_TYPE_LABELS[route.source_type]);
  }
  parts.push(PIPELINE_LABELS[route.pipeline]);
  if (route.extraction_method !== 'standard') {
    parts.push(EXTRACTION_METHOD_LABELS[route.extraction_method]);
  }
  return parts.join(' → ');
}

// ── Aggregate route stats for dashboard ────────────────────
export function aggregateRoutes(resources: Resource[]): Record<Pipeline, number> {
  const counts: Record<Pipeline, number> = {
    transcript_pipeline: 0,
    enrich_then_extract: 0,
    direct_extract: 0,
    manual_assist: 0,
  };
  for (const r of resources) {
    const route = deriveProcessingRoute(r);
    counts[route.pipeline]++;
  }
  return counts;
}
