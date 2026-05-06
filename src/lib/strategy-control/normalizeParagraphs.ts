/**
 * Universal paragraph normalization utility.
 *
 * Splits oversized paragraphs (>120 words) at sentence boundaries
 * BEFORE artifact gate evaluation. Preserves all content, markdown
 * structure, citations, code fences, tables, and numbered lists.
 *
 * This is NOT summarization. Content length is preserved.
 * Only paragraph boundaries are adjusted for readability.
 */

export interface NormalizationTelemetry {
  paragraphs_split: number;
  longest_paragraph_before: number;
  longest_paragraph_after: number;
  forced_splits: number;
  longest_chunk_before_forced_split: number;
  longest_chunk_after_forced_split: number;
}

const MAX_PARAGRAPH_WORDS = 120;
const FORCED_SPLIT_TARGET = 100; // aim for ~100 words per chunk

/**
 * Check if a line is a protected structure that should never be split.
 */
function isProtectedLine(line: string): boolean {
  const trimmed = line.trim();
  // Markdown headings
  if (/^#{1,6}\s/.test(trimmed)) return true;
  // Code fence boundaries
  if (trimmed.startsWith("```")) return true;
  // Table rows
  if (/^\|.*\|$/.test(trimmed)) return true;
  // Bullet / numbered list items (but these CAN be individually long)
  if (/^[\-\*]\s/.test(trimmed)) return true;
  if (/^\d+[.)]\s/.test(trimmed)) return true;
  // Citation-only lines
  if (/^\[(?:KI|PB|SRC|S\d):[^\]]*\]\s*$/.test(trimmed)) return true;
  return false;
}

/**
 * Force-split a single chunk at word boundaries into pieces of ~FORCED_SPLIT_TARGET words.
 * Only called when sentence-boundary splitting left a chunk > MAX_PARAGRAPH_WORDS.
 */
function forceSplitChunk(chunk: string, telemetry: NormalizationTelemetry): string[] {
  const words = chunk.split(/\s+/);
  if (words.length <= MAX_PARAGRAPH_WORDS) return [chunk];

  const chunkWc = words.length;
  if (chunkWc > telemetry.longest_chunk_before_forced_split) {
    telemetry.longest_chunk_before_forced_split = chunkWc;
  }

  const pieces: string[] = [];
  for (let i = 0; i < words.length; i += FORCED_SPLIT_TARGET) {
    const slice = words.slice(i, i + FORCED_SPLIT_TARGET);
    pieces.push(slice.join(" "));
  }

  telemetry.forced_splits += pieces.length - 1;
  for (const p of pieces) {
    const wc = p.split(/\s+/).length;
    if (wc > telemetry.longest_chunk_after_forced_split) {
      telemetry.longest_chunk_after_forced_split = wc;
    }
  }

  return pieces;
}

/**
 * Split a single paragraph at sentence boundaries so no resulting
 * paragraph exceeds MAX_PARAGRAPH_WORDS. If any chunk still exceeds
 * the limit after sentence splitting, force-split at word boundaries.
 */
function splitParagraph(para: string, telemetry: NormalizationTelemetry): string[] {
  const wordCount = para.split(/\s+/).length;
  if (wordCount <= MAX_PARAGRAPH_WORDS) return [para];

  const sentences: string[] = [];
  const remaining = para;
  const sentenceEndPattern = /([.!?])\s+(?=[A-Z\["\u201C(])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndPattern.exec(remaining)) !== null) {
    const end = match.index + match[1].length;
    sentences.push(remaining.slice(lastIndex, end).trim());
    lastIndex = end;
    while (lastIndex < remaining.length && /\s/.test(remaining[lastIndex])) lastIndex++;
  }
  if (lastIndex < remaining.length) {
    sentences.push(remaining.slice(lastIndex).trim());
  }

  // Group sentences into chunks ≤ MAX_PARAGRAPH_WORDS
  const sentenceChunks: string[] = [];
  if (sentences.length <= 1) {
    // Single sentence or no split points — entire para is one chunk
    sentenceChunks.push(para);
  } else {
    let currentChunk: string[] = [];
    let currentWords = 0;
    for (const sentence of sentences) {
      const sentenceWords = sentence.split(/\s+/).length;
      if (currentWords > 0 && currentWords + sentenceWords > MAX_PARAGRAPH_WORDS) {
        sentenceChunks.push(currentChunk.join(" "));
        currentChunk = [sentence];
        currentWords = sentenceWords;
      } else {
        currentChunk.push(sentence);
        currentWords += sentenceWords;
      }
    }
    if (currentChunk.length > 0) {
      sentenceChunks.push(currentChunk.join(" "));
    }
  }

  // Forced-split fallback: any chunk still over limit gets word-boundary split
  const finalChunks: string[] = [];
  for (const chunk of sentenceChunks) {
    const wc = chunk.split(/\s+/).length;
    if (wc > MAX_PARAGRAPH_WORDS) {
      finalChunks.push(...forceSplitChunk(chunk, telemetry));
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Normalize paragraphs in text content. Handles both plain text
 * and JSON-stringified structured artifacts.
 *
 * For JSON: parses, normalizes all string values recursively, re-stringifies.
 * For plain text/markdown: normalizes paragraph boundaries directly.
 */
export function normalizeParagraphs(text: string): { text: string; telemetry: NormalizationTelemetry } {
  const telemetry: NormalizationTelemetry = {
    paragraphs_split: 0,
    longest_paragraph_before: 0,
    longest_paragraph_after: 0,
    forced_splits: 0,
    longest_chunk_before_forced_split: 0,
    longest_chunk_after_forced_split: 0,
  };

  // Try JSON path first
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      const normalized = normalizeJsonValues(parsed, telemetry);
      return { text: JSON.stringify(normalized), telemetry };
    } catch { /* fall through to plain text */ }
  }

  // Plain text / markdown path
  const result = normalizeMarkdownText(text, telemetry);
  return { text: result, telemetry };
}

/**
 * Recursively normalize all string values in a JSON structure.
 */
function normalizeJsonValues(value: unknown, telemetry: NormalizationTelemetry): unknown {
  if (typeof value === "string") {
    return normalizeMarkdownText(value, telemetry);
  }
  if (Array.isArray(value)) {
    return value.map(v => normalizeJsonValues(v, telemetry));
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeJsonValues(v, telemetry);
    }
    return result;
  }
  return value;
}

/**
 * Normalize paragraph boundaries in markdown/prose text.
 * Preserves headings, code fences, tables, bullets, citations.
 */
function normalizeMarkdownText(text: string, telemetry: NormalizationTelemetry): string {
  // Split on double newlines (paragraph boundaries)
  const blocks = text.split(/(\n\s*\n)/);
  const result: string[] = [];
  let inCodeFence = false;

  for (const block of blocks) {
    // Preserve paragraph separators as-is
    if (/^\n\s*\n$/.test(block)) {
      result.push(block);
      continue;
    }

    // Track code fence state
    const fenceCount = (block.match(/^```/gm) || []).length;
    if (inCodeFence) {
      result.push(block);
      if (fenceCount % 2 === 1) inCodeFence = false;
      continue;
    }
    if (fenceCount % 2 === 1) {
      inCodeFence = true;
      result.push(block);
      continue;
    }

    // Skip protected structures
    if (isProtectedLine(block)) {
      const wc = block.split(/\s+/).length;
      if (wc > telemetry.longest_paragraph_before) telemetry.longest_paragraph_before = wc;
      if (wc > telemetry.longest_paragraph_after) telemetry.longest_paragraph_after = wc;
      result.push(block);
      continue;
    }

    // Check if table block
    if (/^\|.*\|$/m.test(block)) {
      result.push(block);
      continue;
    }

    const wordCount = block.trim().split(/\s+/).length;
    if (wordCount > telemetry.longest_paragraph_before) {
      telemetry.longest_paragraph_before = wordCount;
    }

    if (wordCount <= MAX_PARAGRAPH_WORDS) {
      if (wordCount > telemetry.longest_paragraph_after) {
        telemetry.longest_paragraph_after = wordCount;
      }
      result.push(block);
      continue;
    }

    // Split this oversized paragraph
    const chunks = splitParagraph(block.trim(), telemetry);
    if (chunks.length > 1) {
      telemetry.paragraphs_split++;
    }
    for (const chunk of chunks) {
      const cw = chunk.split(/\s+/).length;
      if (cw > telemetry.longest_paragraph_after) {
        telemetry.longest_paragraph_after = cw;
      }
    }
    result.push(chunks.join("\n\n"));
  }

  return result.join("");
}
