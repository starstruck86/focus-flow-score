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

  // Weighted combination: opening matters most, structure is tiebreaker
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

const TEMPLATE_STRUCTURE_SIGNALS = [
  /\[.*?(name|company|title|role|date|amount|product).*?\]/i,
  /\{.*?(name|company|title|role|date|amount|product).*?\}/i,
  /step\s*\d|phase\s*\d|part\s*\d/i,
  /^[-•*]\s+/m,
  /subject\s*:/i,
  /agenda\s*:/i,
  /\d+\.\s+[A-Z]/m,
];

const EXAMPLE_STRUCTURE_SIGNALS = [
  /^(hi|hey|hello|dear|good morning|good afternoon)\s/im,
  /we (discussed|talked|agreed|reviewed|covered)/i,
  /thank you for|thanks for|appreciate your/i,
  /I (wanted|wanted to|am writing|am reaching|am following)/i,
  /best regards|sincerely|cheers|thanks,?\s*$/im,
  /next steps?\s*:/i,
];

const TACTIC_STRUCTURE_SIGNALS = [
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

  // Template: structural reusability
  const tplHits = TEMPLATE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (tplHits >= 2 && content.length >= 200) routes.push('template');

  // Example: reads like real communication
  const exHits = EXAMPLE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (exHits >= 2 && content.length >= 150) routes.push('example');

  // Tactic: HARDENED — require stronger evidence of direct actionability
  const tacHits = TACTIC_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  const descHits = DESCRIPTIVE_SIGNALS.filter(p => p.test(content)).length;
  // Require at least 2 tactic signals AND not overwhelmed by descriptive signals
  if (tacHits >= 2 && descHits < tacHits) {
    routes.push('tactic');
  } else if (tacHits >= 3 && content.length >= 200) {
    // Very strong tactic signal overrides descriptive context
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

/**
 * Shape raw content into a reusable template body:
 * - Preserve reusable structure (placeholders, steps, sections)
 * - Normalize placeholders to consistent format
 * - Strip commentary and explanation
 * - Keep only reusable body
 */
export function shapeAsTemplate(content: string): string {
  let shaped = content;

  // Normalize placeholders: {company} → [Company], various formats → consistent
  shaped = shaped.replace(/\{(\w+)\}/g, (_, name) => `[${name.charAt(0).toUpperCase() + name.slice(1)}]`);

  // Strip commentary lines (lines starting with "Note:", "Comment:", "//", etc.)
  shaped = shaped.replace(/^(note|comment|explanation|context|background|tip|reminder)\s*:.*$/gim, '');
  shaped = shaped.replace(/^\/\/.*$/gm, '');
  shaped = shaped.replace(/^\(.*?\)\s*$/gm, ''); // parenthetical notes on their own line

  // Strip meta-headers like "Template:", "Email Template:", "Draft:"
  shaped = shaped.replace(/^(template|email template|draft|version \d+)\s*:?\s*$/gim, '');

  // Collapse excessive blank lines
  shaped = shaped.replace(/\n{3,}/g, '\n\n');

  return shaped.trim();
}

/**
 * Shape raw content into a realistic example:
 * - Preserve narrative flow (greeting → body → CTA → closing)
 * - Remove notes/meta text
 * - Keep opening, body, CTA, closing
 */
export function shapeAsExample(content: string): string {
  let shaped = content;

  // Remove meta/notes lines
  shaped = shaped.replace(/^(note|comment|internal|draft note|meta|context)\s*:.*$/gim, '');
  shaped = shaped.replace(/^\/\/.*$/gm, '');
  shaped = shaped.replace(/^\[?(internal|draft|wip|todo)\]?\s*$/gim, '');

  // Remove tracking/version headers
  shaped = shaped.replace(/^(version|v\d+|last updated|status)\s*:.*$/gim, '');

  // Collapse excessive blank lines
  shaped = shaped.replace(/\n{3,}/g, '\n\n');

  return shaped.trim();
}

// ── Content Clustering ─────────────────────────────────────

export interface ContentCluster {
  id: string;
  members: Array<{ id: string; title: string; content: string; similarity: number }>;
  bestTemplate?: { id: string; title: string; score: number };
  bestExample?: { id: string; title: string; score: number };
  bestTactic?: { id: string; title: string; score: number };
}

/**
 * Group resources into clusters by content similarity.
 * Each cluster contains resources with pairwise similarity > threshold.
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
      // Score candidates for each role
      for (const member of cluster.members) {
        const routes = routeByContent(member.content);
        const tplHits = TEMPLATE_STRUCTURE_SIGNALS.filter(p => p.test(member.content)).length;
        const exHits = EXAMPLE_STRUCTURE_SIGNALS.filter(p => p.test(member.content)).length;
        const tacHits = TACTIC_STRUCTURE_SIGNALS.filter(p => p.test(member.content)).length;

        if (routes.includes('template') && (!cluster.bestTemplate || tplHits > cluster.bestTemplate.score)) {
          cluster.bestTemplate = { id: member.id, title: member.title, score: tplHits };
        }
        if (routes.includes('example') && (!cluster.bestExample || exHits > cluster.bestExample.score)) {
          cluster.bestExample = { id: member.id, title: member.title, score: exHits };
        }
        if (routes.includes('tactic') && (!cluster.bestTactic || tacHits > cluster.bestTactic.score)) {
          cluster.bestTactic = { id: member.id, title: member.title, score: tacHits };
        }
      }

      clusters.push(cluster);
    }
  }

  return clusters;
}
