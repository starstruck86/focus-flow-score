/**
 * Semantic boundary-aware chunking for large documents.
 * Splits at headings > section boundaries > paragraph boundaries > sentence boundaries.
 * Never cuts in the middle of a knowledge unit.
 */

const NOMINAL_CHUNK_SIZE = 13000;
const MIN_CHUNK_SIZE = 9000;
const MAX_CHUNK_SIZE = 15000;
const OVERLAP_CHARS = 450;
const FORWARD_SEARCH_CHARS = 2200;
const BACKWARD_SEARCH_CHARS = 2800;
const OVERLAP_SEARCH_CHARS = 300;

export interface SemanticSlice {
  start: number;
  end: number;
  semanticStartMarker: string;
  semanticEndMarker: string;
}

interface BoundaryPattern {
  kind: 'heading' | 'section' | 'paragraph' | 'sentence';
  regex: RegExp;
}

/** Priority-ordered boundary patterns */
const BOUNDARY_PATTERNS: BoundaryPattern[] = [
  { kind: 'heading', regex: /^#{1,6}\s+.+$/gm },
  { kind: 'section', regex: /^\s*(?:---+|===+|\*\*\*+)\s*$/gm },
  { kind: 'section', regex: /\n\n(?=[A-Z][^\n]{0,120}\n)/g },
  { kind: 'paragraph', regex: /\n\n+/g },
  { kind: 'sentence', regex: /(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9])/g },
];

const OVERLAP_PATTERNS: BoundaryPattern[] = [
  { kind: 'paragraph', regex: /\n\n+/g },
  { kind: 'sentence', regex: /(?<=[.!?]["')\]]?)\s+(?=[A-Z0-9])/g },
];

function collectBoundaryPositions(
  content: string,
  start: number,
  end: number,
  pattern: RegExp,
): number[] {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(content.length, end);
  if (safeEnd <= safeStart) return [];

  const searchWindow = content.slice(safeStart, safeEnd);
  const regex = new RegExp(pattern.source, pattern.flags);
  const positions: number[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(searchWindow)) !== null) {
    positions.push(safeStart + match.index + match[0].length);
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }

  return positions;
}

function findBoundaryInDirection(
  content: string,
  target: number,
  minPos: number,
  maxPos: number,
  direction: 'forward' | 'backward',
  patterns: BoundaryPattern[] = BOUNDARY_PATTERNS,
): number {
  for (const pattern of patterns) {
    const positions = collectBoundaryPositions(content, minPos, maxPos, pattern.regex)
      .filter(pos => pos >= minPos && pos <= maxPos);
    if (positions.length === 0) continue;

    if (direction === 'forward') {
      const candidate = positions.find(pos => pos >= target);
      if (candidate != null) return candidate;
    } else {
      for (let i = positions.length - 1; i >= 0; i--) {
        if (positions[i] <= target) return positions[i];
      }
    }
  }

  return -1;
}

function findBestSplitBoundary(content: string, chunkStart: number): number {
  const target = chunkStart + NOMINAL_CHUNK_SIZE;
  const minPos = chunkStart + MIN_CHUNK_SIZE;
  const maxPos = Math.min(content.length, chunkStart + MAX_CHUNK_SIZE);

  const forwardBoundary = findBoundaryInDirection(
    content,
    target,
    Math.max(target, minPos),
    Math.min(maxPos, target + FORWARD_SEARCH_CHARS),
    'forward',
  );
  if (forwardBoundary >= minPos && forwardBoundary <= maxPos) return forwardBoundary;

  const backwardBoundary = findBoundaryInDirection(
    content,
    target,
    Math.max(minPos, target - BACKWARD_SEARCH_CHARS),
    maxPos,
    'backward',
  );
  if (backwardBoundary >= minPos && backwardBoundary <= maxPos) return backwardBoundary;

  const nearestForward = findBoundaryInDirection(content, target, minPos, maxPos, 'forward');
  if (nearestForward >= minPos && nearestForward <= maxPos) return nearestForward;

  const nearestBackward = findBoundaryInDirection(content, target, minPos, maxPos, 'backward');
  if (nearestBackward >= minPos && nearestBackward <= maxPos) return nearestBackward;

  return Math.min(maxPos, target);
}

function alignOverlapStart(content: string, nextStart: number, lowerBound: number): number {
  const minPos = Math.max(lowerBound, nextStart - OVERLAP_SEARCH_CHARS);
  const maxPos = Math.min(content.length, nextStart + OVERLAP_SEARCH_CHARS);

  const forward = findBoundaryInDirection(content, nextStart, minPos, maxPos, 'forward', OVERLAP_PATTERNS);
  if (forward >= lowerBound && forward < nextStart + OVERLAP_SEARCH_CHARS) return forward;

  const backward = findBoundaryInDirection(content, nextStart, minPos, maxPos, 'backward', OVERLAP_PATTERNS);
  if (backward >= lowerBound) return backward;

  return Math.max(lowerBound, nextStart);
}

function extractMarker(content: string, pos: number, direction: 'start' | 'end'): string {
  const clampedPos = Math.max(0, Math.min(content.length - 1, pos));
  const lineStart = content.lastIndexOf('\n', clampedPos) + 1;
  const lineEnd = content.indexOf('\n', clampedPos);
  const primaryLine = content.slice(lineStart, lineEnd > 0 ? lineEnd : clampedPos + 120).trim();

  if (/^#{1,6}\s+/.test(primaryLine)) return primaryLine.slice(0, 96);

  const searchStart = direction === 'start'
    ? Math.max(0, clampedPos - 250)
    : clampedPos;
  const searchEnd = direction === 'start'
    ? clampedPos + 40
    : Math.min(content.length, clampedPos + 250);
  const nearbyHeading = content.slice(searchStart, searchEnd).match(/^#{1,6}\s+.+$/m)?.[0]?.trim();
  if (nearbyHeading) return nearbyHeading.slice(0, 96);

  return primaryLine.slice(0, 72) + (primaryLine.length > 72 ? '…' : '');
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

    const splitAt = findBestSplitBoundary(content, pos);

    slices.push({
      start: pos,
      end: splitAt,
      semanticStartMarker: extractMarker(content, pos, 'start'),
      semanticEndMarker: extractMarker(content, splitAt - 1, 'end'),
    });

    const overlapTarget = Math.max(pos + 1, splitAt - OVERLAP_CHARS);
    pos = alignOverlapStart(content, overlapTarget, pos + 1);
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
