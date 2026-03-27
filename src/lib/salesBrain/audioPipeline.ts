/**
 * Sales Brain — Audio Pipeline
 *
 * Dedicated audio ingestion, classification, transcription fallback hierarchy,
 * quality gating, and failure taxonomy for audio resources.
 */

// ── Audio Subtypes ─────────────────────────────────────────
export const AUDIO_SUBTYPES = [
  'direct_audio_file',
  'podcast_episode_rss_backed',
  'spotify_episode',
  'spotify_show',
  'apple_podcast_episode',
  'apple_podcast_show',
  'podcast_episode_page_only',
  'youtube_audio_or_video',
  'auth_gated_audio',
  'transcript_page_available',
  'unsupported_audio',
] as const;

export type AudioSubtype = typeof AUDIO_SUBTYPES[number];

// ── Audio Failure Codes ────────────────────────────────────
export const AUDIO_FAILURE_CODES = [
  'AUDIO_UNREACHABLE',
  'INVALID_CONTENT_TYPE',
  'AUDIO_TOO_LARGE_UNCHUNKED',
  'TRANSCRIPTION_PROVIDER_ERROR',
  'TRANSCRIPT_TOO_SHORT',
  'TRANSCRIPT_LOW_SIGNAL',
  'AUTH_REQUIRED',
  'SOURCE_RESOLUTION_FAILED',
  'MANUAL_TRANSCRIPT_REQUIRED',
  'DOWNLOAD_FAILED',
  'CHUNK_ASSEMBLY_FAILED',
  'QUALITY_CHECK_FAILED',
] as const;

export type AudioFailureCode = typeof AUDIO_FAILURE_CODES[number];

// ── Pipeline Stages ────────────────────────────────────────
export const AUDIO_PIPELINE_STAGES = [
  'queued',
  'resolving_source',
  'downloading_audio',
  'transcribing',
  'assembling_transcript',
  'quality_check',
  'enriching',
  'completed',
  'failed',
  'needs_manual_assist',
] as const;

export type AudioPipelineStage = typeof AUDIO_PIPELINE_STAGES[number];

// ── Transcript Quality ─────────────────────────────────────
export const TRANSCRIPT_QUALITY_LEVELS = ['high_quality', 'usable', 'shallow', 'failed'] as const;
export type TranscriptQuality = typeof TRANSCRIPT_QUALITY_LEVELS[number];

export interface TranscriptQualityResult {
  quality: TranscriptQuality;
  totalWords: number;
  wordsPerMinute: number | null;
  repeatedLinesPct: number;
  fillerPct: number;
  languageConfidence: number | null;
  salesRelevanceScore: number;
  reason: string;
}

// ── Audio Strategy ─────────────────────────────────────────
export interface AudioFallbackPath {
  method: string;
  description: string;
}

export interface AudioStrategy {
  subtype: AudioSubtype;
  primaryPath: AudioFallbackPath;
  secondaryPath: AudioFallbackPath | null;
  tertiaryPath: AudioFallbackPath | null;
  metadataOnlyAcceptable: boolean;
  manualAssistRequired: boolean;
  retryMode: 'automatic' | 'blocked' | 'manual_only';
  operatorFailureReason: string;
}

// ── Audio Job State ────────────────────────────────────────
export interface AudioJobState {
  resourceId: string;
  audioSubtype: AudioSubtype;
  stage: AudioPipelineStage;
  failureCode: AudioFailureCode | null;
  failureReason: string | null;
  retryable: boolean;
  recommendedAction: string;
  attemptsCount: number;
  lastAttemptedStage: AudioPipelineStage | null;
  transcriptQuality: TranscriptQuality | null;
  transcriptWordCount: number | null;
  hasTranscript: boolean;
  sourceUrl: string | null;
  resolvedAudioUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Detection ──────────────────────────────────────────────
const AUDIO_EXTENSIONS = /\.(mp3|m4a|wav|ogg|aac|flac|wma|opus|webm)(\?|#|$)/i;
const PODCAST_DOMAINS = ['anchor.fm', 'podcasters.spotify.com', 'buzzsprout.com', 'libsyn.com', 'megaphone.fm', 'podbean.com', 'simplecast.com', 'transistor.fm', 'captivate.fm', 'spreaker.com'];
const AUDIO_CDN_DOMAINS = ['d3ctxlq1ktw2nl.cloudfront.net', 'cdn.simplecast.com', 'pdst.fm', 'chrt.fm', 'dts.podtrac.com', 'traffic.megaphone.fm', 'chtbl.com'];

export function isAudioResource(url: string | null, resourceType?: string): boolean {
  if (!url) return false;
  if (resourceType === 'podcast_episode' || resourceType === 'audio') return true;
  const lower = url.toLowerCase();
  if (AUDIO_EXTENSIONS.test(lower)) return true;
  try {
    const host = new URL(lower).hostname;
    if (AUDIO_CDN_DOMAINS.some(d => host.includes(d))) return true;
    if (PODCAST_DOMAINS.some(d => host.includes(d))) return true;
  } catch {}
  if (lower.includes('open.spotify.com/episode') || lower.includes('open.spotify.com/show')) return true;
  return false;
}

export function detectAudioSubtype(url: string | null, resourceType?: string): AudioSubtype {
  if (!url) return 'unsupported_audio';
  const lower = url.toLowerCase();

  // YouTube
  if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/') || lower.includes('youtube.com/embed')) {
    return 'youtube_audio_or_video';
  }

  // Spotify
  if (lower.includes('open.spotify.com/episode') || lower.includes('open.spotify.com/show')) {
    return 'spotify_episode';
  }

  // Direct audio file
  if (AUDIO_EXTENSIONS.test(lower)) return 'direct_audio_file';

  // Audio CDN domains (direct file behind CDN)
  try {
    const host = new URL(lower).hostname;
    if (AUDIO_CDN_DOMAINS.some(d => host.includes(d))) return 'direct_audio_file';
  } catch {}

  // Podcast domains
  try {
    const host = new URL(lower).hostname;
    if (PODCAST_DOMAINS.some(d => host.includes(d))) {
      return resourceType === 'podcast_episode' ? 'podcast_episode_rss_backed' : 'direct_audio_file';
    }
  } catch {}

  // Auth-gated
  const AUTH_DOMAINS = ['circle.so', 'teachable.com', 'patreon.com', 'skool.com'];
  try {
    const host = new URL(lower).hostname;
    if (AUTH_DOMAINS.some(d => host.includes(d))) return 'auth_gated_audio';
  } catch {}

  if (resourceType === 'podcast_episode') return 'podcast_episode_rss_backed';

  return 'unsupported_audio';
}

// ── Strategy ───────────────────────────────────────────────
export function getAudioStrategy(subtype: AudioSubtype): AudioStrategy {
  switch (subtype) {
    case 'direct_audio_file':
      return {
        subtype,
        primaryPath: { method: 'transcribe_direct', description: 'Download + transcribe audio file' },
        secondaryPath: { method: 'metadata_extract', description: 'Extract metadata from URL/headers' },
        tertiaryPath: { method: 'manual_transcript', description: 'Request manual transcript paste' },
        metadataOnlyAcceptable: false,
        manualAssistRequired: false,
        retryMode: 'automatic',
        operatorFailureReason: 'Audio file — transcription attempted, will retry automatically',
      };

    case 'podcast_episode_rss_backed':
      return {
        subtype,
        primaryPath: { method: 'resolve_rss_audio', description: 'Resolve audio URL from RSS/page' },
        secondaryPath: { method: 'transcribe_direct', description: 'Transcribe resolved audio' },
        tertiaryPath: { method: 'manual_transcript', description: 'Request manual transcript paste' },
        metadataOnlyAcceptable: true,
        manualAssistRequired: false,
        retryMode: 'automatic',
        operatorFailureReason: 'Podcast — attempting to resolve audio source from page',
      };

    case 'spotify_episode':
      return {
        subtype,
        primaryPath: { method: 'spotify_metadata', description: 'Extract Spotify metadata + show notes' },
        secondaryPath: { method: 'detect_transcript_source', description: 'Search for linked transcript' },
        tertiaryPath: { method: 'manual_transcript', description: 'Request manual transcript/notes' },
        metadataOnlyAcceptable: true,
        manualAssistRequired: true,
        retryMode: 'manual_only',
        operatorFailureReason: 'Spotify — no direct audio access. Metadata extracted, manual transcript needed for full enrichment',
      };

    case 'youtube_audio_or_video':
      return {
        subtype,
        primaryPath: { method: 'youtube_transcript', description: 'Extract YouTube transcript/captions' },
        secondaryPath: { method: 'youtube_metadata', description: 'Extract video metadata + description' },
        tertiaryPath: { method: 'manual_transcript', description: 'Request manual transcript paste' },
        metadataOnlyAcceptable: false,
        manualAssistRequired: false,
        retryMode: 'automatic',
        operatorFailureReason: 'YouTube — transcript extraction attempted via standard pipeline',
      };

    case 'auth_gated_audio':
      return {
        subtype,
        primaryPath: { method: 'manual_upload', description: 'Requires manual audio file upload' },
        secondaryPath: { method: 'manual_transcript', description: 'Request manual transcript paste' },
        tertiaryPath: null,
        metadataOnlyAcceptable: true,
        manualAssistRequired: true,
        retryMode: 'blocked',
        operatorFailureReason: 'Auth-gated — cannot access audio directly. Upload file or paste transcript',
      };

    case 'transcript_page_available':
      return {
        subtype,
        primaryPath: { method: 'extract_page_transcript', description: 'Extract transcript from linked page' },
        secondaryPath: { method: 'transcribe_direct', description: 'Transcribe audio if URL available' },
        tertiaryPath: null,
        metadataOnlyAcceptable: false,
        manualAssistRequired: false,
        retryMode: 'automatic',
        operatorFailureReason: 'Transcript page detected — extracting directly',
      };

    default:
      return {
        subtype: 'unsupported_audio',
        primaryPath: { method: 'manual_transcript', description: 'Manual transcript required' },
        secondaryPath: null,
        tertiaryPath: null,
        metadataOnlyAcceptable: true,
        manualAssistRequired: true,
        retryMode: 'blocked',
        operatorFailureReason: 'Unsupported audio format — manual input required',
      };
  }
}

// ── Transcript Quality Scoring ─────────────────────────────

const FILLER_WORDS = new Set(['um', 'uh', 'like', 'you know', 'basically', 'actually', 'right', 'so', 'well', 'okay']);
const SALES_KEYWORDS = new Set(['objection', 'prospect', 'pipeline', 'deal', 'close', 'discovery', 'champion', 'stakeholder', 'budget', 'timeline', 'decision', 'competitor', 'renewal', 'expansion', 'churn', 'retention', 'negotiation', 'proposal', 'demo', 'qualification', 'cold call', 'outreach', 'follow up', 'pain point', 'value prop', 'roi', 'use case']);

export function scoreTranscriptQuality(
  transcript: string,
  durationMinutes?: number,
): TranscriptQualityResult {
  if (!transcript || transcript.trim().length === 0) {
    return { quality: 'failed', totalWords: 0, wordsPerMinute: null, repeatedLinesPct: 0, fillerPct: 0, languageConfidence: null, salesRelevanceScore: 0, reason: 'Empty transcript' };
  }

  const words = transcript.split(/\s+/).filter(Boolean);
  const totalWords = words.length;
  const wordsPerMinute = durationMinutes ? Math.round(totalWords / durationMinutes) : null;

  // Repeated lines check
  const lines = transcript.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean);
  const lineSet = new Set(lines);
  const repeatedLinesPct = lines.length > 0 ? Math.round(((lines.length - lineSet.size) / lines.length) * 100) : 0;

  // Filler check
  const lowerWords = words.map(w => w.toLowerCase().replace(/[^a-z]/g, ''));
  const fillerCount = lowerWords.filter(w => FILLER_WORDS.has(w)).length;
  const fillerPct = totalWords > 0 ? Math.round((fillerCount / totalWords) * 100) : 0;

  // Sales relevance
  const lowerText = transcript.toLowerCase();
  let salesHits = 0;
  for (const kw of SALES_KEYWORDS) {
    if (lowerText.includes(kw)) salesHits++;
  }
  const salesRelevanceScore = Math.min(100, Math.round((salesHits / SALES_KEYWORDS.size) * 100 * 3));

  // Quality scoring
  if (totalWords < 50) {
    return { quality: 'failed', totalWords, wordsPerMinute, repeatedLinesPct, fillerPct, languageConfidence: null, salesRelevanceScore, reason: `Only ${totalWords} words — too short` };
  }

  if (repeatedLinesPct > 60) {
    return { quality: 'failed', totalWords, wordsPerMinute, repeatedLinesPct, fillerPct, languageConfidence: null, salesRelevanceScore, reason: `${repeatedLinesPct}% repeated lines — garbage transcript` };
  }

  if (totalWords < 200 || salesRelevanceScore < 5) {
    return { quality: 'shallow', totalWords, wordsPerMinute, repeatedLinesPct, fillerPct, languageConfidence: null, salesRelevanceScore, reason: totalWords < 200 ? 'Short transcript — limited content' : 'Low sales relevance' };
  }

  if (totalWords >= 500 && salesRelevanceScore >= 15 && repeatedLinesPct < 30) {
    return { quality: 'high_quality', totalWords, wordsPerMinute, repeatedLinesPct, fillerPct, languageConfidence: null, salesRelevanceScore, reason: 'Strong transcript with sales-relevant content' };
  }

  return { quality: 'usable', totalWords, wordsPerMinute, repeatedLinesPct, fillerPct, languageConfidence: null, salesRelevanceScore, reason: 'Adequate transcript for enrichment' };
}

// ── Failure Description Helpers ─────────────────────────────

export function getAudioFailureDescription(code: AudioFailureCode): { explanation: string; retryable: boolean; nextAction: string } {
  const map: Record<AudioFailureCode, { explanation: string; retryable: boolean; nextAction: string }> = {
    AUDIO_UNREACHABLE: { explanation: 'The audio URL could not be reached.', retryable: true, nextAction: 'Retry or check URL' },
    INVALID_CONTENT_TYPE: { explanation: 'The URL does not serve audio content.', retryable: false, nextAction: 'Verify URL or paste transcript' },
    AUDIO_TOO_LARGE_UNCHUNKED: { explanation: 'Audio file is too large without chunking support.', retryable: true, nextAction: 'Retry with chunking enabled' },
    TRANSCRIPTION_PROVIDER_ERROR: { explanation: 'Transcription service returned an error.', retryable: true, nextAction: 'Retry transcription' },
    TRANSCRIPT_TOO_SHORT: { explanation: 'Transcript was too short to be useful.', retryable: false, nextAction: 'Paste full transcript manually' },
    TRANSCRIPT_LOW_SIGNAL: { explanation: 'Transcript lacks meaningful sales content.', retryable: false, nextAction: 'Review transcript or add notes' },
    AUTH_REQUIRED: { explanation: 'Audio source requires authentication.', retryable: false, nextAction: 'Upload file or paste transcript' },
    SOURCE_RESOLUTION_FAILED: { explanation: 'Could not resolve the audio source from the page.', retryable: true, nextAction: 'Retry or paste direct audio URL' },
    MANUAL_TRANSCRIPT_REQUIRED: { explanation: 'No automatic transcription path available.', retryable: false, nextAction: 'Paste transcript or upload audio' },
    DOWNLOAD_FAILED: { explanation: 'Audio download failed mid-stream.', retryable: true, nextAction: 'Retry download' },
    CHUNK_ASSEMBLY_FAILED: { explanation: 'Failed to assemble transcript chunks.', retryable: true, nextAction: 'Retry assembly' },
    QUALITY_CHECK_FAILED: { explanation: 'Transcript failed quality checks.', retryable: false, nextAction: 'Review and paste better transcript' },
  };
  return map[code] || { explanation: 'Unknown audio failure.', retryable: false, nextAction: 'Review manually' };
}

export function getAudioStageLabel(stage: AudioPipelineStage): string {
  const labels: Record<AudioPipelineStage, string> = {
    queued: 'Queued',
    resolving_source: 'Resolving Source',
    downloading_audio: 'Downloading',
    transcribing: 'Transcribing',
    assembling_transcript: 'Assembling',
    quality_check: 'Quality Check',
    enriching: 'Enriching',
    completed: 'Completed',
    failed: 'Failed',
    needs_manual_assist: 'Manual Assist',
  };
  return labels[stage] || stage;
}

// ── Audio Job Storage (localStorage) ───────────────────────
const AUDIO_JOBS_KEY = 'sales-brain-audio-jobs';
const MAX_AUDIO_JOBS = 500;

export function loadAudioJobs(): AudioJobState[] {
  try {
    const raw = localStorage.getItem(AUDIO_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

export function saveAudioJobs(jobs: AudioJobState[]): void {
  try {
    const trimmed = jobs.slice(0, MAX_AUDIO_JOBS);
    localStorage.setItem(AUDIO_JOBS_KEY, JSON.stringify(trimmed));
  } catch {}
}

export function getAudioJobForResource(resourceId: string): AudioJobState | null {
  return loadAudioJobs().find(j => j.resourceId === resourceId) || null;
}

export function upsertAudioJob(job: AudioJobState): void {
  const jobs = loadAudioJobs();
  const idx = jobs.findIndex(j => j.resourceId === job.resourceId);
  if (idx >= 0) {
    jobs[idx] = job;
  } else {
    jobs.unshift(job);
  }
  saveAudioJobs(jobs);
}

export function createAudioJob(resourceId: string, url: string | null, resourceType?: string): AudioJobState {
  const audioSubtype = detectAudioSubtype(url, resourceType);
  const strategy = getAudioStrategy(audioSubtype);
  const job: AudioJobState = {
    resourceId,
    audioSubtype,
    stage: 'queued',
    failureCode: null,
    failureReason: null,
    retryable: strategy.retryMode !== 'blocked',
    recommendedAction: strategy.operatorFailureReason,
    attemptsCount: 0,
    lastAttemptedStage: null,
    transcriptQuality: null,
    transcriptWordCount: null,
    hasTranscript: false,
    sourceUrl: url,
    resolvedAudioUrl: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  upsertAudioJob(job);
  return job;
}

export function failAudioJob(resourceId: string, code: AudioFailureCode, stage: AudioPipelineStage): AudioJobState | null {
  const job = getAudioJobForResource(resourceId);
  if (!job) return null;
  const desc = getAudioFailureDescription(code);
  job.stage = desc.retryable ? 'failed' : 'needs_manual_assist';
  job.failureCode = code;
  job.failureReason = desc.explanation;
  job.retryable = desc.retryable;
  job.recommendedAction = desc.nextAction;
  job.lastAttemptedStage = stage;
  job.attemptsCount++;
  job.updatedAt = new Date().toISOString();
  upsertAudioJob(job);
  return job;
}

export function completeAudioJob(resourceId: string, quality: TranscriptQualityResult): AudioJobState | null {
  const job = getAudioJobForResource(resourceId);
  if (!job) return null;
  job.stage = quality.quality === 'failed' ? 'needs_manual_assist' : 'completed';
  job.transcriptQuality = quality.quality;
  job.transcriptWordCount = quality.totalWords;
  job.hasTranscript = quality.quality !== 'failed';
  job.failureCode = quality.quality === 'failed' ? 'QUALITY_CHECK_FAILED' : null;
  job.failureReason = quality.quality === 'failed' ? quality.reason : null;
  job.recommendedAction = quality.quality === 'failed' ? 'Paste or upload a better transcript' : 'Transcript ready for enrichment';
  job.updatedAt = new Date().toISOString();
  upsertAudioJob(job);
  return job;
}

// ── Audio Health Stats ─────────────────────────────────────
export interface AudioPipelineHealth {
  totalAudio: number;
  queued: number;
  transcribed: number;
  shallow: number;
  failed: number;
  needsManualAssist: number;
  topFailureCodes: Array<{ code: AudioFailureCode; count: number }>;
  retryableCount: number;
  nonRetryableCount: number;
  avgTranscriptWords: number;
}

export function getAudioPipelineHealth(): AudioPipelineHealth {
  const jobs = loadAudioJobs();
  const failureCodeMap = new Map<AudioFailureCode, number>();
  let totalWords = 0;
  let wordedCount = 0;

  const stats: AudioPipelineHealth = {
    totalAudio: jobs.length,
    queued: 0,
    transcribed: 0,
    shallow: 0,
    failed: 0,
    needsManualAssist: 0,
    topFailureCodes: [],
    retryableCount: 0,
    nonRetryableCount: 0,
    avgTranscriptWords: 0,
  };

  for (const j of jobs) {
    if (j.stage === 'queued') stats.queued++;
    else if (j.stage === 'completed') stats.transcribed++;
    else if (j.stage === 'failed') stats.failed++;
    else if (j.stage === 'needs_manual_assist') stats.needsManualAssist++;

    if (j.transcriptQuality === 'shallow') stats.shallow++;
    if (j.retryable) stats.retryableCount++;
    else if (j.stage === 'failed' || j.stage === 'needs_manual_assist') stats.nonRetryableCount++;

    if (j.failureCode) {
      failureCodeMap.set(j.failureCode, (failureCodeMap.get(j.failureCode) || 0) + 1);
    }

    if (j.transcriptWordCount) {
      totalWords += j.transcriptWordCount;
      wordedCount++;
    }
  }

  stats.avgTranscriptWords = wordedCount > 0 ? Math.round(totalWords / wordedCount) : 0;
  stats.topFailureCodes = Array.from(failureCodeMap.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return stats;
}

// ── Recovery helpers ───────────────────────────────────────
export function reclassifyAudioFailures(): number {
  const jobs = loadAudioJobs();
  let changed = 0;
  for (const j of jobs) {
    if (j.stage !== 'failed') continue;
    const newSubtype = detectAudioSubtype(j.sourceUrl, undefined);
    if (newSubtype !== j.audioSubtype) {
      j.audioSubtype = newSubtype;
      const strategy = getAudioStrategy(newSubtype);
      j.retryable = strategy.retryMode !== 'blocked';
      j.recommendedAction = strategy.operatorFailureReason;
      j.updatedAt = new Date().toISOString();
      changed++;
    }
  }
  if (changed > 0) saveAudioJobs(jobs);
  return changed;
}

export function retryRetryableAudioJobs(): number {
  const jobs = loadAudioJobs();
  let count = 0;
  for (const j of jobs) {
    if (j.stage === 'failed' && j.retryable) {
      j.stage = 'queued';
      j.failureCode = null;
      j.failureReason = null;
      j.updatedAt = new Date().toISOString();
      count++;
    }
  }
  if (count > 0) saveAudioJobs(jobs);
  return count;
}

export function moveNonRetryableToManualAssist(): number {
  const jobs = loadAudioJobs();
  let count = 0;
  for (const j of jobs) {
    if (j.stage === 'failed' && !j.retryable) {
      j.stage = 'needs_manual_assist';
      j.updatedAt = new Date().toISOString();
      count++;
    }
  }
  if (count > 0) saveAudioJobs(jobs);
  return count;
}
