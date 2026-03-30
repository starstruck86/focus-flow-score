/**
 * Resource Auto-Classifier — determines the best role for a resource.
 *
 * Roles:
 *   template  — reusable structure (emails, frameworks, agendas)
 *   example   — strong real output worth referencing
 *   knowledge — atomic tactic / insight / principle
 *   reference — low-leverage supporting material
 */

export type ResourceRole = 'template' | 'example' | 'knowledge' | 'reference';

export type RoleConfidence = 'high' | 'medium' | 'low';

export interface ClassificationResult {
  role: ResourceRole;
  confidence: RoleConfidence;
  reason: string;
  detectedUseCase: string | null;
  signals: string[];
}

interface ClassifiableResource {
  id: string;
  title: string;
  content: string | null;
  description: string | null;
  resource_type: string;
  is_template: boolean | null;
  template_category: string | null;
  tags: string[] | null;
  content_length?: number | null;
  enrichment_status: string;
  is_strong_example?: boolean;
}

// ── Pattern banks ──────────────────────────────────────────

const TEMPLATE_PATTERNS = [
  /\[.*name.*\]/i, /\[.*company.*\]/i, /\{.*\}/,
  /subject\s*line/i, /dear\s/i, /hi\s\[/i,
  /step\s*\d/i, /agenda/i, /template/i,
  /follow.up/i, /recap/i, /email/i,
  /mutual.*action.*plan/i, /business.*case/i,
];

const KNOWLEDGE_PATTERNS = [
  /always\s/i, /never\s/i, /best\s*practice/i,
  /principle/i, /framework/i, /rule\s*of/i,
  /key\s*insight/i, /tactic/i, /strategy/i,
  /objection/i, /rebuttal/i, /discovery/i,
  /positioning/i, /value\s*prop/i, /battlecard/i,
];

const EXAMPLE_PATTERNS = [
  /sent\s*to/i, /actual/i, /real\s/i,
  /closed.*won/i, /worked.*well/i, /strong\s*example/i,
  /case\s*study/i, /won\s*deal/i,
];

const USE_CASE_MAP: Record<string, RegExp[]> = {
  'Discovery': [/discovery/i, /qualifying/i, /pain.*point/i],
  'Demo': [/demo/i, /presentation/i, /walkthrough/i],
  'Pricing / ROI': [/pric/i, /roi/i, /business.*case/i, /cfo/i],
  'Outbound': [/outbound/i, /cold/i, /prospecting/i, /cadence/i],
  'Follow-up / Recap': [/follow.up/i, /recap/i, /after.*call/i],
  'Competitive': [/competitor/i, /versus/i, /battlecard/i],
  'Closing': [/clos/i, /negotiat/i, /contract/i],
  'Executive / CFO': [/executive/i, /cfo/i, /cxo/i, /vp\s/i],
  'Champion': [/champion/i, /internal.*sell/i, /alignment/i],
  'Procurement / Legal': [/procurement/i, /legal/i, /security/i, /it\s*review/i],
};

// ── Classifier ─────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter(p => p.test(text)).length;
}

function detectUseCase(text: string): string | null {
  let best: string | null = null;
  let bestCount = 0;
  for (const [useCase, patterns] of Object.entries(USE_CASE_MAP)) {
    const c = countMatches(text, patterns);
    if (c > bestCount) { best = useCase; bestCount = c; }
  }
  return bestCount >= 1 ? best : null;
}

export function classifyResource(r: ClassifiableResource): ClassificationResult {
  // Already explicitly marked
  if (r.is_template || r.resource_type === 'template') {
    return {
      role: 'template',
      confidence: 'high',
      reason: 'Explicitly marked as template',
      detectedUseCase: r.template_category || detectUseCase(r.title + ' ' + (r.description || '')),
      signals: ['is_template flag set'],
    };
  }

  const text = [r.title, r.description, r.content?.slice(0, 3000)].filter(Boolean).join('\n');
  const len = r.content_length || (r.content?.length ?? 0);
  const signals: string[] = [];

  const templateHits = countMatches(text, TEMPLATE_PATTERNS);
  const knowledgeHits = countMatches(text, KNOWLEDGE_PATTERNS);
  const exampleHits = countMatches(text, EXAMPLE_PATTERNS);

  if (templateHits > 0) signals.push(`${templateHits} template signals`);
  if (knowledgeHits > 0) signals.push(`${knowledgeHits} knowledge signals`);
  if (exampleHits > 0) signals.push(`${exampleHits} example signals`);

  // Structured short-form → template candidate
  const isStructured = /^(subject|to|from|hi|dear|step|agenda)/im.test(text) && len < 5000;
  if (isStructured) signals.push('structured short-form');

  // Long conceptual → knowledge
  const isConceptual = len > 500 && knowledgeHits >= 2;
  if (isConceptual) signals.push('conceptual long-form');

  // Short raw / messy → reference
  const isRaw = len < 200 && templateHits === 0 && knowledgeHits === 0 && exampleHits === 0;
  if (isRaw) signals.push('short/raw content');

  // Score
  const scores: Record<ResourceRole, number> = {
    template: templateHits * 3 + (isStructured ? 4 : 0),
    example: exampleHits * 3 + ((r as any).is_strong_example ? 6 : 0),
    knowledge: knowledgeHits * 2 + (isConceptual ? 3 : 0),
    reference: isRaw ? 5 : 1,
  };

  const sorted = (Object.entries(scores) as [ResourceRole, number][])
    .sort((a, b) => b[1] - a[1]);

  const [topRole, topScore] = sorted[0];
  const [, secondScore] = sorted[1];

  const confidence: RoleConfidence =
    topScore >= 6 ? 'high' :
    topScore >= 3 && topScore > secondScore ? 'medium' : 'low';

  const reasonParts: string[] = [];
  if (topRole === 'template') reasonParts.push('Structured reusable format detected');
  if (topRole === 'example') reasonParts.push('Looks like a real output / strong prior work');
  if (topRole === 'knowledge') reasonParts.push('Contains tactics, principles, or frameworks');
  if (topRole === 'reference') reasonParts.push('Supporting material without clear reuse pattern');

  return {
    role: topRole,
    confidence,
    reason: reasonParts.join('. ') || 'Auto-classified by content analysis',
    detectedUseCase: detectUseCase(text),
    signals,
  };
}

// Bulk classify
export function classifyResources(resources: ClassifiableResource[]): Map<string, ClassificationResult> {
  const map = new Map<string, ClassificationResult>();
  for (const r of resources) {
    map.set(r.id, classifyResource(r));
  }
  return map;
}
