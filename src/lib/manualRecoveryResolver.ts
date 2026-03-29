/**
 * Manual Recovery Resolver — single unified pipeline for all manual recovery actions.
 * Handles: paste transcript, paste content, upload file, replace URL, metadata-only.
 *
 * Every action flows through resolveResourceWithManualInput() which:
 * 1. Validates input
 * 2. Saves new content/input
 * 3. Clears stale blocker state
 * 4. Triggers re-enrichment
 * 5. Updates canonical state
 * 6. Records attempt provenance
 */

import { supabase } from '@/integrations/supabase/client';
import { invokeEnrichResource } from '@/lib/invokeEnrichResource';

// ── Types ────────────────────────────────────────────────

export type RecoveryMode =
  | 'paste_transcript'
  | 'paste_content'
  | 'upload_transcript'
  | 'upload_content'
  | 'alternate_url'
  | 'metadata_only';

export interface RecoveryInput {
  mode: RecoveryMode;
  resourceId: string;
  userId: string;
  /** Text content for paste modes */
  text?: string;
  /** File for upload modes */
  file?: File;
  /** URL for alternate_url mode */
  url?: string;
}

export interface RecoveryResult {
  success: boolean;
  message: string;
  contentLength?: number;
  attemptId?: string;
}

// ── Constants ────────────────────────────────────────────

const MIN_CONTENT_LENGTH = 50;
const ALLOWED_EXTENSIONS = ['.txt', '.vtt', '.srt', '.json', '.csv', '.md', '.html', '.htm'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// ── Main entry point ─────────────────────────────────────

export async function resolveResourceWithManualInput(input: RecoveryInput): Promise<RecoveryResult> {
  switch (input.mode) {
    case 'paste_transcript':
    case 'paste_content':
      return handlePaste(input);
    case 'upload_transcript':
    case 'upload_content':
      return handleFileUpload(input);
    case 'alternate_url':
      return handleAlternateUrl(input);
    case 'metadata_only':
      return handleMetadataOnly(input);
    default:
      return { success: false, message: 'Unknown recovery mode' };
  }
}

// ── Paste handler ────────────────────────────────────────

async function handlePaste(input: RecoveryInput): Promise<RecoveryResult> {
  const text = input.text?.trim();
  if (!text) return { success: false, message: 'Content is empty' };
  if (text.length < MIN_CONTENT_LENGTH) {
    return { success: false, message: `Content too short — minimum ${MIN_CONTENT_LENGTH} characters` };
  }

  const cleaned = normalizeText(text);
  const isTranscript = input.mode === 'paste_transcript';
  const method = isTranscript ? 'manual_transcript_paste' : 'manual_paste';

  try {
    // 1. Save content + clear blockers
    await updateResourceWithContent(input.resourceId, cleaned, method);

    // 2. Record provenance
    const attemptId = await recordAttempt(input.resourceId, input.userId, {
      attemptType: method,
      strategy: 'manual_paste',
      result: 'success',
      contentFound: true,
      contentLength: cleaned.length,
    });

    // 3. Trigger re-enrichment
    await triggerReEnrichment(input.resourceId);

    return {
      success: true,
      message: `${isTranscript ? 'Transcript' : 'Content'} saved (${cleaned.length} chars) & re-enrichment started`,
      contentLength: cleaned.length,
      attemptId,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── File upload handler ──────────────────────────────────

async function handleFileUpload(input: RecoveryInput): Promise<RecoveryResult> {
  const file = input.file;
  if (!file) return { success: false, message: 'No file provided' };
  if (file.size > MAX_FILE_SIZE) return { success: false, message: 'File too large — max 10MB' };

  const ext = '.' + (file.name.split('.').pop()?.toLowerCase() || '');
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { success: false, message: `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` };
  }

  try {
    const rawText = await file.text();
    if (rawText.length < MIN_CONTENT_LENGTH) {
      return { success: false, message: 'File content too short — minimum 50 characters of usable text' };
    }

    // Clean transcript formats
    let cleaned = rawText;
    if (ext === '.vtt' || ext === '.srt') {
      cleaned = cleanTranscriptFormat(rawText);
    } else {
      cleaned = normalizeText(rawText);
    }

    if (cleaned.length < MIN_CONTENT_LENGTH) {
      return { success: false, message: 'Transcript file contained no usable text after cleaning' };
    }

    const isTranscript = input.mode === 'upload_transcript' || ext === '.vtt' || ext === '.srt';
    const method = isTranscript ? 'transcript_upload' : 'content_upload';

    // Upload file to storage
    const filePath = `transcripts/${input.resourceId}/${Date.now()}_${file.name}`;
    await supabase.storage.from('resource-files').upload(filePath, file, { upsert: true });

    // Save content + clear blockers
    await updateResourceWithContent(input.resourceId, cleaned, method);

    // Record provenance
    const attemptId = await recordAttempt(input.resourceId, input.userId, {
      attemptType: method,
      strategy: `file_upload_${ext}`,
      result: 'success',
      contentFound: true,
      contentLength: cleaned.length,
      metadata: { filename: file.name, file_size: file.size, file_type: file.type, storage_path: filePath },
    });

    // Trigger re-enrichment
    await triggerReEnrichment(input.resourceId);

    return {
      success: true,
      message: `File uploaded (${cleaned.length} chars) & re-enrichment started`,
      contentLength: cleaned.length,
      attemptId,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Alternate URL handler ────────────────────────────────

async function handleAlternateUrl(input: RecoveryInput): Promise<RecoveryResult> {
  const url = input.url?.trim();
  if (!url) return { success: false, message: 'URL is empty' };
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return { success: false, message: 'URL must start with http:// or https://' };
  }

  try {
    // Update URL + clear blockers
    await (supabase as any).from('resources').update({
      file_url: url,
      enrichment_status: 'not_enriched',
      failure_reason: null,
      failure_count: 0,
      content_status: 'placeholder',
      manual_input_required: false,
      recovery_status: 'pending_retry',
      recovery_reason: null,
      next_best_action: null,
      last_recovery_error: null,
      platform_status: null,
      recovery_queue_bucket: null,
      advanced_extraction_status: null,
      resolution_method: 'alternate_url',
      extraction_method: null,
      last_status_change_at: new Date().toISOString(),
    }).eq('id', input.resourceId);

    // Record provenance
    const attemptId = await recordAttempt(input.resourceId, input.userId, {
      attemptType: 'alternate_url',
      strategy: 'url_replacement',
      result: 'pending',
      metadata: { new_url: url },
    });

    // Trigger re-enrichment
    await triggerReEnrichment(input.resourceId);

    return {
      success: true,
      message: 'Alternate URL saved & re-enrichment started',
      attemptId,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Metadata-only handler ────────────────────────────────

async function handleMetadataOnly(input: RecoveryInput): Promise<RecoveryResult> {
  try {
    await (supabase as any).from('resources').update({
      enrichment_status: 'deep_enriched',
      failure_reason: null,
      failure_count: 0,
      last_quality_tier: 'metadata_only',
      last_status_change_at: new Date().toISOString(),
      enriched_at: new Date().toISOString(),
      recovery_status: 'resolved_metadata_only',
      recovery_reason: 'Intentionally accepted as metadata-only',
      recovery_queue_bucket: null,
      resolution_method: 'metadata_only',
      extraction_method: 'metadata_only',
      manual_input_required: false,
      next_best_action: null,
      last_recovery_error: null,
      platform_status: null,
    }).eq('id', input.resourceId);

    const attemptId = await recordAttempt(input.resourceId, input.userId, {
      attemptType: 'metadata_only',
      strategy: 'metadata_only_close',
      result: 'success',
    });

    return {
      success: true,
      message: 'Marked as metadata-only — resource resolved',
      attemptId,
    };
  } catch (e: any) {
    return { success: false, message: e.message };
  }
}

// ── Shared helpers ───────────────────────────────────────

/**
 * Core content save + blocker clear.
 * This is the single place where manual content is persisted and stale blockers are removed.
 */
async function updateResourceWithContent(
  resourceId: string,
  content: string,
  method: string,
) {
  await (supabase as any).from('resources').update({
    // Save content
    content,
    content_status: 'full',
    content_length: content.length,
    manual_content_present: true,
    resolution_method: method,
    extraction_method: method,
    // Clear stale blockers
    enrichment_status: 'not_enriched',
    failure_reason: null,
    failure_count: 0,
    manual_input_required: false,
    recovery_status: 'pending_reprocess',
    recovery_reason: null,
    next_best_action: null,
    last_recovery_error: null,
    platform_status: null,
    recovery_queue_bucket: null,
    // Timestamp
    last_status_change_at: new Date().toISOString(),
  }).eq('id', resourceId);
}

/**
 * Record a provenance row in enrichment_attempts.
 */
async function recordAttempt(
  resourceId: string,
  userId: string,
  details: {
    attemptType: string;
    strategy: string;
    result: string;
    contentFound?: boolean;
    contentLength?: number;
    metadata?: Record<string, unknown>;
  },
): Promise<string | undefined> {
  const now = new Date().toISOString();
  const { data } = await (supabase as any).from('enrichment_attempts').insert({
    resource_id: resourceId,
    user_id: userId,
    attempt_type: details.attemptType,
    strategy: details.strategy,
    result: details.result,
    content_found: details.contentFound ?? false,
    content_length_extracted: details.contentLength ?? 0,
    started_at: now,
    completed_at: details.result !== 'pending' ? now : null,
    metadata: details.metadata ?? null,
  }).select('id').single();
  return data?.id;
}

/**
 * Trigger re-enrichment with force flag.
 */
async function triggerReEnrichment(resourceId: string) {
  await invokeEnrichResource(
    { resource_id: resourceId, force: true },
    { componentName: 'ManualRecoveryResolver', timeoutMs: 90000 },
  );
}

// ── Text cleaning ────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function cleanTranscriptFormat(text: string): string {
  return text
    .replace(/WEBVTT[\s\S]*?\n\n/, '')
    .replace(/\d+\n/g, '')
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}[.,]\d{3}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

// ── Query key invalidation helper ────────────────────────

/**
 * Invalidate all relevant query keys after a manual recovery action.
 * Call this from components after resolveResourceWithManualInput() succeeds.
 */
export function getRecoveryInvalidationKeys(): string[][] {
  return [
    ['resources'],
    ['incoming-queue'],
    ['all-resources'],
    ['resource-folders'],
    ['enrichment-status'],
    ['recovery-queue'],
    ['verification-runs'],
  ];
}
