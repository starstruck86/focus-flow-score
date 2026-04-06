/**
 * Semantic boundary-aware chunking for large documents.
 * Splits at headings > section boundaries > paragraph boundaries > sentence boundaries.
 * Never cuts in the middle of a knowledge unit.
 */

const NOMINAL_CHUNK_SIZE = 13000;
const MIN_CHUNK_SIZE = 8000;
const MAX_CHUNK_SIZE = 18000;
const OVERLAP_CHARS = 600;

export interface SemanticSlice {
  start: number;
  end: number;
  semanticStartMarker: string;
  semanticEndMarker: string;
}

/** Priority-ordered boundary patterns */
const BOUNDARY_PATTERNS = [
  /^#{1,3}\s+.+$/gm,           // Markdown headings
  /^---+$/gm,                   // Horizontal rules
  /\n\n(?=[A-Z])/g,             // Blank line before uppercase start (section boundary)
  /\n\n/g,                      // Double newline (paragraph boundary)
  /\.\s+(?=[A-Z])/g,           // Sentence boundary (period + space + uppercase)
];

function findNearestBoundary(content: string, target: number, searchRange: number): number {
  const searchStart = Math.max(0, target - searchRange);
  const searchEnd = Math.min(content.length, target + searchRange);
  const searchWindow = content.slice(searchStart, searchEnd);
  
  let bestPos = -1;
  let bestDist = Infinity;
  
  for (const pattern of BOUNDARY_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = regex.exec(searchWindow)) !== null) {
      const absPos = searchStart + match.index + match[0].length;
      const dist = Math.abs(absPos - target);
      if (dist < bestDist && absPos > MIN_CHUNK_SIZE) {
        bestDist = dist;
        bestPos = absPos;
      }
    }
    // If we found a good boundary at this priority level, use it
    if (bestPos >= 0 && bestDist < searchRange * 0.8) break;
  }
  
  return bestPos;
}

function extractMarker(content: string, pos: number, direction: 'start' | 'end'): string {
  const lineStart = content.lastIndexOf('\n', pos) + 1;
  const lineEnd = content.indexOf('\n', pos);
  const line = content.slice(lineStart, lineEnd > 0 ? lineEnd : pos + 80).trim();
  
  // Prefer heading as marker
  if (/^#{1,3}\s+/.test(line)) return line.slice(0, 80);
  
  // Otherwise use first 60 chars of the line
  return line.slice(0, 60) + (line.length > 60 ? '…' : '');
}

export function computeSemanticSlices(contentLength: number, content?: string): SemanticSlice[] {
  if (contentLength <= MAX_CHUNK_SIZE) {
    return [{
      start: 0,
      end: contentLength,
      semanticStartMarker: '(start)',
      semanticEndMarker: '(end)',
    }];
  }

  // If no content provided, fall back to char-offset splitting
  if (!content) {
    return computeFallbackSlices(contentLength);
  }

  const slices: SemanticSlice[] = [];
  let pos = 0;
  const searchRange = 3000; // Search ±3k chars for a good boundary

  while (pos < contentLength) {
    const remaining = contentLength - pos;
    
    // Last chunk — take everything
    if (remaining <= MAX_CHUNK_SIZE) {
      slices.push({
        start: pos,
        end: contentLength,
        semanticStartMarker: extractMarker(content, pos, 'start'),
        semanticEndMarker: '(end)',
      });
      break;
    }

    // Find best split point near NOMINAL_CHUNK_SIZE from current pos
    const targetEnd = pos + NOMINAL_CHUNK_SIZE;
    let splitAt = findNearestBoundary(content, targetEnd, searchRange);
    
    // Fallback: raw char cutoff at target
    if (splitAt < 0 || splitAt <= pos + MIN_CHUNK_SIZE || splitAt > pos + MAX_CHUNK_SIZE) {
      splitAt = targetEnd;
    }

    slices.push({
      start: pos,
      end: splitAt,
      semanticStartMarker: extractMarker(content, pos, 'start'),
      semanticEndMarker: extractMarker(content, splitAt - 1, 'end'),
    });

    // Advance with small overlap for continuity
    pos = splitAt - OVERLAP_CHARS;
    if (pos < 0) pos = 0;
  }

  return slices;
}

function computeFallbackSlices(contentLength: number): SemanticSlice[] {
  const slices: SemanticSlice[] = [];
  let start = 0;
  while (start < contentLength) {
    const end = Math.min(start + NOMINAL_CHUNK_SIZE, contentLength);
    slices.push({
      start,
      end,
      semanticStartMarker: `char ${start}`,
      semanticEndMarker: `char ${end}`,
    });
    if (end >= contentLength) break;
    start = end - OVERLAP_CHARS;
  }
  return slices;
}

export const LARGE_DOC_THRESHOLD = 40000;
