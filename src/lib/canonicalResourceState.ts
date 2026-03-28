/**
 * Canonical Resource State — THE single source of truth.
 *
 * Every resource resolves to exactly ONE of 11 states.
 * No generic "failed". No contradictory states. No dead-end buckets.
 */

import type { Resource } from '@/hooks/useResources';
import { detectResourceSubtype, classifyEnrichability, type ResourceSubtype } from '@/lib/salesBrain/resourceSubtype';
import { isAudioResource, detectAudioSubtype, getAudioStrategy } from '@/lib/salesBrain/audioPipeline';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { validateResourceQuality, type QualityResult, QUALITY_THRESHOLDS } from '@/lib/resourceQuality';

// ── The 11 canonical states ────────────────────────────────

export type CanonicalState =
  | 'ready_to_enrich'
  | 'enriching'
  | 'retryable_failure'
  | 'needs_transcript'
  | 'needs_pasted_content'
  | 'needs_access_auth'
  | 'needs_alternate_source'
  | 'metadata_only_candidate'
  | 'quarantined'
  | 'truly_complete'
  | 'system_gap';

export interface CanonicalStateResult {
  state: CanonicalState;
  label: string;
  description: string;
  nextAction: string | null;
  subtype: ResourceSubtype;
  subtypeLabel: string;
  qualityScore: number;
  sourceRouter: string; // which pipeline this resource should use
}

// ── State labels ──────────────────────────────────────────

export const CANONICAL_STATE_LABELS: Record<CanonicalState, string> = {
  ready_to_enrich: 'Ready',
  enriching: 'Processing',
  retryable_failure: 'Retryable',
  needs_transcript: 'Needs Transcript',
  needs_pasted_content: 'Needs Content',
  needs_access_auth: 'Needs Auth',
  needs_alternate_source: 'Needs Alt Source',
  metadata_only_candidate: 'Metadata Only',
  quarantined: 'Quarantined',
  truly_complete: 'Complete',
  system_gap: 'System Gap',
};

export const CANONICAL_STATE_COLORS: Record<CanonicalState, string> = {
  ready_to_enrich: 'bg-primary/20 text-primary',
  enriching: 'bg-status-yellow/20 text-status-yellow',
  retryable_failure: 'bg-orange-500/20 text-orange-500',
  needs_transcript: 'bg-accent/20 text-accent-foreground',
  needs_pasted_content: 'bg-accent/20 text-accent-foreground',
  needs_access_auth: 'bg-status-red/20 text-status-red',
  needs_alternate_source: 'bg-orange-500/20 text-orange-500',
  metadata_only_candidate: 'bg-muted text-muted-foreground',
  quarantined: 'bg-destructive/20 text-destructive',
  truly_complete: 'bg-status-green/20 text-status-green',
  system_gap: 'bg-destructive/20 text-destructive',
};

// ── Source pipeline routing ───────────────────────────────

function getSourceRouter(subtype: ResourceSubtype): string {
  switch (subtype) {
    case 'youtube_video': return 'youtube_captions';
    case 'spotify_episode': return 'metadata_transcript_needed';
    case 'apple_podcast_episode': return 'rss_audio_resolution';
    case 'podcast_episode': return 'audio_transcription';
    case 'audio_file': return 'direct_transcription';
    case 'google_doc': return 'document_extraction';
    case 'google_sheet': return 'document_extraction';
    case 'google_drive_file': return 'needs_auth_download';
    case 'auth_gated_community_page': return 'manual_input';
    case 'zoom_recording': return 'transcript_needed';
    case 'web_article': return 'text_extraction';
    case 'pdf': return 'text_extraction';
    case 'competitor_page': return 'text_extraction';
    case 'manual_note': return 'no_extraction_needed';
    default: return 'text_extraction';
  }
}

const SUBTYPE_LABELS: Record<ResourceSubtype, string> = {
  youtube_video: 'YouTube Video',
  google_doc: 'Google Doc',
  google_sheet: 'Google Sheet',
  google_drive_file: 'Google Drive File',
  zoom_recording: 'Zoom Recording',
  spotify_episode: 'Spotify Episode',
  apple_podcast_episode: 'Apple Podcast',
  podcast_episode: 'Podcast Episode',
  audio_file: 'Audio File',
  web_article: 'Web Article',
  pdf: 'PDF',
  manual_note: 'Manual Note',
  competitor_page: 'Competitor Page',
  auth_gated_community_page: 'Auth-Gated Page',
  unknown_url: 'Unknown URL',
  no_url: 'No URL',
};

// ── Binary content detection ──────────────────────────────

function isBinaryContent(content: string | null): boolean {
  if (!content || content.length < 100) return false;
  return /[\x00-\x08\x0E-\x1F]/.test(content.slice(0, 200));
}

// ── Main resolver ─────────────────────────────────────────

export function resolveCanonicalState(
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): CanonicalStateResult {
  const url = resource.file_url ?? null;
  const status = (resource.enrichment_status ?? 'not_enriched') as string;
  const subtype = detectResourceSubtype(url, resource.resource_type);
  const enrichResult = classifyEnrichability(url, resource.resource_type);
  const content = resource.content || '';
  const failureCount = resource.failure_count ?? 0;
  const sourceRouter = getSourceRouter(subtype);

  const base = {
    subtype,
    subtypeLabel: SUBTYPE_LABELS[subtype] || subtype,
    sourceRouter,
  };

  // ── Quality score (lightweight — no full validation for state resolution) ──
  const quality = validateResourceQuality({
    id: resource.id,
    title: resource.title,
    content: content || null,
    content_length: resource.content_length ?? content.length,
    enrichment_status: status,
    enrichment_version: resource.enrichment_version ?? 0,
    validation_version: resource.validation_version ?? 0,
    enriched_at: resource.enriched_at ?? null,
    failure_reason: resource.failure_reason ?? null,
    file_url: url,
    description: resource.description ?? null,
  });

  // ── 1. Currently processing ──
  if (['deep_enrich_in_progress', 'reenrich_in_progress', 'queued_for_deep_enrich', 'queued_for_reenrich'].includes(status)) {
    return { ...base, state: 'enriching', label: 'Processing', description: 'Enrichment running', nextAction: null, qualityScore: quality.score };
  }

  // Audio job active processing
  if (audioJob && ['queued', 'resolving', 'downloading', 'transcribing', 'assembling',
    'detecting_source_type', 'resolving_platform_metadata', 'resolving_canonical_episode_page',
    'resolving_rss_feed', 'resolving_audio_enclosure', 'searching_transcript_source',
    'downloading_audio', 'assembling_transcript', 'quality_check', 'enriching'
  ].includes(audioJob.stage)) {
    return { ...base, state: 'enriching', label: 'Processing', description: `Audio pipeline: ${audioJob.stage}`, nextAction: null, qualityScore: quality.score };
  }

  // ── 2. Quarantined ──
  if (status === 'quarantined') {
    return { ...base, state: 'quarantined', label: 'Quarantined', description: 'Removed from auto-retry after repeated failures', nextAction: 'Manual review only', qualityScore: quality.score };
  }

  // ── 3. Truly complete ──
  if (status === 'deep_enriched' && quality.score >= 70 && !isBinaryContent(content)) {
    // Check for contradictions
    if (!resource.failure_reason) {
      return { ...base, state: 'truly_complete', label: 'Complete', description: `Score ${quality.score}/100`, nextAction: null, qualityScore: quality.score };
    }
  }
  if (status === 'duplicate' || status === 'superseded') {
    return { ...base, state: 'truly_complete', label: status === 'duplicate' ? 'Duplicate' : 'Superseded', description: `Resource is ${status}`, nextAction: null, qualityScore: quality.score };
  }

  // ── 4. System gap detection (repeated same failures) ──
  if (failureCount >= 3) {
    return { ...base, state: 'system_gap', label: 'System Gap', description: `Failed ${failureCount} times — requires build`, nextAction: 'See Product Roadmap', qualityScore: quality.score };
  }

  // ── 5. Binary content detected ──
  if (isBinaryContent(content)) {
    if (['audio_file', 'podcast_episode', 'spotify_episode', 'apple_podcast_episode'].includes(subtype)) {
      return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: 'Binary/audio content stored as text — needs transcription', nextAction: 'Paste transcript or provide audio URL', qualityScore: quality.score };
    }
    return { ...base, state: 'needs_pasted_content', label: 'Needs Content', description: 'Binary content detected — paste readable content', nextAction: 'Paste content via Manual Assist', qualityScore: quality.score };
  }

  // ── 6. Source-type routing ──

  // Audio resource routing
  if (isAudioResource(url, resource.resource_type) || ['spotify_episode', 'apple_podcast_episode', 'podcast_episode', 'audio_file'].includes(subtype)) {
    // Audio job completed with transcript
    if (audioJob?.has_transcript && audioJob.stage === 'completed') {
      if (status === 'deep_enriched' && quality.score >= 70) {
        return { ...base, state: 'truly_complete', label: 'Complete', description: `Transcribed (${audioJob.transcript_word_count ?? 0} words)`, nextAction: null, qualityScore: quality.score };
      }
    }
    // Audio job metadata only
    if (audioJob?.stage === 'metadata_only_complete' || audioJob?.transcript_mode === 'metadata_only') {
      return { ...base, state: 'metadata_only_candidate', label: 'Metadata Only', description: 'Only metadata captured — no transcript available', nextAction: 'Paste transcript or provide alternate URL', qualityScore: quality.score };
    }
    // Audio job failed
    if (audioJob?.stage === 'failed' || audioJob?.stage === 'needs_manual_assist') {
      if (audioJob?.retryable && failureCount < 2) {
        return { ...base, state: 'retryable_failure', label: 'Retry Available', description: audioJob.failure_reason || 'Audio processing failed', nextAction: 'Retry transcription', qualityScore: quality.score };
      }
      return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: audioJob?.failure_reason || 'Audio processing exhausted', nextAction: 'Paste transcript or provide alternate source', qualityScore: quality.score };
    }

    // No audio job yet — check if enrichable
    if (!audioJob && content.length < 500) {
      if (subtype === 'spotify_episode') {
        return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: 'Spotify does not provide direct audio — paste transcript', nextAction: 'Paste transcript', qualityScore: quality.score };
      }
      if (status === 'not_enriched' || !status) {
        return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'Audio detected — ready for transcription pipeline', nextAction: 'Run enrichment', qualityScore: quality.score };
      }
      return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: 'Audio content with insufficient text', nextAction: 'Paste transcript or provide direct audio URL', qualityScore: quality.score };
    }
  }

  // YouTube routing
  if (subtype === 'youtube_video') {
    if (status === 'not_enriched' || !status) {
      return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'YouTube — will use caption extraction pipeline', nextAction: 'Run enrichment', qualityScore: quality.score };
    }
    if (status === 'failed' && content.length < 500) {
      return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: 'YouTube caption extraction failed', nextAction: 'Paste transcript or provide alternate source', qualityScore: quality.score };
    }
  }

  // Auth-gated routing
  if (enrichResult.enrichability === 'needs_auth' || subtype === 'auth_gated_community_page') {
    return { ...base, state: 'needs_access_auth', label: 'Needs Auth', description: enrichResult.reason || 'Login required', nextAction: 'Paste content via Manual Assist', qualityScore: quality.score };
  }

  // Google Drive — only route to auth if actually failed after direct-download attempt
  if (subtype === 'google_drive_file') {
    if (status === 'needs_auth') {
      return { ...base, state: 'needs_access_auth', label: 'Needs Auth', description: 'Google Drive permissions block download — share file or paste content', nextAction: 'Update sharing to "Anyone with the link" or paste content', qualityScore: quality.score };
    }
    if (status === 'not_enriched' || !status) {
      return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'Google Drive file — direct download will be attempted', nextAction: 'Run enrichment', qualityScore: quality.score };
    }
  }

  // Zoom recording
  if (subtype === 'zoom_recording') {
    return { ...base, state: 'needs_transcript', label: 'Needs Transcript', description: 'Zoom recording — download transcript from Zoom', nextAction: 'Paste transcript via Manual Assist', qualityScore: quality.score };
  }

  // ── 7. Status-based routing for remaining ──

  // Deep enriched but low score or with contradictions
  if (status === 'deep_enriched' && quality.score < 70) {
    return { ...base, state: 'retryable_failure', label: 'Score Bug', description: `Marked complete but score is only ${quality.score}`, nextAction: 'Re-run scoring', qualityScore: quality.score };
  }
  if (status === 'deep_enriched' && resource.failure_reason) {
    return { ...base, state: 'retryable_failure', label: 'State Bug', description: 'Marked complete but has failure_reason', nextAction: 'Clear failure and re-verify', qualityScore: quality.score };
  }

  // Failed
  if (status === 'failed' || status === 'incomplete') {
    if (failureCount >= 2) {
      return { ...base, state: 'needs_alternate_source', label: 'Needs Alt Source', description: `Failed ${failureCount} times with same URL`, nextAction: 'Provide different URL', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'fully_enrichable' || enrichResult.enrichability === 'partially_enrichable') {
      return { ...base, state: 'retryable_failure', label: 'Retryable', description: resource.failure_reason || 'Extraction failed', nextAction: 'Retry enrichment', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'metadata_only') {
      return { ...base, state: 'metadata_only_candidate', label: 'Metadata Only', description: enrichResult.reason, nextAction: 'Accept or paste content', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'manual_input_needed') {
      return { ...base, state: 'needs_pasted_content', label: 'Needs Content', description: enrichResult.reason, nextAction: 'Paste content via Manual Assist', qualityScore: quality.score };
    }
    return { ...base, state: 'retryable_failure', label: 'Retryable', description: resource.failure_reason || 'Enrichment failed', nextAction: 'Retry enrichment', qualityScore: quality.score };
  }

  // Not enriched
  if (status === 'not_enriched' || !status) {
    if (enrichResult.enrichability === 'fully_enrichable' || enrichResult.enrichability === 'partially_enrichable') {
      return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'Ready for enrichment', nextAction: 'Run Deep Enrich', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'metadata_only') {
      return { ...base, state: 'metadata_only_candidate', label: 'Metadata Only', description: enrichResult.reason, nextAction: 'Accept or paste content', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'manual_input_needed') {
      return { ...base, state: 'needs_pasted_content', label: 'Needs Content', description: enrichResult.reason, nextAction: 'Paste content', qualityScore: quality.score };
    }
    if (enrichResult.enrichability === 'no_source' || enrichResult.enrichability === 'unsupported') {
      return { ...base, state: 'system_gap', label: 'Unsupported', description: enrichResult.reason, nextAction: 'Provide URL or convert format', qualityScore: quality.score };
    }
    return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'Ready for processing', nextAction: 'Run Deep Enrich', qualityScore: quality.score };
  }

  // Stale
  if (status === 'stale') {
    return { ...base, state: 'retryable_failure', label: 'Stale', description: 'Content is outdated', nextAction: 'Re-enrich', qualityScore: quality.score };
  }

  // Fallback
  return { ...base, state: 'ready_to_enrich', label: 'Ready', description: 'Ready for processing', nextAction: 'Run Deep Enrich', qualityScore: quality.score };
}

// ── Aggregate stats from canonical states ──────────────────

export interface EnrichmentHealthStats {
  total: number;
  trulyComplete: number;
  readyToEnrich: number;
  enriching: number;
  retryableFailure: number;
  needsTranscript: number;
  needsPastedContent: number;
  needsAccessAuth: number;
  needsAlternateSource: number;
  metadataOnlyCandidate: number;
  quarantined: number;
  systemGap: number;
  completionPct: number;
  machinFixable: number;
  needsInput: number;
}

export function computeEnrichmentHealth(
  resources: Resource[],
  audioJobsMap?: Map<string, AudioJobRecord>,
): EnrichmentHealthStats {
  const stats: EnrichmentHealthStats = {
    total: resources.length,
    trulyComplete: 0,
    readyToEnrich: 0,
    enriching: 0,
    retryableFailure: 0,
    needsTranscript: 0,
    needsPastedContent: 0,
    needsAccessAuth: 0,
    needsAlternateSource: 0,
    metadataOnlyCandidate: 0,
    quarantined: 0,
    systemGap: 0,
    completionPct: 0,
    machinFixable: 0,
    needsInput: 0,
  };

  for (const r of resources) {
    const job = audioJobsMap?.get(r.id) ?? null;
    const { state } = resolveCanonicalState(r, job);
    switch (state) {
      case 'truly_complete': stats.trulyComplete++; break;
      case 'ready_to_enrich': stats.readyToEnrich++; break;
      case 'enriching': stats.enriching++; break;
      case 'retryable_failure': stats.retryableFailure++; break;
      case 'needs_transcript': stats.needsTranscript++; break;
      case 'needs_pasted_content': stats.needsPastedContent++; break;
      case 'needs_access_auth': stats.needsAccessAuth++; break;
      case 'needs_alternate_source': stats.needsAlternateSource++; break;
      case 'metadata_only_candidate': stats.metadataOnlyCandidate++; break;
      case 'quarantined': stats.quarantined++; break;
      case 'system_gap': stats.systemGap++; break;
    }
  }

  stats.completionPct = stats.total > 0 ? Math.round((stats.trulyComplete / stats.total) * 100) : 0;
  stats.machinFixable = stats.readyToEnrich + stats.retryableFailure;
  stats.needsInput = stats.needsTranscript + stats.needsPastedContent + stats.needsAccessAuth + stats.needsAlternateSource;

  return stats;
}
