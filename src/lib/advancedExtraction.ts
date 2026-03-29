/**
 * Advanced Extraction — triggers deep platform-specific extraction
 * with capped retries and structured attempt history.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';

const MAX_ADVANCED_ATTEMPTS = 3;

export interface AdvancedExtractionResult {
  success: boolean;
  status: 'queued' | 'max_attempts_reached' | 'error';
  message: string;
}

/**
 * Trigger deep extraction for a resource.
 * Sets advanced_extraction_status to 'pending', bumps attempts, then invokes enrichment.
 */
export async function triggerDeepExtraction(
  resourceId: string,
  userId: string,
  platform: string,
): Promise<AdvancedExtractionResult> {
  // Check current attempt count
  const { data: resource } = await (supabase as any)
    .from('resources')
    .select('advanced_extraction_attempts, advanced_extraction_status')
    .eq('id', resourceId)
    .single();

  const currentAttempts = resource?.advanced_extraction_attempts ?? 0;

  if (currentAttempts >= MAX_ADVANCED_ATTEMPTS) {
    return {
      success: false,
      status: 'max_attempts_reached',
      message: `Maximum ${MAX_ADVANCED_ATTEMPTS} advanced extraction attempts reached. Use assisted resolution instead.`,
    };
  }

  const now = new Date().toISOString();

  // Record attempt start
  await (supabase as any).from('enrichment_attempts').insert({
    resource_id: resourceId,
    user_id: userId,
    attempt_type: 'advanced_extraction',
    strategy: `${platform}_deep_extraction`,
    platform,
    started_at: now,
    result: 'pending',
  });

  // Update resource state
  await (supabase as any).from('resources').update({
    advanced_extraction_status: 'in_progress',
    advanced_extraction_attempts: currentAttempts + 1,
    last_advanced_extraction_at: now,
    enrichment_status: 'not_enriched',
    failure_reason: null,
    last_status_change_at: now,
    recovery_status: 'advanced_extraction_running',
  }).eq('id', resourceId);

  // Invoke enrichment with force + deep flag
  try {
    await invokeEnrichResource(
      { resource_id: resourceId, force: true },
      { componentName: 'AdvancedExtraction', timeoutMs: 120000 },
    );
  } catch (e: any) {
    // Update attempt as failed
    await (supabase as any).from('resources').update({
      advanced_extraction_status: 'failed',
      last_recovery_error: e.message,
      recovery_status: 'advanced_extraction_failed',
    }).eq('id', resourceId);

    return { success: false, status: 'error', message: e.message };
  }

  return { success: true, status: 'queued', message: 'Advanced extraction initiated' };
}

/**
 * Record an attempt completion (called after enrichment finishes).
 */
export async function recordAttemptCompletion(
  resourceId: string,
  userId: string,
  result: 'success' | 'failed' | 'partial',
  details: {
    failureCategory?: string;
    contentFound?: boolean;
    transcriptUrlFound?: boolean;
    mediaUrlFound?: boolean;
    captionUrlFound?: boolean;
    shellRejected?: boolean;
    runtimeConfigFound?: boolean;
    contentLengthExtracted?: number;
    qualityScoreAfter?: number;
    errorMessage?: string;
  },
): Promise<void> {
  // Find the latest pending attempt for this resource
  const { data: attempts } = await (supabase as any)
    .from('enrichment_attempts')
    .select('id')
    .eq('resource_id', resourceId)
    .eq('result', 'pending')
    .order('started_at', { ascending: false })
    .limit(1);

  if (attempts?.length) {
    await (supabase as any).from('enrichment_attempts').update({
      completed_at: new Date().toISOString(),
      result,
      failure_category: details.failureCategory,
      content_found: details.contentFound ?? false,
      transcript_url_found: details.transcriptUrlFound ?? false,
      media_url_found: details.mediaUrlFound ?? false,
      caption_url_found: details.captionUrlFound ?? false,
      shell_rejected: details.shellRejected ?? false,
      runtime_config_found: details.runtimeConfigFound ?? false,
      content_length_extracted: details.contentLengthExtracted ?? 0,
      quality_score_after: details.qualityScoreAfter,
      error_message: details.errorMessage,
    }).eq('id', attempts[0].id);
  }
}

export interface EnrichmentAttemptRecord {
  id: string;
  attempt_type: string;
  strategy: string;
  platform: string | null;
  started_at: string;
  completed_at: string | null;
  result: string;
  failure_category: string | null;
  content_found: boolean;
  transcript_url_found: boolean;
  media_url_found: boolean;
  caption_url_found: boolean;
  shell_rejected: boolean;
  runtime_config_found: boolean;
  content_length_extracted: number;
  quality_score_after: number | null;
  error_message: string | null;
}

/**
 * Get attempt history for a resource.
 */
export async function getAttemptHistory(resourceId: string): Promise<EnrichmentAttemptRecord[]> {
  const { data, error } = await (supabase as any)
    .from('enrichment_attempts')
    .select('*')
    .eq('resource_id', resourceId)
    .order('started_at', { ascending: false });
  if (error) return [];
  return (data || []) as EnrichmentAttemptRecord[];
}
