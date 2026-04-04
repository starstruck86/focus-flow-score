/**
 * processingRoute.ts — Asset-aware deterministic routing engine.
 * Routes based on BEST AVAILABLE PROCESSING ASSET, not just source type.
 * Client-side computed, not persisted.
 */
import type { Resource } from '@/hooks/useResources';
import { isAudioResource } from '@/lib/salesBrain/audioPipeline';

// ── Types ──────────────────────────────────────────────────
export type OriginType = 'audio' | 'video' | 'pdf' | 'url' | 'doc' | 'manual_text';

export type AssetKind =
  | 'lesson_text'
  | 'transcript_text'
  | 'parsed_content'
  | 'manual_text'
  | 'audio_file'
  | 'video_file'
  | 'uploaded_file'
  | 'url';

export type ContentType = 'structured' | 'dense' | 'transcript' | 'light' | 'standard';
export type Pipeline = 'transcript_pipeline' | 'enrich_then_extract' | 'direct_extract' | 'manual_assist';
export type EnrichmentMethod = 'crawler' | 'file_parser' | 'transcription' | 'none';
export type ExtractionMethod = 'standard' | 'dense_teaching' | 'lesson' | 'summary_first';
export type RouteConfidence = 'high' | 'medium' | 'low';

export interface ProcessingRoute {
  origin_type: OriginType;
  available_assets: AssetKind[];
  primary_asset: AssetKind;
  secondary_assets: AssetKind[];
  content_type: ContentType;
  pipeline: Pipeline;
  enrichment_method: EnrichmentMethod;
  extraction_method: ExtractionMethod;
  confidence: RouteConfidence;
  reason: string[];
}

// ── Labels ─────────────────────────────────────────────────
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

export const ORIGIN_TYPE_LABELS: Record<OriginType, string> = {
  audio: 'Audio',
  video: 'Video',
  pdf: 'PDF',
  url: 'Web URL',
  doc: 'Document',
  manual_text: 'Manual Text',
};

export const ASSET_LABELS: Record<AssetKind, string> = {
  lesson_text: 'Lesson Text',
  transcript_text: 'Transcript',
  parsed_content: 'Parsed Content',
  manual_text: 'Manual Text',
  audio_file: 'Audio File',
  video_file: 'Video File',
  uploaded_file: 'Uploaded File',
  url: 'URL',
};

// Keep backward compat
export type SourceType = OriginType;
export const SOURCE_TYPE_LABELS = ORIGIN_TYPE_LABELS;

// ── Asset detection ────────────────────────────────────────
function detectAssets(resource: Resource): { assets: AssetKind[]; reason: string[] } {
  const r = resource as any;
  const url = resource.file_url || '';
  const title = resource.title || '';
  const resourceType = resource.resource_type || '';
  const contentLength = r.content_length || resource.content_length || 0;
  const enrichmentStatus = resource.enrichment_status || '';
  const hasContent = contentLength > 200;
  const isLesson = title.includes(' > ');

  const assets: AssetKind[] = [];
  const reason: string[] = [];

  // Lesson text — structured course content
  if (isLesson && hasContent) {
    assets.push('lesson_text');
    reason.push('Lesson structure + content present');
  }

  // Transcript text — from audio jobs or enrichment
  const hasTranscript = r.has_transcript || r.transcript_text ||
    (enrichmentStatus === 'deep_enriched' &&
      (isAudioResource(url, resourceType) || resourceType === 'audio' || resourceType === 'podcast_episode' ||
       resourceType === 'video' || /youtube|youtu\.be|vimeo/i.test(url)));
  if (hasTranscript && hasContent) {
    assets.push('transcript_text');
    reason.push('Transcript text available');
  }

  // Parsed content — enriched web/pdf/doc content
  const isParsed = (enrichmentStatus === 'deep_enriched' || enrichmentStatus === 'content_ready' || enrichmentStatus === 'enriched') &&
    hasContent && !isLesson && !hasTranscript;
  if (isParsed) {
    assets.push('parsed_content');
    reason.push('Parsed/enriched content available');
  }

  // Manual text — manually added content after failure or direct input
  const isManual = r.manual_content_present || r.resolution_method === 'resolved_manual';
  if (isManual && hasContent) {
    assets.push('manual_text');
    reason.push('Manual text content present');
  }

  // If content exists but none of the above matched, it's still usable parsed content
  if (hasContent && assets.length === 0 && !isAudioResource(url, resourceType) &&
      resourceType !== 'audio' && resourceType !== 'podcast_episode') {
    assets.push('parsed_content');
    reason.push(`Usable content detected (${Math.round(contentLength / 1000)}k chars)`);
  }

  // Audio file
  if (isAudioResource(url, resourceType) || resourceType === 'audio' || resourceType === 'podcast_episode') {
    assets.push('audio_file');
    reason.push('Audio file source');
  }

  // Video file
  if (url.includes('.mp4') || resourceType === 'video' || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) {
    assets.push('video_file');
    reason.push('Video file source');
  }

  // PDF / doc as uploaded file
  if (url.includes('.pdf') || resourceType === 'pdf' || resourceType === 'doc' || resourceType === 'document') {
    assets.push('uploaded_file');
    reason.push('Uploaded file source');
  }

  // URL
  if (url.startsWith('http') && !assets.includes('audio_file') && !assets.includes('video_file') && !assets.includes('uploaded_file')) {
    assets.push('url');
    reason.push('Web URL source');
  }

  // Fallback: if absolutely nothing, mark url if present
  if (assets.length === 0 && url) {
    assets.push('url');
    reason.push('Only URL available');
  }

  return { assets, reason };
}

// ── Asset priority for primary selection ───────────────────
const ASSET_PRIORITY: AssetKind[] = [
  'lesson_text',
  'transcript_text',
  'parsed_content',
  'manual_text',
  'audio_file',
  'video_file',
  'uploaded_file',
  'url',
];

function selectPrimaryAsset(assets: AssetKind[]): AssetKind {
  for (const a of ASSET_PRIORITY) {
    if (assets.includes(a)) return a;
  }
  return 'url';
}

// ── Origin type detection ──────────────────────────────────
function detectOriginType(resource: Resource): OriginType {
  const url = resource.file_url || '';
  const resourceType = resource.resource_type || '';

  if (isAudioResource(url, resourceType) || resourceType === 'audio' || resourceType === 'podcast_episode') return 'audio';
  if (url.includes('.mp4') || resourceType === 'video' || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) return 'video';
  if (url.includes('.pdf') || resourceType === 'pdf') return 'pdf';
  if (resourceType === 'doc' || resourceType === 'document') return 'doc';
  if (url.startsWith('http')) return 'url';
  return 'manual_text';
}

// ── Main derivation ────────────────────────────────────────
export function deriveProcessingRoute(resource: Resource): ProcessingRoute {
  const r = resource as any;
  const contentLength = r.content_length || resource.content_length || 0;
  const failureCount = resource.failure_count || 0;
  const extractionAttempts = r.advanced_extraction_attempts || 0;
  const totalFailures = failureCount + extractionAttempts;
  const enrichmentStatus = resource.enrichment_status || '';
  const title = resource.title || '';
  const isLesson = title.includes(' > ');

  const reason: string[] = [];

  // 1. Origin type
  const origin_type = detectOriginType(resource);
  reason.push(`Origin: ${ORIGIN_TYPE_LABELS[origin_type]}`);

  // 2. Available assets
  const { assets: available_assets, reason: assetReasons } = detectAssets(resource);
  reason.push(...assetReasons);

  // 3. Primary & secondary assets
  const primary_asset = selectPrimaryAsset(available_assets);
  const secondary_assets = available_assets.filter(a => a !== primary_asset);
  reason.push(`Primary asset: ${ASSET_LABELS[primary_asset]}`);

  // 4. Content type
  let content_type: ContentType;
  if (isLesson) {
    content_type = 'structured';
    reason.push('Lesson structure detected');
  } else if (primary_asset === 'transcript_text') {
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

  // 5. Pipeline — BEST AVAILABLE CONTENT WINS
  let pipeline: Pipeline;
  if (totalFailures >= 3 && enrichmentStatus !== 'deep_enriched' && !hasTextAsset(primary_asset)) {
    pipeline = 'manual_assist';
    reason.push(`Multiple failures (${totalFailures}) + no usable text → manual assist`);
  } else if (hasTextAsset(primary_asset)) {
    // Text-based asset available — go direct
    pipeline = 'direct_extract';
    reason.push(`Usable text asset (${ASSET_LABELS[primary_asset]}) → direct extraction`);
  } else if (primary_asset === 'audio_file' || primary_asset === 'video_file') {
    pipeline = 'transcript_pipeline';
    reason.push('No text available, media source → transcript pipeline');
  } else if (primary_asset === 'uploaded_file') {
    pipeline = 'enrich_then_extract';
    reason.push('File needs parsing → enrich then extract');
  } else if (primary_asset === 'url') {
    pipeline = 'enrich_then_extract';
    reason.push('URL needs crawling → enrich then extract');
  } else {
    pipeline = 'manual_assist';
    reason.push('No actionable asset → manual assist');
  }

  // 6. Enrichment method
  let enrichment_method: EnrichmentMethod;
  if (pipeline === 'direct_extract') {
    enrichment_method = 'none';
  } else if (pipeline === 'transcript_pipeline') {
    enrichment_method = 'transcription';
  } else if (primary_asset === 'uploaded_file') {
    enrichment_method = 'file_parser';
  } else {
    enrichment_method = 'crawler';
  }

  // 7. Extraction method
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

  // 8. Confidence
  let confidence: RouteConfidence;
  if (hasTextAsset(primary_asset) && contentLength > 2000) {
    confidence = 'high';
  } else if (hasTextAsset(primary_asset) || (primary_asset === 'audio_file' || primary_asset === 'video_file')) {
    confidence = 'medium';
  } else if (primary_asset === 'url' && enrichmentStatus === 'deep_enriched') {
    confidence = 'medium';
  } else {
    confidence = 'low';
    reason.push('Ambiguous routing — low confidence');
  }

  return {
    origin_type,
    available_assets,
    primary_asset,
    secondary_assets,
    content_type,
    pipeline,
    enrichment_method,
    extraction_method,
    confidence,
    reason,
  };
}

function hasTextAsset(asset: AssetKind): boolean {
  return asset === 'lesson_text' || asset === 'transcript_text' || asset === 'parsed_content' || asset === 'manual_text';
}

// ── Compact label for cards ────────────────────────────────
export function getRouteLabel(route: ProcessingRoute): string {
  const parts: string[] = [ASSET_LABELS[route.primary_asset]];
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

// ── Aggregate by primary asset ─────────────────────────────
export function aggregateByPrimaryAsset(resources: Resource[]): Record<AssetKind, number> {
  const counts = {} as Record<AssetKind, number>;
  for (const r of resources) {
    const route = deriveProcessingRoute(r);
    counts[route.primary_asset] = (counts[route.primary_asset] || 0) + 1;
  }
  return counts;
}
