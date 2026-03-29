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
 * After enrichment completes (or fails), closes the pending attempt record.
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
  const { data: attemptRow } = await (supabase as any).from('enrichment_attempts').insert({
    resource_id: resourceId,
    user_id: userId,
    attempt_type: 'advanced_extraction',
    strategy: `${platform}_deep_extraction`,
    platform,
    started_at: now,
    result: 'pending',
  }).select('id').single();

  const attemptId = attemptRow?.id;

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

    // Poll for resource state to stabilise (edge function may still be writing)
    await closeAttemptWithRetry(resourceId, attemptId, 4, 1500);
  } catch (e: any) {
    // Update attempt as failed
    if (attemptId) {
      await (supabase as any).from('enrichment_attempts').update({
        completed_at: new Date().toISOString(),
        result: 'failed',
        error_message: e.message,
      }).eq('id', attemptId);
    }

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
 * Poll resource state until enrichment_status changes from 'not_enriched',
 * then close the attempt. Handles the race where the edge function hasn't
 * finished writing back yet.
 */
async function closeAttemptWithRetry(
  resourceId: string,
  attemptId: string | null,
  maxRetries: number,
  delayMs: number,
) {
  if (!attemptId) return;

  for (let i = 0; i < maxRetries; i++) {
    const { data: resource } = await (supabase as any)
      .from('resources')
      .select('enrichment_status')
      .eq('id', resourceId)
      .single();

    // If the enrichment status has moved past 'not_enriched', the edge function is done
    if (resource && resource.enrichment_status !== 'not_enriched') {
      break;
    }
    // Wait before retrying
    await new Promise((r) => setTimeout(r, delayMs));
  }

  await closeAttemptFromResourceState(resourceId, attemptId);
}

/**
 * After enrichment completes, read the resource state and close the pending attempt.
 */
async function closeAttemptFromResourceState(resourceId: string, attemptId: string | null) {
  if (!attemptId) return;

  const { data: resource } = await (supabase as any)
    .from('resources')
    .select('enrichment_status, failure_reason, content_length, last_quality_score, platform_status, extraction_method, content')
    .eq('id', resourceId)
    .single();

  if (!resource) return;

  const contentLength = resource.content?.length ?? resource.content_length ?? 0;
  const isSuccess = resource.enrichment_status === 'deep_enriched' || resource.enrichment_status === 'enriched';
  const isPartial = contentLength > 0 && !isSuccess;

  const result = isSuccess ? 'success' : isPartial ? 'partial' : 'failed';

  // Determine what was found from platform_status and extraction_method
  const ps = (resource.platform_status || '') as string;
  const em = (resource.extraction_method || '') as string;

  await (supabase as any).from('enrichment_attempts').update({
    completed_at: new Date().toISOString(),
    result,
    failure_category: resource.failure_reason || ps || null,
    content_found: contentLength > 100,
    content_length_extracted: contentLength,
    quality_score_after: resource.last_quality_score ?? null,
    shell_rejected: ps.includes('shell_only') || ps.includes('shell'),
    runtime_config_found: ps.includes('runtime') || em.includes('runtime'),
    transcript_url_found: em.includes('transcript') || em.includes('caption'),
    media_url_found: em.includes('media') || em.includes('audio'),
    caption_url_found: em.includes('caption') || ps.includes('caption'),
    error_message: isSuccess ? null : (resource.failure_reason || null),
  }).eq('id', attemptId);

  // Update advanced_extraction_status based on result
  const advStatus = isSuccess ? 'completed' : 'failed';
  const recoveryStatus = isSuccess
    ? 'resolved_complete'
    : 'advanced_extraction_failed';

  await (supabase as any).from('resources').update({
    advanced_extraction_status: advStatus,
    recovery_status: recoveryStatus,
  }).eq('id', resourceId);
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

/**
 * Upload a file to the resource-files bucket and use its text content for enrichment.
 */
export async function uploadTranscriptFile(
  resourceId: string,
  userId: string,
  file: File,
): Promise<{ success: boolean; message: string }> {
  // Validate file
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB
  const ALLOWED_TYPES = ['text/plain', 'text/vtt', 'text/srt', 'application/json', 'text/csv', 'text/markdown', 'text/html'];
  const ALLOWED_EXTENSIONS = ['.txt', '.vtt', '.srt', '.json', '.csv', '.md', '.html', '.htm'];

  if (file.size > MAX_SIZE) {
    return { success: false, message: 'File too large — max 10MB' };
  }

  const ext = '.' + file.name.split('.').pop()?.toLowerCase();
  const isAllowedType = ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(ext);
  if (!isAllowedType) {
    return { success: false, message: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }

  try {
    // Read file text
    const text = await file.text();
    if (text.length < 50) {
      return { success: false, message: 'File content too short — minimum 50 characters' };
    }

    // Clean VTT/SRT if needed
    let cleanedText = text;
    if (ext === '.vtt' || ext === '.srt') {
      cleanedText = cleanTranscriptFormat(text);
    }

    // Upload file to storage
    const filePath = `transcripts/${resourceId}/${Date.now()}_${file.name}`;
    await supabase.storage.from('resource-files').upload(filePath, file, { upsert: true });

    // Update resource with extracted text
    await (supabase as any).from('resources').update({
      content: cleanedText,
      content_status: 'full',
      enrichment_status: 'not_enriched',
      failure_reason: null,
      failure_count: 0,
      content_length: cleanedText.length,
      manual_content_present: true,
      manual_input_required: false,
      recovery_status: 'pending_reprocess',
      resolution_method: 'transcript_upload',
      extraction_method: 'transcript_upload',
      last_status_change_at: new Date().toISOString(),
    }).eq('id', resourceId);

    // Record attempt
    await (supabase as any).from('enrichment_attempts').insert({
      resource_id: resourceId,
      user_id: userId,
      attempt_type: 'transcript_upload',
      strategy: `file_upload_${ext}`,
      result: 'success',
      content_found: true,
      content_length_extracted: cleanedText.length,
      completed_at: new Date().toISOString(),
      metadata: { filename: file.name, file_size: file.size, file_type: file.type, storage_path: filePath },
    });

    // Re-enrich
    await invokeEnrichResource(
      { resource_id: resourceId, force: true },
      { componentName: 'TranscriptUpload', timeoutMs: 90000 },
    );

    return { success: true, message: `Transcript uploaded (${cleanedText.length} chars) & re-enrichment triggered` };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

/**
 * Clean VTT/SRT transcript format into plain text.
 */
function cleanTranscriptFormat(text: string): string {
  return text
    .replace(/WEBVTT[\s\S]*?\n\n/, '') // Remove VTT header
    .replace(/\d+\n/g, '') // Remove sequence numbers (SRT)
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '') // Remove timestamps
    .replace(/<[^>]+>/g, '') // Remove HTML tags
    .replace(/\n{3,}/g, '\n\n') // Normalize whitespace
    .trim();
}

/**
 * Get platform-specific guidance for assisted resolution.
 */
export function getAssistedResolutionGuidance(platform: string | null, failureCategory: string | null): {
  steps: string[];
  tips: string[];
  preferredMethod: 'paste' | 'upload' | 'alt_url';
} {
  const base = {
    steps: ['Open the source URL in your browser', 'Copy the content', 'Paste it below or upload a file'],
    tips: ['Longer content produces better digests', 'Include the full text, not just a summary'],
    preferredMethod: 'paste' as const,
  };

  switch (platform) {
    case 'zoom':
      return {
        steps: [
          '1. Open the Zoom recording in your browser',
          '2. Click the "Transcript" tab (if available)',
          '3. Click "Download" → choose .vtt or .txt format',
          '4. Upload the downloaded transcript file below',
        ],
        tips: [
          'Most Zoom recordings have transcripts available via the Transcript tab',
          'VTT and SRT formats are automatically cleaned on upload',
          'If no transcript tab exists, try the Audio Transcript option in recording settings',
        ],
        preferredMethod: 'upload',
      };

    case 'thinkific':
      return {
        steps: [
          '1. Log into your Thinkific course',
          '2. Navigate to the lesson',
          '3. Select all text content (Ctrl+A / Cmd+A)',
          '4. Copy and paste below',
        ],
        tips: [
          'Include video transcripts if the lesson has embedded videos',
          'Capture any downloadable resources or PDFs',
        ],
        preferredMethod: 'paste',
      };

    case 'circle':
      return {
        steps: [
          '1. Log into Circle community',
          '2. Open the post/discussion',
          '3. Select and copy the post content',
          '4. Paste below',
        ],
        tips: [
          'Include the post title and author if not already captured',
          'Copy comments too if they contain valuable content',
        ],
        preferredMethod: 'paste',
      };

    case 'google_drive':
      return {
        steps: [
          '1. Open the file in Google Drive',
          '2. Try File → Download as → Plain Text or PDF',
          '3. Upload the downloaded file or paste the content',
        ],
        tips: [
          'If the file is a presentation, try downloading as PDF for best results',
          'For spreadsheets, download as CSV',
        ],
        preferredMethod: 'upload',
      };

    default:
      return base;
  }
}
