/**
 * Resource Subtype Detection & Enrichability Classification
 *
 * SINGLE SOURCE OF TRUTH for what a resource IS and how it can be enriched.
 * All UI + enrichment routing MUST use these selectors.
 */

// ── Subtypes ───────────────────────────────────────────────
export const RESOURCE_SUBTYPES = [
  'youtube_video',
  'google_doc',
  'google_sheet',
  'google_drive_file',
  'zoom_recording',
  'spotify_episode',
  'apple_podcast_episode',
  'podcast_episode',
  'audio_file',
  'web_article',
  'pdf',
  'manual_note',
  'competitor_page',
  'auth_gated_community_page',
  'unknown_url',
  'no_url',
] as const;

export type ResourceSubtype = typeof RESOURCE_SUBTYPES[number];

// ── Enrichability ──────────────────────────────────────────
export type EnrichabilityState =
  | 'fully_enrichable'
  | 'partially_enrichable'
  | 'metadata_only'
  | 'manual_input_needed'
  | 'unsupported'
  | 'needs_auth'
  | 'no_source';

export interface EnrichabilityResult {
  subtype: ResourceSubtype;
  enrichability: EnrichabilityState;
  reason: string;
  canFetchText: boolean;
  canFetchTranscript: boolean;
  canFetchMetadata: boolean;
  requiresAuth: boolean;
  isDynamic: boolean;
}

// ── Auth-gated domains ─────────────────────────────────────
const AUTH_GATED_DOMAINS = [
  'teachable.com', 'thinkific.com', 'kajabi.com',
  'podia.com', 'skool.com', 'mighty.co', 'patreon.com',
  'memberstack.com', 'memberships.io',
];

// ── Detection ──────────────────────────────────────────────
export function detectResourceSubtype(url: string | null, resourceType?: string): ResourceSubtype {
  if (!url) return 'no_url';

  const lower = url.toLowerCase();

  // YouTube
  if (lower.includes('youtube.com/watch') || lower.includes('youtu.be/') || lower.includes('youtube.com/embed')) {
    return 'youtube_video';
  }

  // Google Docs / Drive
  if (lower.includes('docs.google.com/document')) return 'google_doc';
  if (lower.includes('docs.google.com/spreadsheets') || lower.includes('sheets.google.com')) return 'google_sheet';
  if (lower.includes('drive.google.com/file/')) return 'google_drive_file';

  // Auth-gated community pages
  if (/\.circle\.so\b/i.test(lower)) return 'auth_gated_community_page';

  // Zoom
  if (lower.includes('zoom.us/rec') || lower.includes('zoom.us/share')) return 'zoom_recording';

  // Spotify
  if (lower.includes('open.spotify.com/episode') || lower.includes('open.spotify.com/show')) return 'spotify_episode';

  // Audio files
  if (/\.(mp3|m4a|wav|ogg|aac|flac)(\?|$)/i.test(lower)) return 'audio_file';

  // PDF
  if (/\.pdf(\?|$)/i.test(lower)) return 'pdf';

  // Podcast RSS
  if (resourceType === 'podcast_episode') return 'podcast_episode';

  // Known competitor page
  if (resourceType === 'competitor_page') return 'competitor_page';

  // Fallback: any HTTP → web article
  if (lower.startsWith('http')) return 'web_article';

  return 'unknown_url';
}

export function classifyEnrichability(url: string | null, resourceType?: string): EnrichabilityResult {
  const subtype = detectResourceSubtype(url, resourceType);

  const base: Omit<EnrichabilityResult, 'enrichability' | 'reason'> = {
    subtype,
    canFetchText: false,
    canFetchTranscript: false,
    canFetchMetadata: false,
    requiresAuth: false,
    isDynamic: false,
  };

  // Check auth-gated
  if (url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (AUTH_GATED_DOMAINS.some(d => host.includes(d))) {
        return {
          ...base,
          enrichability: 'needs_auth',
          reason: `${host} requires authentication`,
          requiresAuth: true,
          canFetchMetadata: true,
        };
      }
    } catch { /* not a valid URL */ }
  }

  switch (subtype) {
    case 'youtube_video':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'YouTube — transcript + metadata available',
        canFetchText: true,
        canFetchTranscript: true,
        canFetchMetadata: true,
      };

    case 'google_doc':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'Google Doc — full text extraction supported',
        canFetchText: true,
        canFetchMetadata: true,
      };

    case 'google_sheet':
      return {
        ...base,
        enrichability: 'partially_enrichable',
        reason: 'Google Sheet — table extraction, partial enrichment',
        canFetchText: true,
        canFetchMetadata: true,
      };

    case 'google_drive_file':
      return {
        ...base,
        enrichability: 'needs_auth',
        reason: 'Google Drive file — may require auth or direct download link',
        canFetchMetadata: true,
        requiresAuth: true,
      };

    case 'auth_gated_community_page':
      return {
        ...base,
        enrichability: 'manual_input_needed',
        reason: 'Auth-gated community page — requires login, paste content manually',
        requiresAuth: true,
        canFetchMetadata: false,
      };

    case 'zoom_recording':
      return {
        ...base,
        enrichability: 'manual_input_needed',
        reason: 'Zoom recording — transcript may require manual download',
        canFetchMetadata: true,
        requiresAuth: true,
        isDynamic: true,
      };

    case 'spotify_episode':
      return {
        ...base,
        enrichability: 'metadata_only',
        reason: 'Spotify — metadata available, transcript requires external source',
        canFetchMetadata: true,
      };

    case 'audio_file':
      return {
        ...base,
        enrichability: 'partially_enrichable',
        reason: 'Audio file — dedicated audio transcription pipeline available',
        canFetchMetadata: true,
        canFetchTranscript: true,
      };

    case 'podcast_episode':
      return {
        ...base,
        enrichability: 'partially_enrichable',
        reason: 'Podcast — metadata + transcript attempt',
        canFetchMetadata: true,
        canFetchTranscript: true,
      };

    case 'pdf':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'PDF — text extraction supported',
        canFetchText: true,
        canFetchMetadata: true,
      };

    case 'web_article':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'Web article — standard fetch + extraction',
        canFetchText: true,
        canFetchMetadata: true,
      };

    case 'competitor_page':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'Competitor page — web extraction supported',
        canFetchText: true,
        canFetchMetadata: true,
      };

    case 'manual_note':
      return {
        ...base,
        enrichability: 'fully_enrichable',
        reason: 'Manual note — content already present',
        canFetchText: true,
      };

    case 'no_url':
      return {
        ...base,
        enrichability: 'no_source',
        reason: 'No URL — cannot enrich without a source',
      };

    default:
      return {
        ...base,
        enrichability: 'unsupported',
        reason: 'Unknown resource type',
      };
  }
}

// ── UI helpers ─────────────────────────────────────────────
export function getSubtypeLabel(subtype: ResourceSubtype): string {
  const labels: Record<ResourceSubtype, string> = {
    youtube_video: 'YouTube Video',
    google_doc: 'Google Doc',
    google_sheet: 'Google Sheet',
    google_drive_file: 'Google Drive File',
    zoom_recording: 'Zoom Recording',
    spotify_episode: 'Spotify Episode',
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
  return labels[subtype] || subtype;
}

export function getEnrichabilityLabel(state: EnrichabilityState): string {
  const labels: Record<EnrichabilityState, string> = {
    fully_enrichable: 'Fully Enrichable',
    partially_enrichable: 'Partial Only',
    metadata_only: 'Metadata Only',
    manual_input_needed: 'Manual Input Needed',
    unsupported: 'Unsupported',
    needs_auth: 'Needs Auth',
    no_source: 'No Source',
  };
  return labels[state] || state;
}

export function getEnrichabilityColor(state: EnrichabilityState): string {
  switch (state) {
    case 'fully_enrichable': return 'bg-status-green/20 text-status-green';
    case 'partially_enrichable': return 'bg-status-yellow/20 text-status-yellow';
    case 'metadata_only': return 'bg-orange-500/20 text-orange-600';
    case 'manual_input_needed': return 'bg-primary/20 text-primary';
    case 'unsupported': return 'bg-muted text-muted-foreground';
    case 'needs_auth': return 'bg-status-red/20 text-status-red';
    case 'no_source': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}

/**
 * Get per-resource enrichment eligibility reason for batch modal display.
 */
export function getEnrichModalReason(url: string | null, resourceType?: string): string {
  const result = classifyEnrichability(url, resourceType);
  if (result.enrichability === 'fully_enrichable') return `${getSubtypeLabel(result.subtype)} — eligible`;
  if (result.enrichability === 'partially_enrichable') return `${getSubtypeLabel(result.subtype)} — partial enrichment only`;
  if (result.enrichability === 'metadata_only') return `${getSubtypeLabel(result.subtype)} — metadata only`;
  if (result.enrichability === 'manual_input_needed') return `${getSubtypeLabel(result.subtype)} — needs manual input`;
  if (result.enrichability === 'needs_auth') return `${getSubtypeLabel(result.subtype)} — requires authentication`;
  if (result.enrichability === 'unsupported') return `${getSubtypeLabel(result.subtype)} — unsupported`;
  if (result.enrichability === 'no_source') return 'No URL — cannot enrich';
  return result.reason;
}
