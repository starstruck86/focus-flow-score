/**
 * Audio Transcription Orchestrator
 * 
 * Drives the real audio pipeline: creates DB job, calls edge function,
 * persists results, handles retry from last successful stage.
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

  // Check for existing job
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

  // Create new job
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
 * Run the full transcription pipeline for a direct audio URL.
 * This is the REAL execution engine.
 */
export async function transcribeDirectAudio(
  resourceId: string,
  audioUrl: string,
): Promise<TranscribeDirectResult> {
  const startMs = Date.now();

  // 1. Get or create job
  const job = await getOrCreateAudioJob(resourceId, audioUrl);
  if (!job) {
    return {
      success: false, jobId: '', transcript: null, totalWords: 0, quality: null,
      failureCode: 'AUDIO_UNREACHABLE', failureReason: 'Could not create audio job (not authenticated?)',
      stage: 'queued', chunksTotal: 0, chunksCompleted: 0, provider: null,
      durationMs: Date.now() - startMs, persisted: false,
    };
  }

  // 2. Update stage to resolving
  await updateJobStage(job.id, 'resolving_source');

  // 3. Call the edge function
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
      // Update job with failure
      await updateJobFailure(job.id, result.failureCode, result.failureReason, result.stage);
      return {
        success: false, jobId: job.id, transcript: null, totalWords: 0, quality: null,
        failureCode: result.failureCode, failureReason: result.failureReason,
        stage: result.stage || 'failed', chunksTotal: result.chunksTotal || 0,
        chunksCompleted: 0, provider: null,
        durationMs: Date.now() - startMs, persisted: false,
      };
    }

    // 4. Score quality
    const quality = scoreTranscriptQuality(result.transcript || '', undefined);

    // 5. Update job with success
    await supabase.from('audio_jobs').update({
      stage: quality.quality === 'failed' ? 'needs_manual_assist' : 'completed',
      transcript_text: result.transcript,
      transcript_segments: result.segments,
      transcript_word_count: result.totalWords,
      transcript_quality: quality.quality,
      has_transcript: quality.quality !== 'failed',
      quality_result: quality as any,
      provider_used: result.provider,
      chunk_metadata: result.segments?.map((s: any) => ({ index: s.chunkIndex, startByte: s.startByte, endByte: s.endByte })) || [],
      last_successful_stage: 'transcribing',
      attempts_count: (job.attempts_count || 0) + 1,
      failure_code: null,
      failure_reason: null,
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

  // If we already have a transcript, just re-run quality check
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

  // Otherwise re-run full pipeline
  return transcribeDirectAudio(job.resource_id, job.source_url);
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
