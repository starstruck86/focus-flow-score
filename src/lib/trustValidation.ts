/**
 * Trust Validation Layer
 * 
 * 5-gate validation before auto-activation:
 *  1. Specificity — not generic/vague
 *  2. Actionability — can be said/asked/written/used
 *  3. Distinctness — not duplicate of existing items
 *  4. Use-case clarity — has clear when/where to apply
 *  5. Phrasing quality — realistic, not AI-sounding
 * 
 * Also provides duplicate suppression and resource routing.
 */

import type { KnowledgeItemInsert } from '@/hooks/useKnowledgeItems';

// ── Gate 1: Specificity ────────────────────────────────────

const GENERIC_PATTERNS = [
  /^(it is|this is|there are|we need|you should|they will|one must)/i,
  /^(important|key|critical|essential|necessary|vital|crucial)\b/i,
  /\b(in general|generally speaking|as a rule|typically|usually)\b/i,
  /\b(various|several|many|numerous|multiple) (ways|methods|approaches|strategies)\b/i,
  /\b(best practices?|industry standard|common approach)\b/i,
  /^(understanding|knowing|learning|being aware)\b/i,
];

function scoreSpecificity(text: string): { score: number; reason: string } {
  if (!text || text.length < 15) return { score: 0, reason: 'too_short' };

  let score = 0.5;

  // Penalize generic patterns
  const genericHits = GENERIC_PATTERNS.filter(p => p.test(text)).length;
  score -= genericHits * 0.15;

  // Reward specific details: numbers, quotes, named entities
  if (/\d+/.test(text)) score += 0.1;
  if (/["'"]/.test(text)) score += 0.15;
  if (/\b[A-Z][a-z]+(?:\s[A-Z][a-z]+)+\b/.test(text)) score += 0.1; // Named entities

  // Reward specific qualifying words
  if (/\b(exactly|specifically|precisely|particular)\b/i.test(text)) score += 0.1;

  // Penalize very short or very long
  if (text.length < 30) score -= 0.1;
  if (text.length > 400) score -= 0.05;

  return { score: Math.max(0, Math.min(1, score)), reason: genericHits > 0 ? 'generic_language' : 'ok' };
}

// ── Gate 2: Actionability ──────────────────────────────────

const ACTION_VERBS = /^(ask|say|write|send|use|open|start|frame|position|challenge|reframe|bridge|pivot|anchor|present|share|probe|dig|quantify|validate|confirm|set|build|create|map|identify|test|try|respond|handle|counter|address|lead|drive|close|follow|schedule|push|call|email|pitch|demonstrate|show|tailor|customize|leverage|highlight|reference|compare|contrast|qualify|disqualify|recap|summarize|draft|prepare|review|propose|negotiate|offer|deliver|request|schedule|outline|structure)/i;

const ACTION_INDICATORS = [
  /you (can|should|could|might|want to|need to)\s/i,
  /try (saying|asking|opening|using|framing|writing)/i,
  /(say|ask|write|respond)\s+(something like|with|by)/i,
  /instead of.*,?\s*(try|use|say)/i,
];

function scoreActionability(title: string, summary: string): { score: number; reason: string } {
  let score = 0.2;

  if (ACTION_VERBS.test(title)) score += 0.3;
  if (ACTION_VERBS.test(summary)) score += 0.2;

  const actionHits = ACTION_INDICATORS.filter(p => p.test(summary)).length;
  score += actionHits * 0.15;

  // Presence of direct speech / talk track
  if (/["'"]/.test(summary)) score += 0.15;

  return { score: Math.min(1, score), reason: score < 0.4 ? 'not_actionable' : 'ok' };
}

// ── Gate 3: Distinctness ───────────────────────────────────

function normalizeForDedup(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function computeSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeForDedup(a).split(' '));
  const wordsB = new Set(normalizeForDedup(b).split(' '));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  return (2 * intersection) / (wordsA.size + wordsB.size); // Dice coefficient
}

export function scoreDistinctness(
  newTitle: string,
  newSummary: string,
  existingItems: Array<{ title: string; tactic_summary?: string | null }>
): { score: number; reason: string; mostSimilar?: string } {
  if (existingItems.length === 0) return { score: 1, reason: 'no_existing' };

  const newText = `${newTitle} ${newSummary}`;
  let maxSimilarity = 0;
  let mostSimilarTitle = '';

  for (const existing of existingItems) {
    const existingText = `${existing.title} ${existing.tactic_summary || ''}`;
    const sim = computeSimilarity(newText, existingText);
    if (sim > maxSimilarity) {
      maxSimilarity = sim;
      mostSimilarTitle = existing.title;
    }
  }

  const distinctness = 1 - maxSimilarity;
  return {
    score: distinctness,
    reason: maxSimilarity > 0.6 ? 'too_similar' : 'ok',
    mostSimilar: maxSimilarity > 0.4 ? mostSimilarTitle : undefined,
  };
}

// ── Gate 4: Use-case Clarity ───────────────────────────────

function scoreUseCaseClarity(whenToUse: string | null, chapter: string): { score: number; reason: string } {
  if (!whenToUse || whenToUse.length < 10) return { score: 0.1, reason: 'missing_context' };

  let score = 0.3;

  // Has a specific trigger/moment
  if (/\b(when|after|before|during|if|once)\b/i.test(whenToUse)) score += 0.25;

  // References specific scenario
  if (/\b(prospect|customer|buyer|champion|executive|stakeholder)\b/i.test(whenToUse)) score += 0.15;

  // References specific stage
  if (/\b(discovery|demo|closing|negotiation|pricing|follow.up|outbound|renewal)\b/i.test(whenToUse)) score += 0.15;

  // Length indicates detail
  if (whenToUse.length >= 30) score += 0.1;

  // Chapter alignment
  const chapterWord = chapter.replace(/_/g, ' ');
  if (whenToUse.toLowerCase().includes(chapterWord)) score += 0.05;

  return { score: Math.min(1, score), reason: score < 0.4 ? 'vague_context' : 'ok' };
}

// ── Gate 5: Phrasing Quality ───────────────────────────────

const AI_FILLER_PATTERNS = [
  /\b(leverage|utilize|facilitate|synerg|paradigm|holistic|ecosystem)\b/i,
  /\b(comprehensive|robust|seamless|cutting.edge|state.of.the.art)\b/i,
  /\b(in today's|moving forward|at the end of the day|that being said)\b/i,
  /\b(it's worth noting|it should be noted|needless to say)\b/i,
];

const REALISTIC_PHRASING = [
  /["'"].*["'"]/,  // Contains direct speech
  /\b(hey|hi|so|yeah|look|honestly|frankly|actually)\b/i,  // Conversational markers
  /\?\s*$/,  // Ends with question
  /\b(their|your|my|our)\s+(team|company|org|process|pipeline)\b/i,
];

function scorePhrasingQuality(summary: string, example: string | null): { score: number; reason: string } {
  let score = 0.4;
  const text = `${summary} ${example || ''}`;

  // Penalize AI-sounding language
  const aiHits = AI_FILLER_PATTERNS.filter(p => p.test(text)).length;
  score -= aiHits * 0.15;

  // Reward realistic phrasing
  const realHits = REALISTIC_PHRASING.filter(p => p.test(text)).length;
  score += realHits * 0.15;

  // Reward presence of example usage
  if (example && example.length >= 20) score += 0.15;

  return { score: Math.max(0, Math.min(1, score)), reason: aiHits > 1 ? 'ai_sounding' : 'ok' };
}

// ── Combined Trust Score ───────────────────────────────────

export interface TrustValidation {
  specificity: { score: number; reason: string };
  actionability: { score: number; reason: string };
  distinctness: { score: number; reason: string; mostSimilar?: string };
  useCaseClarity: { score: number; reason: string };
  phrasingQuality: { score: number; reason: string };
  overall: number;
  passed: boolean;
  failedGates: string[];
}

const GATE_THRESHOLDS = {
  specificity: 0.35,
  actionability: 0.4,
  distinctness: 0.4,
  useCaseClarity: 0.3,
  phrasingQuality: 0.3,
};

export function validateTrust(
  item: {
    title: string;
    tactic_summary: string | null;
    when_to_use: string | null;
    example_usage: string | null;
    chapter: string;
  },
  existingItems: Array<{ title: string; tactic_summary?: string | null }>
): TrustValidation {
  const summary = item.tactic_summary || '';

  const specificity = scoreSpecificity(summary);
  const actionability = scoreActionability(item.title, summary);
  const distinctness = scoreDistinctness(item.title, summary, existingItems);
  const useCaseClarity = scoreUseCaseClarity(item.when_to_use, item.chapter);
  const phrasingQuality = scorePhrasingQuality(summary, item.example_usage);

  const failedGates: string[] = [];
  if (specificity.score < GATE_THRESHOLDS.specificity) failedGates.push('specificity');
  if (actionability.score < GATE_THRESHOLDS.actionability) failedGates.push('actionability');
  if (distinctness.score < GATE_THRESHOLDS.distinctness) failedGates.push('distinctness');
  if (useCaseClarity.score < GATE_THRESHOLDS.useCaseClarity) failedGates.push('use_case_clarity');
  if (phrasingQuality.score < GATE_THRESHOLDS.phrasingQuality) failedGates.push('phrasing_quality');

  const overall = (
    specificity.score * 0.2 +
    actionability.score * 0.3 +
    distinctness.score * 0.2 +
    useCaseClarity.score * 0.15 +
    phrasingQuality.score * 0.15
  );

  return {
    specificity,
    actionability,
    distinctness,
    useCaseClarity,
    phrasingQuality,
    overall,
    passed: failedGates.length === 0,
    failedGates,
  };
}

// ── Duplicate Suppression ──────────────────────────────────

export function deduplicateKnowledgeItems(
  newItems: KnowledgeItemInsert[],
  existingItems: Array<{ title: string; tactic_summary?: string | null }>
): { kept: KnowledgeItemInsert[]; duplicates: Array<{ item: KnowledgeItemInsert; similarTo: string }> } {
  const kept: KnowledgeItemInsert[] = [];
  const duplicates: Array<{ item: KnowledgeItemInsert; similarTo: string }> = [];
  const allExisting = [...existingItems];

  for (const item of newItems) {
    const { score, mostSimilar } = scoreDistinctness(
      item.title, item.tactic_summary || '', allExisting
    );

    if (score < 0.35 && mostSimilar) {
      duplicates.push({ item, similarTo: mostSimilar });
    } else {
      kept.push(item);
      // Add to existing pool to catch intra-batch dupes
      allExisting.push({ title: item.title, tactic_summary: item.tactic_summary });
    }
  }

  return { kept, duplicates };
}

export function deduplicateTemplates(
  newTitle: string,
  newBody: string,
  existingTemplates: Array<{ title: string; body?: string }>
): boolean {
  for (const existing of existingTemplates) {
    const titleSim = computeSimilarity(newTitle, existing.title);
    if (titleSim > 0.7) return true; // Title too similar

    if (existing.body) {
      const bodySim = computeSimilarity(newBody.slice(0, 300), existing.body.slice(0, 300));
      if (bodySim > 0.6) return true;
    }
  }
  return false;
}

export function deduplicateExamples(
  newTitle: string,
  newContent: string,
  existingExamples: Array<{ title: string; content?: string }>
): boolean {
  for (const existing of existingExamples) {
    const titleSim = computeSimilarity(newTitle, existing.title);
    if (titleSim > 0.7) return true;

    if (existing.content) {
      const contentSim = computeSimilarity(newContent.slice(0, 300), existing.content.slice(0, 300));
      if (contentSim > 0.6) return true;
    }
  }
  return false;
}

// ── Resource Routing ───────────────────────────────────────

export type ResourceOutputPath = 'template_candidate' | 'example_candidate' | 'tactic_candidate' | 'reference_only';

export interface ResourceRoute {
  path: ResourceOutputPath;
  confidence: number;
  reasons: string[];
}

const TEMPLATE_SIGNALS = [
  { pattern: /subject\s*:/i, weight: 0.2 },
  { pattern: /dear\s|hi\s\[|hello\s\[/i, weight: 0.15 },
  { pattern: /\[.*name.*\]|\[.*company.*\]|\{.*\}/i, weight: 0.2 },
  { pattern: /step\s*\d|phase\s*\d/i, weight: 0.15 },
  { pattern: /template|framework|playbook|checklist/i, weight: 0.15 },
  { pattern: /agenda|outline|structure/i, weight: 0.1 },
];

const EXAMPLE_SIGNALS = [
  { pattern: /follow.up|recap|thank you for/i, weight: 0.15 },
  { pattern: /we discussed|as we talked|per our conversation/i, weight: 0.2 },
  { pattern: /next steps?|action items?/i, weight: 0.15 },
  { pattern: /looking forward|excited to|pleased to/i, weight: 0.1 },
  { pattern: /^(hi|hey|hello|dear)\s/im, weight: 0.1 },
];

const TACTIC_SIGNALS = [
  { pattern: /\b(ask|say|use|try|respond|handle|frame|position)\b/i, weight: 0.1 },
  { pattern: /when\s+(the|a|your|they)/i, weight: 0.15 },
  { pattern: /objection|pushback|rebuttal/i, weight: 0.15 },
  { pattern: /discovery|qualifying|pain/i, weight: 0.1 },
  { pattern: /tactic|technique|approach|strategy/i, weight: 0.1 },
  { pattern: /talk\s*track|script|phrasing/i, weight: 0.15 },
];

export function routeResource(resource: {
  title: string;
  content: string | null;
  resource_type: string;
  tags?: string[];
  content_length?: number;
}): ResourceRoute {
  const text = `${resource.title} ${resource.content || ''}`;
  const contentLen = resource.content?.length || 0;

  // Score each path
  let templateScore = 0;
  const templateReasons: string[] = [];
  for (const s of TEMPLATE_SIGNALS) {
    if (s.pattern.test(text)) {
      templateScore += s.weight;
      templateReasons.push(s.pattern.source.slice(0, 20));
    }
  }
  // Templates need completeness: enough content and structure
  if (contentLen < 200) templateScore *= 0.3;
  if (contentLen > 500) templateScore += 0.1;

  let exampleScore = 0;
  const exampleReasons: string[] = [];
  for (const s of EXAMPLE_SIGNALS) {
    if (s.pattern.test(text)) {
      exampleScore += s.weight;
      exampleReasons.push(s.pattern.source.slice(0, 20));
    }
  }
  // Examples need realistic length
  if (contentLen < 150) exampleScore *= 0.3;

  let tacticScore = 0;
  const tacticReasons: string[] = [];
  for (const s of TACTIC_SIGNALS) {
    if (s.pattern.test(text)) {
      tacticScore += s.weight;
      tacticReasons.push(s.pattern.source.slice(0, 20));
    }
  }
  // Tactic-heavy content is often longer educational material
  if (contentLen > 300) tacticScore += 0.1;

  // Pick highest path
  const scores: Array<{ path: ResourceOutputPath; score: number; reasons: string[] }> = [
    { path: 'template_candidate', score: templateScore, reasons: templateReasons },
    { path: 'example_candidate', score: exampleScore, reasons: exampleReasons },
    { path: 'tactic_candidate', score: tacticScore, reasons: tacticReasons },
  ];

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // If no path scores well, route to reference
  if (best.score < 0.25) {
    return { path: 'reference_only', confidence: 1 - best.score, reasons: ['low_signal'] };
  }

  return { path: best.path, confidence: best.score, reasons: best.reasons };
}
