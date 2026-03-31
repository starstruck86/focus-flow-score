/**
 * Content Signature & Content-First Similarity
 * 
 * All dedup/routing/promotion decisions use content, not titles.
 * Titles are labels only.
 */

// ── Content Signature ──────────────────────────────────────

export function generateContentSignature(content: string | null | undefined): string {
  if (!content) return '';
  return content
    .slice(0, 500)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Token-based Content Similarity (Dice coefficient) ─────

export function contentSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const sigA = generateContentSignature(a);
  const sigB = generateContentSignature(b);
  if (!sigA || !sigB) return 0;

  const wordsA = new Set(sigA.split(' ').filter(w => w.length > 2));
  const wordsB = new Set(sigB.split(' ').filter(w => w.length > 2));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return (2 * intersection) / (wordsA.size + wordsB.size);
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

// ── Content-based Routing ──────────────────────────────────

export type ContentRoute = 'template' | 'example' | 'tactic' | 'reference';

const TEMPLATE_STRUCTURE_SIGNALS = [
  /\[.*?(name|company|title|role|date|amount|product).*?\]/i,  // placeholders
  /\{.*?(name|company|title|role|date|amount|product).*?\}/i,  // mustache placeholders
  /step\s*\d|phase\s*\d|part\s*\d/i,                           // numbered steps
  /^[-•*]\s+/m,                                                 // bullet lists
  /subject\s*:/i,                                               // email subject line
  /agenda\s*:/i,                                                // agenda marker
  /\d+\.\s+[A-Z]/m,                                            // numbered list with caps
];

const EXAMPLE_STRUCTURE_SIGNALS = [
  /^(hi|hey|hello|dear|good morning|good afternoon)\s/im,       // greeting
  /we (discussed|talked|agreed|reviewed|covered)/i,             // narrative past tense
  /thank you for|thanks for|appreciate your/i,                  // gratitude pattern
  /I (wanted|wanted to|am writing|am reaching|am following)/i,  // first person narrative
  /best regards|sincerely|cheers|thanks,?\s*$/im,               // sign-off
  /next steps?\s*:/i,                                           // next steps block
];

const TACTIC_STRUCTURE_SIGNALS = [
  /\bwhen\s+(the|a|your|they|you|it)\b/i,                      // conditional trigger
  /\binstead of\b.*\btry\b/i,                                  // reframe pattern
  /\b(respond|handle|counter|address)\s+(by|with|using)\b/i,    // action instruction
  /\bif\s+(they|the prospect|the buyer|your)\b/i,               // conditional logic
  /\b(technique|approach|method)\s*:/i,                         // labeled method
  /\b(why|because|this works because)\b/i,                      // reasoning
  /["'""].{10,}["'""]$/m,                                       // quoted talk track
];

export function routeByContent(content: string): ContentRoute[] {
  if (!content || content.length < 50) return ['reference'];

  const routes: ContentRoute[] = [];

  // Template: structural reusability (placeholders, steps, formatted sections)
  const tplHits = TEMPLATE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (tplHits >= 2 && content.length >= 200) routes.push('template');

  // Example: reads like real communication
  const exHits = EXAMPLE_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (exHits >= 2 && content.length >= 150) routes.push('example');

  // Tactic: instructional/reasoning content
  const tacHits = TACTIC_STRUCTURE_SIGNALS.filter(p => p.test(content)).length;
  if (tacHits >= 2 || (tacHits >= 1 && content.length >= 300)) routes.push('tactic');

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
    // Show structured sections: find first placeholder or step
    const placeholderMatch = content.match(/\[.*?\]|\{.*?\}/);
    const stepMatch = content.match(/step\s*\d[^]*?(?=step\s*\d|$)/i);
    if (stepMatch) {
      return stepMatch[0].slice(0, maxLen).replace(/\n+/g, ' ').trim() + '…';
    }
    if (placeholderMatch && placeholderMatch.index !== undefined) {
      const start = Math.max(0, placeholderMatch.index - 40);
      return '…' + content.slice(start, start + maxLen).replace(/\n+/g, ' ').trim() + '…';
    }
    // Fallback: first non-empty lines
    const lines = content.split('\n').filter(l => l.trim().length > 5).slice(0, 3);
    return lines.join(' | ').slice(0, maxLen);
  }

  if (route === 'example') {
    // Opening + body: first greeting line + next substantive line
    const lines = content.split('\n').filter(l => l.trim().length > 5);
    const opening = lines.slice(0, 2).join(' ');
    if (opening.length > maxLen) return opening.slice(0, maxLen) + '…';
    return opening || content.slice(0, maxLen);
  }

  if (route === 'tactic') {
    // Find the action unit: "when X, do Y" or quoted talk track
    const whenMatch = content.match(/when\s+(the|a|your|they)[^.]*\./i);
    const quoteMatch = content.match(/["'""][^"'""]{10,}["'""]/);
    if (whenMatch) {
      return whenMatch[0].slice(0, maxLen);
    }
    if (quoteMatch) {
      return quoteMatch[0].slice(0, maxLen);
    }
    // Fallback: first sentence with action verb
    const sentences = content.split(/[.!?]\s+/);
    const actionSentence = sentences.find(s =>
      /\b(ask|say|use|try|respond|frame|handle|counter)\b/i.test(s)
    );
    return (actionSentence || sentences[0] || '').slice(0, maxLen);
  }

  // Reference / fallback
  return content.slice(0, maxLen).replace(/\n+/g, ' ').trim();
}
