/**
 * Canonical Failure Routing Layer
 *
 * Every failed enrich item maps to EXACTLY ONE failure bucket.
 * Each bucket defines: reason, next action, recovery path, and ProcessingState mapping.
 */
import { detectResourceSubtype, classifyEnrichability, type ResourceSubtype } from '@/lib/salesBrain/resourceSubtype';
import type { FailureCategory } from '@/store/useEnrichmentJobStore';

// ── Failure Buckets ────────────────────────────────────────
export type FailureBucket =
  | 'retryable_extraction_failure'
  | 'audio_resolution_required'
  | 'transcript_required'
  | 'auth_required'
  | 'manual_content_required'
  | 'unsupported_source'
  | 'metadata_only_salvageable';

export interface FailureRouting {
  bucket: FailureBucket;
  reason: string;
  nextAction: string;
  /** Maps to ProcessingState for library display */
  processingState: 'RETRYABLE_FAILURE' | 'MANUAL_REQUIRED' | 'METADATA_ONLY';
  /** Row action to show in library */
  rowAction: 'retry_extraction' | 'retry_resolution' | 'retry_transcription' | 'manual_assist' | 'mark_metadata_only' | 'inspect_audio';
  retryable: boolean;
}

// ── Bucket definitions ─────────────────────────────────────
const BUCKET_DEFINITIONS: Record<FailureBucket, Omit<FailureRouting, 'reason'>> = {
  retryable_extraction_failure: {
    bucket: 'retryable_extraction_failure',
    nextAction: 'Retry extraction',
    processingState: 'RETRYABLE_FAILURE',
    rowAction: 'retry_extraction',
    retryable: true,
  },
  audio_resolution_required: {
    bucket: 'audio_resolution_required',
    nextAction: 'Retry audio resolution or provide direct audio URL',
    processingState: 'MANUAL_REQUIRED',
    rowAction: 'inspect_audio',
    retryable: false,
  },
  transcript_required: {
    bucket: 'transcript_required',
    nextAction: 'Paste transcript or provide alternate episode source',
    processingState: 'MANUAL_REQUIRED',
    rowAction: 'manual_assist',
    retryable: false,
  },
  auth_required: {
    bucket: 'auth_required',
    nextAction: 'Provide access or upload file content',
    processingState: 'MANUAL_REQUIRED',
    rowAction: 'manual_assist',
    retryable: false,
  },
  manual_content_required: {
    bucket: 'manual_content_required',
    nextAction: 'Paste content manually via Manual Assist',
    processingState: 'MANUAL_REQUIRED',
    rowAction: 'manual_assist',
    retryable: false,
  },
  unsupported_source: {
    bucket: 'unsupported_source',
    nextAction: 'Convert to supported format or paste content',
    processingState: 'MANUAL_REQUIRED',
    rowAction: 'manual_assist',
    retryable: false,
  },
  metadata_only_salvageable: {
    bucket: 'metadata_only_salvageable',
    nextAction: 'Mark as metadata-only or paste transcript via Manual Assist',
    processingState: 'METADATA_ONLY',
    rowAction: 'manual_assist',
    retryable: false,
  },
};

// ── Source-specific reason templates ───────────────────────
const SOURCE_REASONS: Record<string, Record<FailureBucket, string>> = {
  spotify_episode: {
    retryable_extraction_failure: 'Spotify metadata extraction failed.',
    audio_resolution_required: 'Spotify does not provide direct audio access.',
    transcript_required: 'No direct audio access from Spotify. Paste transcript or provide alternate episode source.',
    auth_required: 'Spotify requires authentication for this content.',
    manual_content_required: 'Spotify episode requires manual transcript input.',
    unsupported_source: 'Spotify episode format not supported for direct extraction.',
    metadata_only_salvageable: 'Spotify — metadata captured. Paste transcript or provide alternate URL.',
  },
  apple_podcast_episode: {
    retryable_extraction_failure: 'Apple Podcast extraction failed — retry may resolve.',
    audio_resolution_required: 'RSS feed resolved but no matching audio enclosure found. Retry resolution or provide direct audio URL.',
    transcript_required: 'Apple Podcast audio could not be resolved. Paste transcript or provide direct audio URL.',
    auth_required: 'Apple Podcast requires authentication for this episode.',
    manual_content_required: 'Apple Podcast episode requires manual transcript input.',
    unsupported_source: 'Apple Podcast format not supported.',
    metadata_only_salvageable: 'Apple Podcast — metadata captured. Provide direct audio URL or paste transcript.',
  },
  audio_file: {
    retryable_extraction_failure: 'Audio transcription failed — retry with extended timeout.',
    audio_resolution_required: 'Audio file could not be downloaded for transcription.',
    transcript_required: 'Audio file could not be transcribed. Paste transcript manually.',
    auth_required: 'Audio file requires authentication to access.',
    manual_content_required: 'Audio file transcription exhausted. Paste transcript via Manual Assist.',
    unsupported_source: 'Audio format not supported for transcription.',
    metadata_only_salvageable: 'Audio file — metadata captured. Paste transcript for full enrichment.',
  },
  google_doc: {
    retryable_extraction_failure: 'Google Doc extraction failed — retry enrichment.',
    audio_resolution_required: 'Google Doc does not have audio content.',
    transcript_required: 'Google Doc extraction failed. Retry or paste content.',
    auth_required: 'Google Doc requires sharing permissions.',
    manual_content_required: 'Google Doc could not be accessed. Paste content via Manual Assist.',
    unsupported_source: 'Google Doc format not recognized.',
    metadata_only_salvageable: 'Google Doc — metadata only. Retry or paste content.',
  },
  google_drive_file: {
    retryable_extraction_failure: 'Google Drive file extraction failed.',
    audio_resolution_required: 'Google Drive file is not audio.',
    transcript_required: 'Google Drive file needs manual download.',
    auth_required: 'Google Drive file — requires access or direct download link.',
    manual_content_required: 'Google Drive file — upload the file or paste content.',
    unsupported_source: 'Google Drive file format not supported.',
    metadata_only_salvageable: 'Google Drive — metadata captured. Upload file or paste content.',
  },
  auth_gated_community_page: {
    retryable_extraction_failure: 'Auth-gated page extraction failed.',
    audio_resolution_required: 'Auth-gated page does not have audio.',
    transcript_required: 'Auth-gated page cannot be auto-transcribed.',
    auth_required: 'Login required. Paste content manually via Manual Assist.',
    manual_content_required: 'Login required. Paste content manually via Manual Assist.',
    unsupported_source: 'Auth-gated page cannot be crawled.',
    metadata_only_salvageable: 'Auth-gated — metadata only. Paste content for full enrichment.',
  },
  zoom_recording: {
    retryable_extraction_failure: 'Zoom recording extraction failed.',
    audio_resolution_required: 'Zoom recording requires direct download.',
    transcript_required: 'Zoom recording — download transcript from Zoom and paste via Manual Assist.',
    auth_required: 'Zoom recording requires authentication.',
    manual_content_required: 'Zoom recording — download transcript from Zoom and paste via Manual Assist.',
    unsupported_source: 'Zoom recording format not directly supported.',
    metadata_only_salvageable: 'Zoom — metadata captured. Download and paste transcript.',
  },
  web_article: {
    retryable_extraction_failure: 'Extractor returned insufficient usable text after valid fetch.',
    audio_resolution_required: 'Web article does not have audio content.',
    transcript_required: 'Web article needs manual content input.',
    auth_required: 'Web article requires authentication to access.',
    manual_content_required: 'Web article content could not be extracted. Paste content via Manual Assist.',
    unsupported_source: 'Web article format not supported.',
    metadata_only_salvageable: 'Web article — metadata captured. Paste content for full enrichment.',
  },
};

// ── Routing logic ──────────────────────────────────────────

/**
 * Route a failed enrichment item to its canonical failure bucket.
 * Uses subtype + failure category + error message to determine the correct bucket.
 */
export function routeFailure(
  url: string | null | undefined,
  resourceType: string | undefined,
  failureCategory: FailureCategory | undefined,
  errorMessage: string | undefined,
  finalStatus?: string,
): FailureRouting {
  const subtype = detectResourceSubtype(url ?? null, resourceType);
  const bucket = determineBucket(subtype, failureCategory, errorMessage, finalStatus);
  const reason = getSourceSpecificReason(subtype, bucket, errorMessage);

  return {
    ...BUCKET_DEFINITIONS[bucket],
    reason,
  };
}

function determineBucket(
  subtype: ResourceSubtype,
  failureCategory: FailureCategory | undefined,
  errorMessage: string | undefined,
  finalStatus?: string,
): FailureBucket {
  // Source-type-first routing
  switch (subtype) {
    case 'spotify_episode':
      // Spotify can never provide direct audio — always transcript_required or metadata_only
      if (failureCategory === 'failed_quality' || finalStatus === 'partial') {
        return 'metadata_only_salvageable';
      }
      return 'transcript_required';

    case 'apple_podcast_episode':
      // Apple needs RSS resolution first
      if (failureCategory === 'failed_network_transport' || failureCategory === 'failed_timeout') {
        return 'retryable_extraction_failure';
      }
      if (errorMessage?.toLowerCase().includes('enclosure') || errorMessage?.toLowerCase().includes('rss')) {
        return 'audio_resolution_required';
      }
      if (failureCategory === 'failed_quality') {
        return 'audio_resolution_required';
      }
      return 'audio_resolution_required';

    case 'audio_file':
    case 'podcast_episode':
      if (failureCategory === 'failed_network_transport' || failureCategory === 'failed_timeout' || failureCategory === 'failed_request') {
        return 'retryable_extraction_failure';
      }
      if (failureCategory === 'failed_needs_auth') {
        return 'auth_required';
      }
      if (failureCategory === 'failed_quality') {
        return 'transcript_required';
      }
      return 'retryable_extraction_failure';

    case 'google_drive_file':
      return 'auth_required';

    case 'google_doc':
      if (failureCategory === 'failed_needs_auth') return 'auth_required';
      return 'retryable_extraction_failure';

    case 'auth_gated_community_page':
      return 'manual_content_required';

    case 'zoom_recording':
      return 'transcript_required';

    default:
      break;
  }

  // Failure-category-based routing for generic sources
  if (failureCategory) {
    switch (failureCategory) {
      case 'failed_needs_auth':
      case 'failed_missing_auth':
        return 'auth_required';
      case 'failed_unsupported':
        return 'unsupported_source';
      case 'failed_quality':
        // Weak content after correct extraction
        return 'retryable_extraction_failure';
      case 'failed_network_transport':
      case 'failed_edge_unreachable':
      case 'failed_timeout':
      case 'failed_request':
      case 'failed_request_serialization':
      case 'failed_unknown_transport':
        return 'retryable_extraction_failure';
      case 'failed_preflight':
      case 'failed_preflight_blocked':
        return 'retryable_extraction_failure';
      case 'failed_request_too_large':
        return 'retryable_extraction_failure';
      case 'failed_verification':
      case 'failed_write':
        return 'retryable_extraction_failure';
      case 'failed_bad_route':
        return 'unsupported_source';
      case 'failed_unknown':
      default:
        return 'retryable_extraction_failure';
    }
  }

  return 'retryable_extraction_failure';
}

function getSourceSpecificReason(
  subtype: ResourceSubtype,
  bucket: FailureBucket,
  errorMessage?: string,
): string {
  // Look up source-specific reason
  const sourceReasons = SOURCE_REASONS[subtype];
  if (sourceReasons?.[bucket]) {
    return sourceReasons[bucket];
  }

  // For subtypes without specific templates, use the error message with bucket context
  const bucketDef = BUCKET_DEFINITIONS[bucket];
  if (errorMessage && !isGenericError(errorMessage)) {
    return errorMessage;
  }

  // Fallback reason per bucket
  switch (bucket) {
    case 'retryable_extraction_failure':
      return 'Extraction failed — retry may resolve the issue.';
    case 'audio_resolution_required':
      return 'Audio source could not be resolved. Provide direct audio URL.';
    case 'transcript_required':
      return 'Transcript not available. Paste transcript or provide alternate source.';
    case 'auth_required':
      return 'Authentication required to access this content.';
    case 'manual_content_required':
      return 'Automatic extraction exhausted. Paste content via Manual Assist.';
    case 'unsupported_source':
      return 'Source type not supported for automatic enrichment.';
    case 'metadata_only_salvageable':
      return 'Only metadata could be captured. Provide content for full enrichment.';
  }
}

function isGenericError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower === 'unknown error' ||
    lower === 'enrichment failed' ||
    lower.includes('content too weak') ||
    lower.includes('paste content manually') ||
    lower.includes('try a different url')
  );
}

/**
 * Get the row actions that should appear for a failed item based on its failure bucket.
 */
export function getFailureBucketActions(bucket: FailureBucket): Array<{
  action: string;
  label: string;
  icon: 'retry' | 'manual_assist' | 'inspect_audio' | 'mark_metadata';
}> {
  switch (bucket) {
    case 'retryable_extraction_failure':
      return [
        { action: 'deep_enrich', label: 'Retry Extraction', icon: 'retry' },
        { action: 'manual_assist', label: 'Manual Assist', icon: 'manual_assist' },
      ];
    case 'audio_resolution_required':
      return [
        { action: 'inspect_audio', label: 'Inspect Audio', icon: 'inspect_audio' },
        { action: 'deep_enrich', label: 'Retry Resolution', icon: 'retry' },
        { action: 'manual_assist', label: 'Manual Assist', icon: 'manual_assist' },
      ];
    case 'transcript_required':
      return [
        { action: 'manual_assist', label: 'Paste Transcript', icon: 'manual_assist' },
        { action: 'inspect_audio', label: 'Inspect Audio', icon: 'inspect_audio' },
      ];
    case 'auth_required':
      return [
        { action: 'manual_assist', label: 'Provide Access / Paste Content', icon: 'manual_assist' },
      ];
    case 'manual_content_required':
      return [
        { action: 'manual_assist', label: 'Paste Content', icon: 'manual_assist' },
      ];
    case 'unsupported_source':
      return [
        { action: 'manual_assist', label: 'Convert & Paste Content', icon: 'manual_assist' },
      ];
    case 'metadata_only_salvageable':
      return [
        { action: 'manual_assist', label: 'Provide Content', icon: 'manual_assist' },
        { action: 'mark_metadata_only', label: 'Accept Metadata Only', icon: 'mark_metadata' },
      ];
  }
}
