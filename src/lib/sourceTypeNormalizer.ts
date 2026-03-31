/**
 * Canonical source type enum for batch processing.
 * Maps all resource types / URLs to a stable enum used by the extraction dispatcher.
 */

export type CanonicalSourceType =
  | 'youtube'
  | 'zoom'
  | 'thinkific'
  | 'pdf'
  | 'webpage'
  | 'document'
  | 'audio'
  | 'video'
  | 'unknown';

const URL_PATTERNS: Array<[RegExp, CanonicalSourceType]> = [
  [/youtube\.com|youtu\.be/i, 'youtube'],
  [/zoom\.(us|com)/i, 'zoom'],
  [/thinkific\.com/i, 'thinkific'],
  [/\.pdf(\?|$)/i, 'pdf'],
  [/\.(mp3|wav|ogg|m4a|aac|flac)(\?|$)/i, 'audio'],
  [/\.(mp4|mov|webm|avi|mkv)(\?|$)/i, 'video'],
  [/\.(doc|docx|txt|rtf|md|csv|xlsx)(\?|$)/i, 'document'],
];

const TYPE_MAP: Record<string, CanonicalSourceType> = {
  youtube: 'youtube',
  youtube_video: 'youtube',
  zoom: 'zoom',
  zoom_recording: 'zoom',
  thinkific: 'thinkific',
  thinkific_course: 'thinkific',
  pdf: 'pdf',
  document: 'document',
  note: 'document',
  article: 'webpage',
  web_page: 'webpage',
  webpage: 'webpage',
  blog_post: 'webpage',
  competitor_page: 'webpage',
  audio: 'audio',
  podcast: 'audio',
  podcast_episode: 'audio',
  video: 'video',
  recording: 'video',
};

export function normalizeSourceType(
  resourceType?: string | null,
  fileUrl?: string | null,
): CanonicalSourceType {
  // Try resource type field first
  if (resourceType) {
    const key = resourceType.toLowerCase().trim();
    if (TYPE_MAP[key]) return TYPE_MAP[key];
  }

  // Try URL pattern matching
  if (fileUrl) {
    for (const [pattern, type] of URL_PATTERNS) {
      if (pattern.test(fileUrl)) return type;
    }
    // Has a URL but no match → webpage
    if (fileUrl.startsWith('http')) return 'webpage';
  }

  return 'unknown';
}
