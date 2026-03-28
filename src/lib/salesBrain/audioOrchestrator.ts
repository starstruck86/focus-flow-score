/**
 * Audio Transcription Orchestrator
 * 
 * Drives the real audio pipeline: creates DB job, calls edge functions,
 * persists results, handles retry from last successful stage.
 * Supports direct audio, Spotify episodes, Apple Podcast episodes.
 */

import { supabase } from '@/integrations/supabase/client';
import { detectAudioSubtype, scoreTranscriptQuality, getAudioFailureDescription } from './audioPipeline';
import type { AudioSubtype, AudioPipelineStage, AudioFailureCode, TranscriptQualityResult } from './audioPipeline';

export interface AudioJobRecord {
  id: string;
  user_id: string;
  resource_id: string;
  source_url: string | null;
  resolved_audio_url: string | null;
  audio_subtype: string;
  stage: string;
  failure_code: string | null;
  failure_reason: string | null;
  retryable: boolean;
  recommended_action: string | null;
  attempts_count: number;
  last_attempted_stage: string | null;
  transcript_text: string | null;
  transcript_segments: any[];
  transcript_quality: string | null;
  transcript_word_count: number | null;
  has_transcript: boolean;
  provider_job_ids: any[];
  chunk_metadata: any[];
  quality_result: TranscriptQualityResult | null;
  last_successful_stage: string | null;
  provider_used: string | null;
  // Platform resolution fields
  platform_source_type: string | null;
  source_episode_id: string | null;
  source_show_id: string | null;
  canonical_episode_url: string | null;
  rss_feed_url: string | null;
  transcript_source_url: string | null;
  metadata_json: any;
  resolver_attempts: number;
  last_resolution_stage: string | null;
  transcript_mode: string | null;
  final_resolution_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface TranscribeDirectResult {
  success: boolean;
  jobId: string;
  transcript: string | null;
  totalWords: number;
  quality: TranscriptQualityResult | null;
  failureCode: string | null;
  failureReason: string | null;
  stage: string;
  chunksTotal: number;
  chunksCompleted: number;
  provider: string | null;
  durationMs: number;
  persisted: boolean;
}

export interface PlatformResolveResult {
  success: boolean;
  jobId: string;
  subtype: string;
  metadata: {
    title: string | null;
    showName: string | null;
    description: string | null;
    durationMs: number | null;
    artworkUrl: string | null;
    episodeUrl: string | null;
    publishDate: string | null;
  };
  resolution: {
    rssFeedUrl: string | null;
    audioEnclosureUrl: string | null;
    transcriptSourceUrl: string | null;
    canonicalPageUrl: string | null;
  };
  finalStatus: string;
  failureCode: string | null;
  failureReason: string | null;
  resolverStages: Array<{ stage: string; status: string; detail?: string }>;
  transcriptionResult?: TranscribeDirectResult;
}

/**
 * Create or get existing audio job for a resource
 */
export async function getOrCreateAudioJob(
  resourceId: string,
  sourceUrl: string,
  resourceType?: string,
): Promise<AudioJobRecord | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: existing } = await supabase
    .from('audio_jobs')
    .select('*')
    .eq('resource_id', resourceId)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0] as unknown as AudioJobRecord;
  }

  const subtype = detectAudioSubtype(sourceUrl, resourceType);
  const { data, error } = await supabase
    .from('audio_jobs')
    .insert({
      user_id: user.id,
      resource_id: resourceId,
      source_url: sourceUrl,
      audio_subtype: subtype,
      stage: 'queued',
      retryable: true,
    })
    .select()
    .single();

  if (error) {
    console.error('Failed to create audio job:', error);
    return null;
  }

  return data as unknown as AudioJobRecord;
}

/**
 * Resolve a Spotify/Apple Podcast episode — extract metadata, find audio URL
 */
export async function resolvePodcastEpisode(
  resourceId: string,
  sourceUrl: string,
): Promise<PlatformResolveResult> {
  const job = await getOrCreateAudioJob(resourceId, sourceUrl);
  if (!job) {
    return {
      success: false, jobId: '', subtype: 'unsupported_audio',
      metadata: { title: null, showName: null, description: null, durationMs: null, artworkUrl: null, episodeUrl: null, publishDate: null },
      resolution: { rssFeedUrl: null, audioEnclosureUrl: null, transcriptSourceUrl: null, canonicalPageUrl: null },
      finalStatus: 'failed', failureCode: 'SOURCE_RESOLUTION_FAILED',
      failureReason: 'Could not create job (not authenticated?)',
      resolverStages: [],
    };
  }

  await updateJobStage(job.id, 'resolving_platform_metadata' as AudioPipelineStage);

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    const resp = await fetch(`${supabaseUrl}/functions/v1/resolve-podcast-episode`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ url: sourceUrl }),
    });

    const result = await resp.json();

    // Persist resolution results to DB
    const updatePayload: Record<string, any> = {
      audio_subtype: result.subtype || job.audio_subtype,
      platform_source_type: result.subtype || null,
      metadata_json: result.metadata || {},
      resolver_attempts: (job.resolver_attempts || 0) + 1,
      last_resolution_stage: result.resolverStages?.[result.resolverStages.length - 1]?.stage || null,
      updated_at: new Date().toISOString(),
    };

    if (result.resolution) {
      if (result.resolution.rssFeedUrl) updatePayload.rss_feed_url = result.resolution.rssFeedUrl;
      if (result.resolution.audioEnclosureUrl) updatePayload.resolved_audio_url = result.resolution.audioEnclosureUrl;
      if (result.resolution.transcriptSourceUrl) updatePayload.transcript_source_url = result.resolution.transcriptSourceUrl;
      if (result.resolution.canonicalPageUrl) updatePayload.canonical_episode_url = result.resolution.canonicalPageUrl;
    }

    if (result.metadata) {
      // Extract episode/show IDs
      const spotifyMatch = sourceUrl.match(/episode\/([a-zA-Z0-9]+)/);
      const appleShowMatch = sourceUrl.match(/\/id(\d+)/);
      const appleEpMatch = sourceUrl.match(/[?&]i=(\d+)/);
      if (spotifyMatch) updatePayload.source_episode_id = spotifyMatch[1];
      if (appleShowMatch) updatePayload.source_show_id = appleShowMatch[1];
      if (appleEpMatch) updatePayload.source_episode_id = appleEpMatch[1];
    }

    // Determine final state
    if (result.finalStatus === 'audio_resolved' && result.resolution?.audioEnclosureUrl) {
      // Audio URL found — route to transcription
      updatePayload.stage = 'resolving_source';
      updatePayload.transcript_mode = 'direct_transcription';
      updatePayload.final_resolution_status = 'audio_resolved';
      await supabase.from('audio_jobs').update(updatePayload).eq('id', job.id);

      // Auto-continue to transcription
      const transcriptionResult = await transcribeDirectAudio(resourceId, result.resolution.audioEnclosureUrl);
      return {
        success: transcriptionResult.success,
        jobId: job.id,
        subtype: result.subtype,
        metadata: result.metadata,
        resolution: result.resolution,
        finalStatus: transcriptionResult.success ? 'completed' : 'failed',
        failureCode: transcriptionResult.failureCode,
        failureReason: transcriptionResult.failureReason,
        resolverStages: result.resolverStages || [],
        transcriptionResult,
      };
    } else if (result.finalStatus === 'metadata_only') {
      updatePayload.stage = 'metadata_only_complete';
      updatePayload.transcript_mode = 'metadata_only';
      updatePayload.final_resolution_status = 'metadata_only';
      updatePayload.failure_code = result.failureCode;
      updatePayload.failure_reason = result.failureReason;
      updatePayload.retryable = false;
      updatePayload.recommended_action = result.failureReason;
      await supabase.from('audio_jobs').update(updatePayload).eq('id', job.id);
    } else {
      updatePayload.stage = 'needs_manual_assist';
      updatePayload.transcript_mode = 'manual_assist';
      updatePayload.final_resolution_status = 'needs_manual_assist';
      updatePayload.failure_code = result.failureCode || 'MANUAL_ASSIST_RECOMMENDED';
      updatePayload.failure_reason = result.failureReason || 'Automatic resolution exhausted';
      updatePayload.retryable = false;
      updatePayload.recommended_action = 'Open manual assist to provide transcript or notes';
      await supabase.from('audio_jobs').update(updatePayload).eq('id', job.id);
    }

    return {
      success: true,
      jobId: job.id,
      subtype: result.subtype,
      metadata: result.metadata,
      resolution: result.resolution,
      finalStatus: result.finalStatus,
      failureCode: result.failureCode,
      failureReason: result.failureReason,
      resolverStages: result.resolverStages || [],
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobFailure(job.id, 'SOURCE_RESOLUTION_FAILED', msg, 'resolving_platform_metadata');
    return {
      success: false, jobId: job.id, subtype: job.audio_subtype,
      metadata: { title: null, showName: null, description: null, durationMs: null, artworkUrl: null, episodeUrl: null, publishDate: null },
      resolution: { rssFeedUrl: null, audioEnclosureUrl: null, transcriptSourceUrl: null, canonicalPageUrl: null },
      finalStatus: 'failed', failureCode: 'SOURCE_RESOLUTION_FAILED', failureReason: msg,
      resolverStages: [],
    };
  }
}

/**
 * Run the full transcription pipeline for a direct audio URL.
 */
export async function transcribeDirectAudio(
  resourceId: string,
  audioUrl: string,
): Promise<TranscribeDirectResult> {
  const startMs = Date.now();

  const job = await getOrCreateAudioJob(resourceId, audioUrl);
  if (!job) {
    return {
      success: false, jobId: '', transcript: null, totalWords: 0, quality: null,
      failureCode: 'AUDIO_UNREACHABLE', failureReason: 'Could not create audio job (not authenticated?)',
      stage: 'queued', chunksTotal: 0, chunksCompleted: 0, provider: null,
      durationMs: Date.now() - startMs, persisted: false,
    };
  }

  await updateJobStage(job.id, 'resolving_source');

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    const resp = await fetch(`${supabaseUrl}/functions/v1/transcribe-audio`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || ''}`,
        'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        audio_url: audioUrl,
        resource_id: resourceId,
        job_id: job.id,
      }),
    });

    const result = await resp.json();

    if (!result.success) {
      await updateJobFailure(job.id, result.failureCode, result.failureReason, result.stage);
      return {
        success: false, jobId: job.id, transcript: null, totalWords: 0, quality: null,
        failureCode: result.failureCode, failureReason: result.failureReason,
        stage: result.stage || 'failed', chunksTotal: result.chunksTotal || 0,
        chunksCompleted: 0, provider: null,
        durationMs: Date.now() - startMs, persisted: false,
      };
    }

    const quality = scoreTranscriptQuality(result.transcript || '', undefined);

    // If quality is 'failed', this means transcription happened but content is weak.
    // Always store a specific failure_code so operator knows what happened.
    const isQualityFailed = quality.quality === 'failed';

    await supabase.from('audio_jobs').update({
      stage: isQualityFailed ? 'needs_manual_assist' : 'completed',
      transcript_text: result.transcript,
      transcript_segments: result.segments,
      transcript_word_count: result.totalWords,
      transcript_quality: quality.quality,
      has_transcript: !isQualityFailed,
      quality_result: quality as any,
      provider_used: result.provider,
      chunk_metadata: result.segments?.map((s: any) => ({ index: s.chunkIndex, startByte: s.startByte, endByte: s.endByte })) || [],
      last_successful_stage: 'transcribing',
      transcript_mode: 'direct_transcription',
      final_resolution_status: isQualityFailed ? 'needs_manual_assist' : 'completed',
      attempts_count: (job.attempts_count || 0) + 1,
      // When quality fails, store a clear failure code instead of clearing it
      failure_code: isQualityFailed ? (quality.totalWords < 50 ? 'TRANSCRIPT_TOO_SHORT' : 'TRANSCRIPT_LOW_SIGNAL') : null,
      failure_reason: isQualityFailed ? quality.reason : null,
      recommended_action: isQualityFailed ? 'Paste a full transcript via Manual Assist, or provide a better audio source' : null,
      retryable: false,
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);

    return {
      success: true, jobId: job.id, transcript: result.transcript, totalWords: result.totalWords,
      quality, failureCode: null, failureReason: null,
      stage: 'completed', chunksTotal: result.chunksTotal, chunksCompleted: result.chunksCompleted,
      provider: result.provider, durationMs: Date.now() - startMs, persisted: result.persisted ?? true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await updateJobFailure(job.id, 'TRANSCRIPTION_PROVIDER_ERROR', msg, 'transcribing');
    return {
      success: false, jobId: job.id, transcript: null, totalWords: 0, quality: null,
      failureCode: 'TRANSCRIPTION_PROVIDER_ERROR', failureReason: msg,
      stage: 'failed', chunksTotal: 0, chunksCompleted: 0, provider: null,
      durationMs: Date.now() - startMs, persisted: false,
    };
  }
}

/**
 * Smart orchestrator — routes by subtype automatically.
 * Every subtype MUST be explicitly handled. No silent fallthrough.
 */
export async function processAudioResource(
  resourceId: string,
  sourceUrl: string,
  resourceType?: string,
): Promise<TranscribeDirectResult | PlatformResolveResult> {
  const subtype = detectAudioSubtype(sourceUrl, resourceType);

  switch (subtype) {
    // Direct transcription path
    case 'direct_audio_file':
    case 'podcast_episode_rss_backed':
      return transcribeDirectAudio(resourceId, sourceUrl);

    // Platform resolution → may chain to transcription
    case 'spotify_episode':
    case 'spotify_show':
    case 'apple_podcast_episode':
    case 'apple_podcast_show':
    case 'podcast_episode_page_only':
      return resolvePodcastEpisode(resourceId, sourceUrl);

    // YouTube — route through standard transcription (captions pipeline)
    case 'youtube_audio_or_video':
      return transcribeDirectAudio(resourceId, sourceUrl);

    // Transcript page — attempt direct extraction
    case 'transcript_page_available':
      return transcribeDirectAudio(resourceId, sourceUrl);

    // Auth-gated — cannot auto-process, fail immediately with clear guidance
    case 'auth_gated_audio': {
      const job = await getOrCreateAudioJob(resourceId, sourceUrl, resourceType);
      if (job) {
        await supabase.from('audio_jobs').update({
          stage: 'needs_manual_assist',
          failure_code: 'AUTH_REQUIRED',
          failure_reason: 'Audio is behind authentication — upload file or paste transcript',
          retryable: false,
          recommended_action: 'Upload the audio file directly, or paste the transcript via Manual Assist',
          transcript_mode: 'manual_assist',
          final_resolution_status: 'needs_manual_assist',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      return {
        success: false, jobId: job?.id || '', transcript: null, totalWords: 0, quality: null,
        failureCode: 'AUTH_REQUIRED',
        failureReason: 'Audio is behind authentication — upload file or paste transcript',
        stage: 'needs_manual_assist', chunksTotal: 0, chunksCompleted: 0, provider: null,
        durationMs: 0, persisted: false,
      };
    }

    // Unsupported — fail with clear guidance, never silently
    case 'unsupported_audio':
    default: {
      const job = await getOrCreateAudioJob(resourceId, sourceUrl, resourceType);
      if (job) {
        await supabase.from('audio_jobs').update({
          stage: 'needs_manual_assist',
          failure_code: 'MANUAL_TRANSCRIPT_REQUIRED',
          failure_reason: 'Unsupported audio format — paste transcript or provide a direct audio URL',
          retryable: false,
          recommended_action: 'Paste transcript via Manual Assist, or provide a direct MP3/audio URL',
          transcript_mode: 'manual_assist',
          final_resolution_status: 'needs_manual_assist',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      return {
        success: false, jobId: job?.id || '', transcript: null, totalWords: 0, quality: null,
        failureCode: 'MANUAL_TRANSCRIPT_REQUIRED',
        failureReason: 'Unsupported audio format — paste transcript or provide a direct audio URL',
        stage: 'needs_manual_assist', chunksTotal: 0, chunksCompleted: 0, provider: null,
        durationMs: 0, persisted: false,
      };
    }
  }
}

/**
 * Retry a failed audio job — resumes from last successful stage
 */
export async function retryAudioJob(jobId: string): Promise<TranscribeDirectResult> {
  const { data } = await supabase.from('audio_jobs').select('*').eq('id', jobId).single();
  if (!data) {
    return {
      success: false, jobId, transcript: null, totalWords: 0, quality: null,
      failureCode: 'AUDIO_UNREACHABLE', failureReason: 'Job not found',
      stage: 'failed', chunksTotal: 0, chunksCompleted: 0, provider: null,
      durationMs: 0, persisted: false,
    };
  }

  const job = data as unknown as AudioJobRecord;
  if (!job.source_url) {
    return {
      success: false, jobId, transcript: null, totalWords: 0, quality: null,
      failureCode: 'AUDIO_UNREACHABLE', failureReason: 'No source URL',
      stage: 'failed', chunksTotal: 0, chunksCompleted: 0, provider: null,
      durationMs: 0, persisted: false,
    };
  }

  if (job.last_successful_stage === 'transcribing' && job.transcript_text) {
    const quality = scoreTranscriptQuality(job.transcript_text);
    await supabase.from('audio_jobs').update({
      stage: quality.quality === 'failed' ? 'needs_manual_assist' : 'completed',
      transcript_quality: quality.quality,
      quality_result: quality as any,
      updated_at: new Date().toISOString(),
    }).eq('id', jobId);

    return {
      success: quality.quality !== 'failed', jobId, transcript: job.transcript_text,
      totalWords: job.transcript_word_count || 0, quality,
      failureCode: null, failureReason: null,
      stage: 'completed', chunksTotal: 0, chunksCompleted: 0,
      provider: job.provider_used, durationMs: 0, persisted: true,
    };
  }

  // If resolved audio URL exists, go straight to transcription
  if (job.resolved_audio_url) {
    return transcribeDirectAudio(job.resource_id, job.resolved_audio_url);
  }

  return transcribeDirectAudio(job.resource_id, job.source_url);
}

/**
 * Re-run platform resolution only (for Spotify/Apple jobs)
 */
export async function retryPlatformResolution(jobId: string): Promise<PlatformResolveResult | null> {
  const { data } = await supabase.from('audio_jobs').select('*').eq('id', jobId).single();
  if (!data || !data.source_url) return null;
  const job = data as unknown as AudioJobRecord;
  return resolvePodcastEpisode(job.resource_id, job.source_url);
}

/**
 * Load all audio jobs for the current user
 */
export async function loadUserAudioJobs(): Promise<AudioJobRecord[]> {
  const { data } = await supabase
    .from('audio_jobs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);

  return (data || []) as unknown as AudioJobRecord[];
}

/**
 * Get audio job for a specific resource
 */
export async function getAudioJobForResourceDb(resourceId: string): Promise<AudioJobRecord | null> {
  const { data } = await supabase
    .from('audio_jobs')
    .select('*')
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(1);

  return (data && data.length > 0 ? data[0] : null) as unknown as AudioJobRecord | null;
}

async function updateJobStage(jobId: string, stage: AudioPipelineStage) {
  await supabase.from('audio_jobs').update({
    stage,
    last_attempted_stage: stage,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
}

async function updateJobFailure(jobId: string, code: string, reason: string, stage: string) {
  const desc = getAudioFailureDescription(code as AudioFailureCode);
  await supabase.from('audio_jobs').update({
    stage: desc.retryable ? 'failed' : 'needs_manual_assist',
    failure_code: code,
    failure_reason: reason,
    retryable: desc.retryable,
    recommended_action: desc.nextAction,
    last_attempted_stage: stage,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
}
