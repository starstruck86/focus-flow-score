/**
 * Google Drive URL Resolver
 * 
 * Detects Google Drive file URLs, extracts file IDs, and generates
 * direct-download URLs for enrichment pipeline use.
 */

export interface GoogleDriveResolution {
  originalUrl: string;
  normalizedViewerUrl: string;
  directDownloadUrl: string;
  fileId: string;
  canResolve: true;
}

export interface GoogleDriveResolutionFailure {
  originalUrl: string;
  canResolve: false;
  failureReason: string;
}

export type GoogleDriveResult = GoogleDriveResolution | GoogleDriveResolutionFailure;

// All known Google Drive URL patterns
const DRIVE_FILE_PATTERNS: Array<{ regex: RegExp; idGroup: number }> = [
  // https://drive.google.com/file/d/FILE_ID/view
  { regex: /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i, idGroup: 1 },
  // https://drive.google.com/open?id=FILE_ID
  { regex: /drive\.google\.com\/open\?.*id=([a-zA-Z0-9_-]+)/i, idGroup: 1 },
  // https://docs.google.com/uc?id=FILE_ID
  { regex: /docs\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/i, idGroup: 1 },
  // https://drive.google.com/uc?id=FILE_ID&export=download
  { regex: /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/i, idGroup: 1 },
];

/**
 * Check if a URL is a Google Drive file link (not Docs/Sheets/Slides).
 */
export function isGoogleDriveFileUrl(url: string): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Exclude Google Docs/Sheets/Slides — those have their own enrichment paths
  if (lower.includes('docs.google.com/document')) return false;
  if (lower.includes('docs.google.com/spreadsheets')) return false;
  if (lower.includes('docs.google.com/presentation')) return false;
  if (lower.includes('sheets.google.com')) return false;
  
  return DRIVE_FILE_PATTERNS.some(p => p.regex.test(url));
}

/**
 * Extract the file ID from a Google Drive URL.
 */
export function extractDriveFileId(url: string): string | null {
  for (const { regex, idGroup } of DRIVE_FILE_PATTERNS) {
    const match = url.match(regex);
    if (match && match[idGroup]) return match[idGroup];
  }
  return null;
}

/**
 * Generate the direct-download URL for a Google Drive file.
 */
export function buildDirectDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

/**
 * Build a normalized viewer URL for logging/display.
 */
export function buildViewerUrl(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * Full resolution: take any Drive URL, return resolution or failure.
 */
export function resolveGoogleDriveUrl(url: string): GoogleDriveResult {
  if (!url) {
    return { originalUrl: url, canResolve: false, failureReason: 'Empty URL' };
  }

  if (!isGoogleDriveFileUrl(url)) {
    return { originalUrl: url, canResolve: false, failureReason: 'Not a Google Drive file URL' };
  }

  const fileId = extractDriveFileId(url);
  if (!fileId) {
    return { originalUrl: url, canResolve: false, failureReason: 'Could not extract file ID from URL' };
  }

  return {
    originalUrl: url,
    normalizedViewerUrl: buildViewerUrl(fileId),
    directDownloadUrl: buildDirectDownloadUrl(fileId),
    fileId,
    canResolve: true,
  };
}
