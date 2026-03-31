/**
 * Content Signature & Content-First Similarity
 * 
 * All dedup/routing/promotion decisions use content, not titles.
 * Titles are labels only.
 * 
 * Multi-slice similarity: compares opening, middle, closing, and structural markers.
 */

// ── Normalize ──────────────────────────────────────────────

function normalizeSlice(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(text: string): Set<string> {
  return new Set(normalizeSlice(text).split(' ').filter(w => w.length > 2));
}

function diceCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) { if (b.has(w)) intersection++; }
  return (2 * intersection) / (a.size + b.size);
}

// ── Content Signature ──────────────────────────────────────

export function generateContentSignature(content: string | null | undefined): string {
  if (!content) return '';
  return normalizeSlice(content.slice(0, 500));
}

// ── Multi-Slice Content Similarity ─────────────────────────

function getSlices(content: string): { opening: string; middle: string; closing: string } {
  const len = content.length;
  const sliceLen = Math.min(300, Math.floor(len / 3));
  return {
    opening: content.slice(0, sliceLen),
    middle: content.slice(Math.floor(len / 2) - Math.floor(sliceLen / 2), Math.floor(len / 2) + Math.floor(sliceLen / 2)),
    closing: content.slice(Math.max(0, len - sliceLen)),
  };
}

const STRUCTURAL_MARKERS = [
  /\[.*?\]/g,           // placeholders
  /\{.*?\}/g,           // mustache
  /^[-•*]\s+/gm,        // bullet lists
  /^\d+\.\s+/gm,        // numbered lists
  /^#{1,3}\s+/gm,       // markdown headings
  /subject\s*:/gi,
  /agenda\s*:/gi,
  /step\s*\d/gi,
  /next steps?\s*:/gi,
];

function extractStructuralFingerprint(content: string): string[] {
  const markers: string[] = [];
  for (const pattern of STRUCTURAL_MARKERS) {
    const matches = content.match(pattern);
    if (matches) {
      markers.push(...matches.map(m => m.toLowerCase().trim()));
    }
  }
  return markers;
}

function structuralSimilarity(a: string, b: string): number {
  const markersA = extractStructuralFingerprint(a);
  const markersB = extractStructuralFingerprint(b);
  if (markersA.length === 0 && markersB.length === 0) return 0.5; // neutral
  if (markersA.length === 0 || markersB.length === 0) return 0.2;
  const setA = new Set(markersA);
  const setB = new Set(markersB);
  return diceCoefficient(setA, setB);
}

/**
 * Multi-slice content similarity: compares opening, middle, closing slices
 * plus structural markers. Returns 0-1.
 */
export function contentSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const strA = typeof a === 'string' ? a : '';
  const strB = typeof b === 'string' ? b : '';
  if (strA.length < 20 || strB.length < 20) return 0;

  const slicesA = getSlices(strA);
  const slicesB = getSlices(strB);

  const openingSim = diceCoefficient(tokenize(slicesA.opening), tokenize(slicesB.opening));
  const middleSim = diceCoefficient(tokenize(slicesA.middle), tokenize(slicesB.middle));
  const closingSim = diceCoefficient(tokenize(slicesA.closing), tokenize(slicesB.closing));
  const structSim = structuralSimilarity(strA, strB);

  return openingSim * 0.35 + middleSim * 0.25 + closingSim * 0.25 + structSim * 0.15;
}

// ── Content-first duplicate check ──────────────────────────

export function isContentDuplicate(
  newContent: string,
  existingContents: string[],
  threshold = 0.65,
): { isDuplicate: boolean; mostSimilar?: string; similarity: number } {
  let maxSim = 0;
  let mostSimilar: string | undefined;

  for (const existing of existingContents) {
    const sim = contentSimilarity(newContent, existing);
    if (sim > maxSim) {
      maxSim = sim;
      mostSimilar = existing;
    }
  }

  return {
    isDuplicate: maxSim > threshold,
    mostSimilar: maxSim > 0.4 ? mostSimilar?.slice(0, 100) : undefined,
    similarity: maxSim,
  };
}

// ── Content-based Routing (hardened) ───────────────────────

export type ContentRoute = 'template' | 'example' | 'tactic' | 'reference';

export const TEMPLATE_STRUCTURE_SIGNALS = [
  /\[.*?(name|company|title|role|date|amount|product).*?\]/i,
  /\{.*?(name|company|title|role|date|amount|product).*?\}/i,
  /step\s*\d|phase\s*\d|part\s*\d/i,
  /^[-•*]\s+/m,
  /subject\s*:/i,
  /agenda\s*:/i,
  /\d+\.\s+[A-Z]/m,
];

export const EXAMPLE_STRUCTURE_SIGNALS = [
  /^(hi|hey|hello|dear|good morning|good afternoon)\s/im,
  /we (discussed|talked|agreed|reviewed|covered)/i,
  /thank you for|thanks for|appreciate your/i,
  /I (wanted|wanted to|am writing|am reaching|am following)/i,
  /best regards|sincerely|cheers|thanks,?\s*$/im,
  /next steps?\s*:/i,
];

export const TACTIC_STRUCTURE_SIGNALS = [
  /\bwhen\s+(the|a|your|they|you|it)\b/i,
  /\binstead of\b.*\btry\b/i,
  /\b(respond|handle|counter|address)\s+(by|with|using)\b/i,
  /\bif\s+(they|the prospect|the buyer|your)\b/i,
  /\b(technique|approach|method)\s*:/i,
  /\b(why|because|this works because)\b/i,
  /["'""].{10,}["'""]$/m,
];

// Descriptive/reference signals that indicate NON-actionable content
const DESCRIPTIVE_SIGNALS = [
  /\b(overview|introduction|background|context|summary)\b/i,
  /\b(in general|generally speaking|typically|usually|often)\b/i,
  /\b(various|several|many|numerous) (ways|methods|approaches)\b/i,
  /\b(history|evolution|landscape|ecosystem|industry)\b/i,
  /\b(according to|research shows|studies indicate)\b/i,
];

export function routeByContent(content: string): ContentRoute[] {
  if (!content || content.length < 50) return ['reference'];

  const routes: ContentRoute[] = [];

  const tplHits = TEMPLATE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (tplHits >= 2 && content.length >= 200) routes.push('template');

  const exHits = EXAMPLE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (exHits >= 2 && content.length >= 150) routes.push('example');

  const tacHits = TACTIC_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  const descHits = DESCRIPTIVE_SIGNALS.filter(p => p.test(content)).length;
  if (tacHits >= 2 && descHits < tacHits) {
    routes.push('tactic');
  } else if (tacHits >= 3 && content.length >= 200) {
    routes.push('tactic');
  }

  if (routes.length === 0) routes.push('reference');
  return routes;
}

// ── Smart Preview Snippets ─────────────────────────────────

export function generateSmartSnippet(
  content: string,
  route: ContentRoute | string,
  maxLen = 200,
): string {
  if (!content) return '';

  if (route === 'template') {
    const placeholderMatch = content.match(/\[.*?\]|\{.*?\}/);
    const stepMatch = content.match(/step\s*\d[^]*?(?=step\s*\d|$)/i);
    if (stepMatch) {
      return stepMatch[0].slice(0, maxLen).replace(/\n+/g, ' ').trim() + '…';
    }
    if (placeholderMatch && placeholderMatch.index !== undefined) {
      const start = Math.max(0, placeholderMatch.index - 40);
      return '…' + content.slice(start, start + maxLen).replace(/\n+/g, ' ').trim() + '…';
    }
    const lines = content.split('\n').filter(l => l.trim().length > 5).slice(0, 3);
    return lines.join(' | ').slice(0, maxLen);
  }

  if (route === 'example') {
    const lines = content.split('\n').filter(l => l.trim().length > 5);
    const opening = lines.slice(0, 2).join(' ');
    if (opening.length > maxLen) return opening.slice(0, maxLen) + '…';
    return opening || content.slice(0, maxLen);
  }

  if (route === 'tactic') {
    const whenMatch = content.match(/when\s+(the|a|your|they)[^.]*\./i);
    const quoteMatch = content.match(/["'""][^"'""]{10,}["'""]/);
    if (whenMatch) return whenMatch[0].slice(0, maxLen);
    if (quoteMatch) return quoteMatch[0].slice(0, maxLen);
    const sentences = content.split(/[.!?]\s+/);
    const actionSentence = sentences.find(s =>
      /\b(ask|say|use|try|respond|frame|handle|counter)\b/i.test(s)
    );
    return (actionSentence || sentences[0] || '').slice(0, maxLen);
  }

  return content.slice(0, maxLen).replace(/\n+/g, ' ').trim();
}

// ── Content Transformation for Promotion ───────────────────

// Lines that are clearly meta and should be stripped
const META_LINE_PATTERNS = [
  /^(note|comment|explanation|tip|reminder)\s*:/i,
  /^\/\//,
  /^\(.*?\)\s*$/,
  /^(template|email template|draft|version \d+)\s*:?\s*$/i,
];

// Lines that must be PRESERVED even if they look meta-ish
const PRESERVE_LINE_PATTERNS = [
  /\b(example|e\.g\.|for instance|such as)\b/i,
  /\b(instruction|constraint|rule|requirement|must|should|always|never)\b/i,
  /\b(persona|audience|tone|voice|style)\b/i,
  /\b(when|if|unless|before|after|during)\s+(the|a|you|they)\b/i,
  /\[.*?(name|company|title|role|date).*?\]/i,
  /\{.*?(name|company|title|role|date).*?\}/i,
  /["'""].{5,}["'""]/,
];

// High-risk patterns — warn aggressively if these are removed
const HIGH_RISK_PATTERNS = [
  { pattern: /["'""].{5,}["'""]/, label: 'quoted phrasing' },
  { pattern: /\[.*?\]|\{.*?\}/, label: 'placeholder' },
  { pattern: /\b(when|if|before|after|unless|during)\s+(the|a|you|they)\b/i, label: 'conditional logic' },
  { pattern: /\b(persona|audience|tone|voice|style|constraint|rule)\b/i, label: 'persona/constraint' },
  { pattern: /\b(instruction|requirement|must|should|always|never)\b/i, label: 'instruction' },
];

// ── Second-pass false-positive filter ──────────────────────
// Lines that LOOK like they should be preserved (contain "should", "always")
// but are actually dev/meta noise. Catches comment wrappers, inline dev notes,
// and draft annotations that survive first-pass preserve rules.

const FALSE_POSITIVE_META_PATTERNS = [
  // Dev notes that happen to contain instruction-like words
  /^\/\/\s*(todo|fixme|hack|note|bug|xxx)\b/i,
  /^#\s*(todo|fixme|note|wip)\b/i,
  // Comment wrappers: <!-- ... -->, /* ... */
  /^<!--.*-->$/,
  /^\/\*.*\*\/$/,
  // Draft annotations like "[DRAFT]", "[WIP]", "[TODO: ...]"
  /^\[(draft|wip|todo|fixme|review|placeholder|tbd)\b[^\]]*\]$/i,
  // Internal status markers
  /^(status|state|phase|revision|owner|assignee)\s*:/i,
  // Timestamps / version stamps that look like instructions
  /^(last (updated|edited|modified)|updated on|created on|v\d+\.\d+)\b/i,
  // Lines that are ONLY meta keywords with no real content
  /^(note|comment|reminder|tip|caveat|fyi)\s*:?\s*$/i,
  // Inline dev notes in parens: "(should update this later)"
  /^\(.*\b(todo|fixme|later|eventually|placeholder|tbd)\b.*\)$/i,
];

function isSecondPassMeta(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  return FALSE_POSITIVE_META_PATTERNS.some(p => p.test(trimmed));
}

function isMetaLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // Second-pass: if it matches false-positive patterns, strip it
  // even if it would otherwise be preserved
  if (isSecondPassMeta(trimmed)) return true;
  // First-pass preserve check
  if (PRESERVE_LINE_PATTERNS.some(p => p.test(trimmed))) return false;
  return META_LINE_PATTERNS.some(p => p.test(trimmed));
}

export interface HighRiskRemoval {
  line: string;
  lineNumber: number;
  riskLabels: string[];
}

export interface TransformationResult {
  shaped: string;
  removedLines: string[];
  originalLineCount: number;
  shapedLineCount: number;
  highRiskRemovals: HighRiskRemoval[];
}

/**
 * Classify removed lines for high-risk warnings.
 */
function classifyRemovedLines(removedLines: Array<{ line: string; lineNumber: number }>): HighRiskRemoval[] {
  const highRisk: HighRiskRemoval[] = [];
  for (const { line, lineNumber } of removedLines) {
    const labels: string[] = [];
    for (const { pattern, label } of HIGH_RISK_PATTERNS) {
      if (pattern.test(line)) labels.push(label);
    }
    if (labels.length > 0) {
      highRisk.push({ line, lineNumber, riskLabels: labels });
    }
  }
  return highRisk;
}

/**
 * Shape raw content into a reusable template body.
 * Returns both shaped content and removed lines for review.
 */
export function shapeAsTemplate(content: string): TransformationResult {
  const lines = content.split('\n');
  const kept: string[] = [];
  const removedLines: Array<{ line: string; lineNumber: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    if (isMetaLine(lines[i])) {
      removedLines.push({ line: lines[i], lineNumber: i + 1 });
    } else {
      let shaped = lines[i].replace(/\{(\w+)\}/g, (_, name) =>
        `[${name.charAt(0).toUpperCase() + name.slice(1)}]`
      );
      kept.push(shaped);
    }
  }

  let result = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    shaped: result,
    removedLines: removedLines.map(r => r.line),
    originalLineCount: lines.length,
    shapedLineCount: result.split('\n').length,
    highRiskRemovals: classifyRemovedLines(removedLines),
  };
}

/**
 * Shape raw content into a realistic example.
 * Returns both shaped content and removed lines for review.
 */
export function shapeAsExample(content: string): TransformationResult {
  const lines = content.split('\n');
  const kept: string[] = [];
  const removedLines: Array<{ line: string; lineNumber: number }> = [];

  const EXAMPLE_META = [
    /^(note|comment|internal|draft note|meta|context)\s*:/i,
    /^\/\//,
    /^\[?(internal|draft|wip|todo)\]?\s*$/i,
    /^(version|v\d+|last updated|status)\s*:/i,
  ];

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      kept.push(lines[i]);
      continue;
    }
    // Second-pass catches false positives
    if (isSecondPassMeta(trimmed)) {
      removedLines.push({ line: lines[i], lineNumber: i + 1 });
    } else if (PRESERVE_LINE_PATTERNS.some(p => p.test(trimmed))) {
      kept.push(lines[i]);
    } else if (EXAMPLE_META.some(p => p.test(trimmed))) {
      removedLines.push({ line: lines[i], lineNumber: i + 1 });
    } else {
      kept.push(lines[i]);
    }
  }

  let result = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    shaped: result,
    removedLines: removedLines.map(r => r.line),
    originalLineCount: lines.length,
    shapedLineCount: result.split('\n').length,
    highRiskRemovals: classifyRemovedLines(removedLines),
  };
}

// ── Segment-Level Routing (First-Class) ────────────────────

export interface ContentSegment {
  index: number;
  content: string;
  heading?: string;
  route: ContentRoute;
  allRoutes: ContentRoute[];
  confidence: number;
  charRange: [number, number];
  /** Populated when this segment was created by merging adjacent segments */
  mergedFromIndices?: number[];
  mergeReason?: 'same_route_similarity' | 'same_route_short_segments';
  mergeSimilarityScore?: number;
}

/**
 * Split content into logical segments (by headings or double-newlines)
 * and route each independently. Enables multi-asset extraction from one resource.
 * Segments are first-class: each carries provenance (charRange, heading, route).
 */
export function segmentAndRoute(content: string): ContentSegment[] {
  if (!content || content.length < 100) {
    const routes = routeByContent(content);
    return [{ index: 0, content, route: routes[0], allRoutes: routes, confidence: 0.5, charRange: [0, content?.length || 0] }];
  }

  const headingPattern = /^(#{1,3})\s+(.+)$/gm;
  const headings: Array<{ index: number; level: number; title: string; pos: number }> = [];
  let match;
  while ((match = headingPattern.exec(content)) !== null) {
    headings.push({ index: headings.length, level: match[1].length, title: match[2], pos: match.index });
  }

  let rawSegments: Array<{ content: string; heading?: string; charStart: number; charEnd: number }>;

  if (headings.length >= 2) {
    rawSegments = [];
    for (let i = 0; i < headings.length; i++) {
      const start = headings[i].pos;
      const end = i + 1 < headings.length ? headings[i + 1].pos : content.length;
      const segContent = content.slice(start, end).trim();
      if (segContent.length >= 50) {
        rawSegments.push({ content: segContent, heading: headings[i].title, charStart: start, charEnd: end });
      }
    }
    if (headings[0].pos > 80) {
      const preamble = content.slice(0, headings[0].pos).trim();
      if (preamble.length >= 50) {
        rawSegments.unshift({ content: preamble, charStart: 0, charEnd: headings[0].pos });
      }
    }
  } else {
    const paragraphs = content.split(/\n{2,}/).filter(p => p.trim().length > 20);
    if (paragraphs.length <= 2) {
      const routes = routeByContent(content);
      return [{ index: 0, content, route: routes[0], allRoutes: routes, confidence: 0.5, charRange: [0, content.length] }];
    }
    rawSegments = [];
    let buffer = '';
    let bufStart = 0;
    let pos = 0;
    for (const para of paragraphs) {
      const paraStart = content.indexOf(para, pos);
      if (!buffer) bufStart = paraStart;
      buffer += (buffer ? '\n\n' : '') + para;
      pos = paraStart + para.length;
      if (buffer.length >= 200) {
        rawSegments.push({ content: buffer, charStart: bufStart, charEnd: pos });
        buffer = '';
      }
    }
    if (buffer.length >= 50) rawSegments.push({ content: buffer, charStart: bufStart, charEnd: pos });
  }

  if (rawSegments.length <= 1) {
    const routes = routeByContent(content);
    return [{ index: 0, content, route: routes[0], allRoutes: routes, confidence: 0.5, charRange: [0, content.length] }];
  }

  // Route each segment
  let segments: ContentSegment[] = rawSegments.map((seg, i) => {
    const routes = routeByContent(seg.content);
    return {
      index: i,
      content: seg.content,
      heading: seg.heading,
      route: routes[0],
      allRoutes: routes,
      confidence: scoreRouteConfidence(seg.content, routes[0]),
      charRange: [seg.charStart, seg.charEnd] as [number, number],
    };
  });

  // ── Merge adjacent same-route segments if highly related ──
  segments = mergeAdjacentSegments(segments);

  return segments;
}

/**
 * Merge adjacent segments that have the same primary route and high similarity.
 * Prevents over-fragmentation of mixed docs.
 */
function mergeAdjacentSegments(segments: ContentSegment[]): ContentSegment[] {
  if (segments.length <= 1) return segments;

  const merged: ContentSegment[] = [{ ...segments[0] }];

  for (let i = 1; i < segments.length; i++) {
    const prev = merged[merged.length - 1];
    const curr = segments[i];

    // Merge if same route and content is similar enough
    const sameRoute = prev.route === curr.route;
    const sim = sameRoute ? contentSimilarity(prev.content, curr.content) : 0;
    // Also merge if both are short and same route (likely one logical block)
    const bothShort = prev.content.length < 300 && curr.content.length < 300;

    if (sameRoute && (sim > 0.4 || bothShort)) {
      const mergeReason: ContentSegment['mergeReason'] = sim > 0.4
        ? 'same_route_similarity'
        : 'same_route_short_segments';
      const prevIndices = prev.mergedFromIndices || [prev.index];
      // Merge into prev
      merged[merged.length - 1] = {
        index: prev.index,
        content: prev.content + '\n\n' + curr.content,
        heading: prev.heading,
        route: prev.route,
        allRoutes: [...new Set([...prev.allRoutes, ...curr.allRoutes])],
        confidence: Math.max(prev.confidence, curr.confidence),
        charRange: [prev.charRange[0], curr.charRange[1]],
        mergedFromIndices: [...prevIndices, curr.index],
        mergeReason,
        mergeSimilarityScore: sim > 0 ? sim : undefined,
      };
    } else {
      merged.push({ ...curr, index: merged.length });
    }
  }

  return merged;
}

// ── Role-Specific Candidate Scoring ────────────────────────

/**
 * Score how well content fits a specific role, beyond simple signal counting.
 */
export function scoreRouteConfidence(content: string, route: ContentRoute): number {
  if (!content) return 0;

  if (route === 'template') {
    return scoreTemplateCandidate(content);
  }
  if (route === 'example') {
    return scoreExampleCandidate(content);
  }
  if (route === 'tactic') {
    return scoreTacticCandidate(content);
  }
  return 0.2; // reference
}

function scoreTemplateCandidate(content: string): number {
  let score = 0;

  // Reusable structure: placeholders
  const placeholderCount = (content.match(/\[.*?\]|\{.*?\}/g) || []).length;
  score += Math.min(0.3, placeholderCount * 0.08);

  // Clean placeholders (named, not random brackets)
  const namedPlaceholders = (content.match(/\[(name|company|title|role|date|amount|product|industry|goal)\]/gi) || []).length;
  score += namedPlaceholders * 0.05;

  // Step/section structure
  const steps = (content.match(/^(step\s*\d|phase\s*\d|\d+\.)\s/gim) || []).length;
  score += Math.min(0.2, steps * 0.05);

  // Completeness: has subject line + body or clear sections
  if (/subject\s*:/i.test(content)) score += 0.1;
  if (/^[-•*]\s+/m.test(content)) score += 0.05;
  if (content.length >= 300) score += 0.1;
  if (content.length >= 600) score += 0.05;

  // Penalize if too short or no structure
  if (content.length < 150) score *= 0.5;

  return Math.min(1, score);
}

function scoreExampleCandidate(content: string): number {
  let score = 0;

  // Realistic narrative: greeting
  if (/^(hi|hey|hello|dear|good morning)\s/im.test(content)) score += 0.15;

  // Coherence: first-person narrative
  const firstPerson = (content.match(/\bI\s+(wanted|am|was|have|would|will|could)\b/gi) || []).length;
  score += Math.min(0.15, firstPerson * 0.05);

  // Real-world context markers
  if (/we (discussed|talked|agreed|reviewed|covered)/i.test(content)) score += 0.1;
  if (/thank you|thanks for|appreciate/i.test(content)) score += 0.05;

  // Closing/CTA quality
  if (/\b(next steps?|follow.?up|action items?)\s*:/i.test(content)) score += 0.15;
  if (/best regards|sincerely|cheers|thanks,?\s*$/im.test(content)) score += 0.1;

  // Coherent length
  if (content.length >= 200) score += 0.1;
  if (content.length >= 400) score += 0.05;

  // Penalize if it reads like a template (has placeholders)
  const placeholders = (content.match(/\[.*?\]|\{.*?\}/g) || []).length;
  if (placeholders > 2) score -= 0.15;

  return Math.max(0, Math.min(1, score));
}

function scoreTacticCandidate(content: string): number {
  let score = 0;

  // Atomicity: focused, not too long
  if (content.length >= 50 && content.length <= 500) score += 0.15;
  if (content.length > 800) score -= 0.1;

  // Specificity: concrete language
  if (/["'""].{10,}["'""]/m.test(content)) score += 0.15; // talk track
  if (/\b(exactly|specifically|precisely)\b/i.test(content)) score += 0.05;

  // Actionability: clear instruction
  if (/\b(ask|say|respond|try|use|frame|pivot|bridge)\b/i.test(content)) score += 0.15;
  if (/\binstead of\b.*\btry\b/i.test(content)) score += 0.1;
  if (/\bwhen\s+(the|a|your|they)\b/i.test(content)) score += 0.1;

  // Usable phrasing
  if (/\b(if|when|before|after|during)\s+(they|the prospect|the buyer|your)\b/i.test(content)) score += 0.1;

  // Penalize descriptive
  const descHits = DESCRIPTIVE_SIGNALS.filter(p => p.test(content)).length;
  score -= descHits * 0.08;

  return Math.max(0, Math.min(1, score));
}

// ── Content Clustering (with canonical resolution) ─────────

export interface ClusterMember {
  id: string;
  title: string;
  content: string;
  similarity: number;
}

export interface ClusterCandidate {
  id: string;
  title: string;
  score: number;
  reasoning: string;
}

export interface ContentCluster {
  id: string;
  members: ClusterMember[];
  bestTemplate?: ClusterCandidate;
  bestExample?: ClusterCandidate;
  bestTactic?: ClusterCandidate;
  canonicalId?: string;
  canonicalRole?: ContentRoute;
  canonicalReasoning?: string;
}

export interface ClusterResolution {
  clusterId: string;
  canonicalResourceId: string | null;
  canonicalRole: ContentRoute;
  reasoning: string;
  demotedMembers: Array<{ id: string; duplicateOf: string | null }>;
}

function buildCandidateReasoning(content: string, role: ContentRoute, score: number): string {
  const parts: string[] = [];
  if (role === 'template') {
    const ph = (content.match(/\[.*?\]|\{.*?\}/g) || []).length;
    const steps = (content.match(/^(step\s*\d|phase\s*\d|\d+\.)\s/gim) || []).length;
    if (ph > 0) parts.push(`${ph} placeholders`);
    if (steps > 0) parts.push(`${steps} steps`);
    if (content.length >= 300) parts.push('complete length');
  } else if (role === 'example') {
    if (/^(hi|hey|hello|dear)\s/im.test(content)) parts.push('has greeting');
    if (/next steps?\s*:/i.test(content)) parts.push('has CTA');
    if (/best regards|sincerely|cheers/im.test(content)) parts.push('has closing');
  } else if (role === 'tactic') {
    if (/["'""].{10,}["'""]/m.test(content)) parts.push('has talk track');
    if (/\bwhen\s+(the|a|your)\b/i.test(content)) parts.push('has trigger');
    if (content.length <= 500) parts.push('atomic length');
  }
  return parts.length > 0 ? `Score ${(score * 100).toFixed(0)}%: ${parts.join(', ')}` : `Score ${(score * 100).toFixed(0)}%`;
}

/**
 * Group resources into clusters by content similarity.
 * Uses role-specific scoring for best candidate selection.
 */
export function clusterByContent(
  resources: Array<{ id: string; title: string; content: string }>,
  threshold = 0.5,
): ContentCluster[] {
  const clusters: ContentCluster[] = [];
  const assigned = new Set<string>();

  for (let i = 0; i < resources.length; i++) {
    if (assigned.has(resources[i].id)) continue;

    const cluster: ContentCluster = {
      id: `cluster-${i}`,
      members: [{ ...resources[i], similarity: 1 }],
    };
    assigned.add(resources[i].id);

    for (let j = i + 1; j < resources.length; j++) {
      if (assigned.has(resources[j].id)) continue;
      const sim = contentSimilarity(resources[i].content, resources[j].content);
      if (sim > threshold) {
        cluster.members.push({ ...resources[j], similarity: sim });
        assigned.add(resources[j].id);
      }
    }

    if (cluster.members.length > 1) {
      for (const member of cluster.members) {
        const tplScore = scoreTemplateCandidate(member.content);
        const exScore = scoreExampleCandidate(member.content);
        const tacScore = scoreTacticCandidate(member.content);

        if (tplScore > 0.2 && (!cluster.bestTemplate || tplScore > cluster.bestTemplate.score)) {
          cluster.bestTemplate = { id: member.id, title: member.title, score: tplScore, reasoning: buildCandidateReasoning(member.content, 'template', tplScore) };
        }
        if (exScore > 0.2 && (!cluster.bestExample || exScore > cluster.bestExample.score)) {
          cluster.bestExample = { id: member.id, title: member.title, score: exScore, reasoning: buildCandidateReasoning(member.content, 'example', exScore) };
        }
        if (tacScore > 0.2 && (!cluster.bestTactic || tacScore > cluster.bestTactic.score)) {
          cluster.bestTactic = { id: member.id, title: member.title, score: tacScore, reasoning: buildCandidateReasoning(member.content, 'tactic', tacScore) };
        }
      }

      // Auto-select canonical: highest-scoring candidate across roles
      const candidates = [
        cluster.bestTemplate ? { ...cluster.bestTemplate, role: 'template' as ContentRoute } : null,
        cluster.bestExample ? { ...cluster.bestExample, role: 'example' as ContentRoute } : null,
        cluster.bestTactic ? { ...cluster.bestTactic, role: 'tactic' as ContentRoute } : null,
      ].filter(Boolean) as Array<ClusterCandidate & { role: ContentRoute }>;

      if (candidates.length > 0) {
        const best = candidates.reduce((a, b) => a.score > b.score ? a : b);
        cluster.canonicalId = best.id;
        cluster.canonicalRole = best.role;
        cluster.canonicalReasoning = best.reasoning;
      }

      clusters.push(cluster);
    }
  }

  return clusters;
}

/**
 * Build a resolution record for a cluster.
 */
export function resolveCluster(
  cluster: ContentCluster,
  canonicalId: string,
  canonicalRole: ContentRoute,
  reasoning: string,
): ClusterResolution {
  return {
    clusterId: cluster.id,
    canonicalResourceId: canonicalId,
    canonicalRole,
    reasoning,
    demotedMembers: cluster.members
      .filter(m => m.id !== canonicalId)
      .map(m => ({ id: m.id, duplicateOf: canonicalId })),
  };
}
