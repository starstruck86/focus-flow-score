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
}

const MAX_PARAGRAPH_WORDS = 120;

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
 * Split a single paragraph at sentence boundaries so no resulting
 * paragraph exceeds MAX_PARAGRAPH_WORDS. Returns the paragraph
 * unchanged if already within limits.
 */
function splitParagraph(para: string): string[] {
  const wordCount = para.split(/\s+/).length;
  if (wordCount <= MAX_PARAGRAPH_WORDS) return [para];

  // Split into sentences, preserving the delimiter with the preceding text.
  // Uses lookbehind for sentence-ending punctuation followed by a space.
  // Avoid splitting inside citations like [KI:...] or [SRC:...]
  const sentences: string[] = [];
  // Regex: split after `. `, `? `, `! ` but NOT inside brackets
  let remaining = para;
  const sentenceEndPattern = /([.!?])\s+(?=[A-Z\["\u201C(])/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = sentenceEndPattern.exec(remaining)) !== null) {
    const end = match.index + match[1].length;
    sentences.push(remaining.slice(lastIndex, end).trim());
    lastIndex = end;
    // Skip whitespace
    while (lastIndex < remaining.length && /\s/.test(remaining[lastIndex])) lastIndex++;
  }
  if (lastIndex < remaining.length) {
    sentences.push(remaining.slice(lastIndex).trim());
  }

  // If we couldn't split into sentences, return as-is
  if (sentences.length <= 1) return [para];

  // Group sentences into chunks ≤ MAX_PARAGRAPH_WORDS
  const chunks: string[] = [];
  let currentChunk: string[] = [];
  let currentWords = 0;

  for (const sentence of sentences) {
    const sentenceWords = sentence.split(/\s+/).length;

    if (currentWords > 0 && currentWords + sentenceWords > MAX_PARAGRAPH_WORDS) {
      chunks.push(currentChunk.join(" "));
      currentChunk = [sentence];
      currentWords = sentenceWords;
    } else {
      currentChunk.push(sentence);
      currentWords += sentenceWords;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(" "));
  }

  return chunks;
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
    const chunks = splitParagraph(block.trim());
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
