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

export type ActionBucket =
  | 'promote_template'
  | 'promote_example'
  | 'extract_knowledge'
  | 'manual_review'
  | 'reference_only';

export interface ClassificationResult {
  role: ResourceRole;
  actionBucket: ActionBucket;
  confidence: RoleConfidence;
  reason: string;
  detectedUseCases: string[];
  capabilities: string[];
  signals: string[];
  stuckReason: string | null;
}

export interface ClassifiableResource {
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
  content_classification?: string | null;
  failure_reason?: string | null;
  manual_input_required?: boolean;
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

const CAPABILITY_MAP: Record<string, RegExp[]> = {
  'roi_framing': [/roi/i, /return\s*on/i, /cost.*sav/i, /business.*case/i],
  'executive_messaging': [/executive/i, /cfo/i, /cxo/i, /vp\s/i, /c-suite/i],
  'objection_handling': [/objection/i, /pushback/i, /rebuttal/i, /overcome/i],
  'champion_enablement': [/champion/i, /internal.*sell/i, /alignment/i, /mobiliz/i],
  'discovery_questions': [/discovery/i, /question/i, /qualifying/i, /pain/i],
  'pricing_strategy': [/pric/i, /discount/i, /negotiat/i, /anchor/i],
  'procurement_support': [/procurement/i, /legal/i, /security/i, /compliance/i, /it\s*review/i],
};

// ── Classifier ─────────────────────────────────────────────

function countMatches(text: string, patterns: RegExp[]): number {
  return patterns.filter(p => p.test(text)).length;
}

function detectUseCases(text: string): string[] {
  const results: string[] = [];
  for (const [useCase, patterns] of Object.entries(USE_CASE_MAP)) {
    if (countMatches(text, patterns) >= 1) results.push(useCase);
  }
  return results;
}

function detectCapabilities(text: string): string[] {
  const results: string[] = [];
  for (const [cap, patterns] of Object.entries(CAPABILITY_MAP)) {
    if (countMatches(text, patterns) >= 1) results.push(cap);
  }
  return results;
}

function computeStuckReason(r: ClassifiableResource): string | null {
  if (r.failure_reason) return `Enrichment failed: ${r.failure_reason}`;
  if (r.manual_input_required) return 'Needs manual content input';
  const len = r.content_length || (r.content?.length ?? 0);
  if (len < 50) return 'Content too short for classification';
  if (!r.content && len === 0) return 'No content extracted';
  return null;
}

export function classifyResource(r: ClassifiableResource): ClassificationResult {
  const text = [r.title, r.description, r.content?.slice(0, 3000)].filter(Boolean).join('\n');
  const len = r.content_length || (r.content?.length ?? 0);
  const signals: string[] = [];
  const useCases = detectUseCases(text);
  const capabilities = detectCapabilities(text);
  const stuckReason = computeStuckReason(r);

  // Already explicitly marked as template
  if (r.is_template || r.resource_type === 'template') {
    return {
      role: 'template',
      actionBucket: 'promote_template',
      confidence: 'high',
      reason: 'Explicitly marked as template',
      detectedUseCases: useCases.length ? useCases : (r.template_category ? [r.template_category] : []),
      capabilities,
      signals: ['is_template flag set'],
      stuckReason: null,
    };
  }

  // If stuck, route to manual review
  if (stuckReason) {
    return {
      role: 'reference',
      actionBucket: 'manual_review',
      confidence: 'low',
      reason: stuckReason,
      detectedUseCases: useCases,
      capabilities,
      signals: ['stuck resource'],
      stuckReason,
    };
  }

  const templateHits = countMatches(text, TEMPLATE_PATTERNS);
  const knowledgeHits = countMatches(text, KNOWLEDGE_PATTERNS);
  const exampleHits = countMatches(text, EXAMPLE_PATTERNS);

  if (templateHits > 0) signals.push(`${templateHits} template signals`);
  if (knowledgeHits > 0) signals.push(`${knowledgeHits} knowledge signals`);
  if (exampleHits > 0) signals.push(`${exampleHits} example signals`);

  const isStructured = /^(subject|to|from|hi|dear|step|agenda)/im.test(text) && len < 5000;
  if (isStructured) signals.push('structured short-form');

  const isConceptual = len > 500 && knowledgeHits >= 2;
  if (isConceptual) signals.push('conceptual long-form');

  const isRaw = len < 200 && templateHits === 0 && knowledgeHits === 0 && exampleHits === 0;
  if (isRaw) signals.push('short/raw content');

  const scores: Record<ResourceRole, number> = {
    template: templateHits * 3 + (isStructured ? 4 : 0),
    example: exampleHits * 3 + (r.is_strong_example ? 6 : 0),
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

  // Map role → action bucket
  const actionBucket: ActionBucket =
    confidence === 'low' ? 'manual_review' :
    topRole === 'template' ? 'promote_template' :
    topRole === 'example' ? 'promote_example' :
    topRole === 'knowledge' ? 'extract_knowledge' :
    'reference_only';

  return {
    role: topRole,
    actionBucket,
    confidence,
    reason: reasonParts.join('. ') || 'Auto-classified by content analysis',
    detectedUseCases: useCases,
    capabilities,
    signals,
    stuckReason: null,
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

// ── Upside scoring ─────────────────────────────────────────

export interface UpsideScore {
  total: number;
  factors: string[];
}

export function computeUpsideScore(r: ClassifiableResource, c: ClassificationResult): UpsideScore {
  let total = 0;
  const factors: string[] = [];

  // Multi-use potential
  if (c.detectedUseCases.length >= 3) { total += 25; factors.push(`${c.detectedUseCases.length} use cases`); }
  else if (c.detectedUseCases.length >= 2) { total += 15; factors.push(`${c.detectedUseCases.length} use cases`); }
  else if (c.detectedUseCases.length === 1) { total += 5; }

  // Capability richness
  if (c.capabilities.length >= 3) { total += 20; factors.push(`${c.capabilities.length} capabilities`); }
  else if (c.capabilities.length >= 1) { total += 10; factors.push(`${c.capabilities.length} cap.`); }

  // Confidence
  if (c.confidence === 'high') { total += 25; factors.push('high confidence'); }
  else if (c.confidence === 'medium') { total += 10; }

  // Promotable role value
  if (c.role === 'template') { total += 15; factors.push('template-ready'); }
  else if (c.role === 'example') { total += 12; factors.push('example-ready'); }
  else if (c.role === 'knowledge') { total += 8; factors.push('knowledge-ready'); }

  // Content richness
  const len = r.content_length || 0;
  if (len > 2000) { total += 10; factors.push('rich content'); }
  else if (len > 500) { total += 5; }

  // Already strong example
  if (r.is_strong_example) { total += 10; factors.push('strong example'); }

  // Not stuck
  if (!c.stuckReason) { total += 5; factors.push('actionable'); }

  return { total: Math.min(100, total), factors };
}

// Bucket summary for header stats
export interface BucketSummary {
  promote_template: number;
  promote_example: number;
  extract_knowledge: number;
  manual_review: number;
  reference_only: number;
  topStuckReasons: string[];
}

export function summarizeBuckets(classifications: Map<string, ClassificationResult>): BucketSummary {
  const counts: Record<ActionBucket, number> = {
    promote_template: 0,
    promote_example: 0,
    extract_knowledge: 0,
    manual_review: 0,
    reference_only: 0,
  };
  const stuckReasons = new Map<string, number>();

  for (const c of classifications.values()) {
    counts[c.actionBucket]++;
    if (c.stuckReason) {
      stuckReasons.set(c.stuckReason, (stuckReasons.get(c.stuckReason) || 0) + 1);
    }
  }

  const topStuckReasons = [...stuckReasons.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([reason, count]) => `${reason} (${count})`);

  return { ...counts, topStuckReasons };
}
