/**
 * Structured Tagging System
 *
 * Operational tags for resources and knowledge items.
 *
 * TAG PRIORITY TIERS:
 *   REQUIRED for operational use: skill, context
 *   IMPORTANT when applicable:   competitor, product
 *   OPTIONAL / nice to have:     persona, stage, signal
 *
 * "needs_tagging" in readiness only means missing REQUIRED tags.
 */

// ── Tag Dimensions ──────────────────────────────────────────

export type TagDimension = 'skill' | 'context' | 'competitor' | 'product' | 'persona' | 'stage' | 'signal';

export type TagTier = 'required' | 'important' | 'optional';

export interface StructuredTag {
  dimension: TagDimension;
  value: string;
  inherited?: boolean;
}

export const TAG_TIERS: Record<TagDimension, TagTier> = {
  skill: 'required',
  context: 'required',
  competitor: 'important',
  product: 'important',
  persona: 'optional',
  stage: 'optional',
  signal: 'optional',
};

export const REQUIRED_DIMENSIONS: TagDimension[] = ['skill', 'context'];
export const IMPORTANT_DIMENSIONS: TagDimension[] = ['competitor', 'product'];

// ── Known Tags ──────────────────────────────────────────────

export const SKILL_TAGS = [
  'cold_calling', 'discovery', 'demo', 'pricing', 'objection_handling',
  'negotiation', 'follow_up', 'account_strategy', 'closing', 'messaging',
  'stakeholder_navigation', 'expansion', 'personas',
] as const;

export const CONTEXT_TAGS = [
  'cold_call', 'discovery_call', 'demo', 'pricing_call', 'objection_response',
  'follow_up_email', 'meeting_prep', 'account_research', 'roleplay',
] as const;

export const COMPETITOR_TAGS = [
  'klaviyo', 'braze', 'salesforce', 'hubspot', 'outreach', 'salesloft',
  'gong', 'chorus', 'clari', 'drift', 'intercom', 'zendesk',
  'marketo', 'pardot', 'mailchimp', 'iterable', 'attentive',
  'postscript', 'yotpo', 'smile.io', 'nosto',
] as const;

export const PRODUCT_TAGS = [
  'segmentation', 'automation', 'analytics', 'integrations',
  'personalization', 'messaging_channels', 'loyalty', 'retention',
] as const;

export const PERSONA_TAGS = [
  'vp_marketing', 'lifecycle_marketing_manager', 'cmo',
  'ecommerce_lead', 'director_marketing', 'growth_lead',
  'head_of_retention', 'marketing_ops',
] as const;

export const STAGE_TAGS = [
  'prospecting', 'early_discovery', 'late_discovery', 'demo_stage',
  'pricing_stage', 'negotiation_stage', 'closing_stage',
] as const;

export const SIGNAL_TAGS = [
  'high_intent', 'expansion', 'churn_risk', 'competitive_displacement',
  'new_logo', 'renewal',
] as const;

// ── Patterns (skill, product, persona, stage) ──────────────

const SKILL_PATTERNS: Array<{ tag: string; patterns: RegExp[]; minMatches?: number }> = [
  { tag: 'cold_calling', patterns: [/cold call/i, /outbound/i, /opener/i, /dial/i, /gatekeeper/i, /voicemail/i] },
  { tag: 'discovery', patterns: [/discovery/i, /pain point/i, /qualifying/i, /excavat/i] },
  { tag: 'objection_handling', patterns: [/objection/i, /pushback/i, /rebuttal/i, /overcome/i] },
  { tag: 'negotiation', patterns: [/negotiat/i, /discount/i, /concession/i, /anchor/i] },
  { tag: 'closing', patterns: [/clos(e|ing)\s+(the\s+)?deal/i, /urgency/i, /ask.*for.*business/i] },
  { tag: 'messaging', patterns: [/messaging/i, /value.*prop/i, /positioning/i, /pitch/i, /narrative/i] },
  { tag: 'demo', patterns: [/\bdemo\b/i, /product.*show/i, /walkthrough/i] },
  { tag: 'pricing', patterns: [/pricing/i, /budget/i], minMatches: 2 },
  { tag: 'follow_up', patterns: [/follow.up/i, /next step/i, /after.*call/i] },
  { tag: 'account_strategy', patterns: [/account.*strat/i, /territory/i, /account.*plan/i] },
  { tag: 'stakeholder_navigation', patterns: [/stakeholder/i, /multi.thread/i, /buying committee/i] },
  { tag: 'expansion', patterns: [/expan(d|sion)/i, /upsell/i, /cross.sell/i] },
  { tag: 'personas', patterns: [/persona/i, /buyer.*profile/i, /champion/i, /economic.*buyer/i] },
];

const PRODUCT_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'segmentation', patterns: [/segment/i, /audience/i, /cohort/i] },
  { tag: 'automation', patterns: [/automat/i, /workflow/i, /journey/i] },
  { tag: 'analytics', patterns: [/analytic/i, /dashboard/i] },
  { tag: 'integrations', patterns: [/integrat/i] },
  { tag: 'personalization', patterns: [/personali[sz]/i] },
  { tag: 'messaging_channels', patterns: [/\bemail\b/i, /\bsms\b/i, /push notification/i] },
  { tag: 'loyalty', patterns: [/loyalt/i, /reward/i] },
];

// Persona and stage patterns require stronger evidence
const PERSONA_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'vp_marketing', patterns: [/vp.*market/i, /vice president.*market/i] },
  { tag: 'cmo', patterns: [/\bcmo\b/i, /chief marketing/i] },
  { tag: 'lifecycle_marketing_manager', patterns: [/lifecycle.*market/i, /retention.*manager/i] },
  { tag: 'ecommerce_lead', patterns: [/ecommerce.*lead/i, /head.*ecommerce/i] },
];

const STAGE_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'prospecting', patterns: [/prospect/i] },
  { tag: 'early_discovery', patterns: [/first.*call/i, /initial.*discovery/i] },
  { tag: 'demo_stage', patterns: [/\bdemo\b/i] },
  { tag: 'pricing_stage', patterns: [/pricing/i, /proposal/i] },
  { tag: 'negotiation_stage', patterns: [/negotiat/i, /contract/i] },
  { tag: 'closing_stage', patterns: [/clos(e|ing)\s+deal/i] },
];

// ── Tag Inference ──────────────────────────────────────────

/**
 * Infer structured tags from text content.
 * Uses confidence thresholds per dimension to avoid noisy tagging.
 * - Required/important dims: inferred confidently from pattern matches
 * - Optional dims (persona/stage/signal): only inferred with strong evidence
 */
export function inferTags(text: string): StructuredTag[] {
  if (!text || text.length < 50) return [];
  const sample = text.slice(0, 10000); // cap analysis to first 10k chars
  const tags: StructuredTag[] = [];
  const seen = new Set<string>();

  const add = (dim: TagDimension, val: string) => {
    const key = `${dim}:${val}`;
    if (!seen.has(key)) { seen.add(key); tags.push({ dimension: dim, value: val }); }
  };

  // Skills (required) — single pattern match sufficient
  for (const { tag, patterns, minMatches } of SKILL_PATTERNS) {
    const matchCount = patterns.filter(p => p.test(sample)).length;
    if (matchCount >= (minMatches ?? 1)) add('skill', tag);
  }

  // Competitors (important) — exact name match
  for (const c of COMPETITOR_TAGS) {
    const regex = new RegExp(`\\b${c.replace('.', '\\.')}\\b`, 'i');
    if (regex.test(sample)) add('competitor', c);
  }

  // Product areas (important)
  for (const { tag, patterns } of PRODUCT_PATTERNS) {
    if (patterns.some(p => p.test(sample))) add('product', tag);
  }

  // Contexts (required) — derived from skills
  const skillValues = new Set(tags.filter(t => t.dimension === 'skill').map(t => t.value));
  if (skillValues.has('cold_calling')) add('context', 'cold_call');
  if (skillValues.has('discovery')) add('context', 'discovery_call');
  if (skillValues.has('demo')) add('context', 'demo');
  if (skillValues.has('pricing')) add('context', 'pricing_call');
  if (skillValues.has('objection_handling')) add('context', 'objection_response');
  if (skillValues.has('follow_up')) add('context', 'follow_up_email');

  // Personas (optional) — require STRONG evidence: at least the specific title mentioned
  for (const { tag, patterns } of PERSONA_PATTERNS) {
    if (patterns.some(p => p.test(sample))) add('persona', tag);
  }

  // Stages (optional) — only if clearly about that stage, not just a mention
  // Skip auto-inference for stages — too noisy from general sales content

  // Signals (optional) — only strong signals
  if (/high.intent/i.test(sample)) add('signal', 'high_intent');
  if (/churn.*risk/i.test(sample) || /at.risk.*churn/i.test(sample)) add('signal', 'churn_risk');
  if (/competitive.*displac/i.test(sample)) add('signal', 'competitive_displacement');

  return tags;
}

// ── Utilities ──────────────────────────────────────────────

export function tagsToFlat(tags: StructuredTag[]): string[] {
  return tags.map(t => `${t.dimension}:${t.value}`);
}

export function parseFlatTags(flat: string[]): StructuredTag[] {
  return flat
    .filter(t => t.includes(':'))
    .map(t => {
      const [dimension, ...rest] = t.split(':');
      return { dimension: dimension as TagDimension, value: rest.join(':') };
    });
}

export function groupTagsByDimension(flat: string[]): Map<TagDimension, string[]> {
  const map = new Map<TagDimension, string[]>();
  for (const tag of flat) {
    if (!tag.includes(':')) continue;
    const [dim, ...rest] = tag.split(':');
    const d = dim as TagDimension;
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(rest.join(':'));
  }
  return map;
}

export function mergeTags(existing: string[], inferred: StructuredTag[]): string[] {
  const set = new Set(existing);
  for (const tag of inferred) {
    set.add(`${tag.dimension}:${tag.value}`);
  }
  return [...set];
}

export function hasTag(tags: string[], dimension: TagDimension, value: string): boolean {
  return tags.includes(`${dimension}:${value}`);
}

export function getTagValues(tags: string[], dimension: TagDimension): string[] {
  return tags.filter(t => t.startsWith(`${dimension}:`)).map(t => t.slice(dimension.length + 1));
}

export function getDimensionLabel(dim: TagDimension): string {
  const labels: Record<TagDimension, string> = {
    skill: 'Skill', context: 'Context', competitor: 'Competitor',
    product: 'Product', persona: 'Persona', stage: 'Stage', signal: 'Signal',
  };
  return labels[dim];
}

export function getDimensionColor(dim: TagDimension): string {
  switch (dim) {
    case 'skill': return 'bg-primary/10 text-primary';
    case 'context': return 'bg-accent text-accent-foreground';
    case 'competitor': return 'bg-destructive/10 text-destructive';
    case 'product': return 'bg-secondary text-secondary-foreground';
    case 'persona': return 'bg-muted text-muted-foreground';
    case 'stage': return 'bg-primary/5 text-primary';
    case 'signal': return 'bg-destructive/5 text-destructive';
    default: return 'bg-muted text-muted-foreground';
  }
}

export function getDimensionTier(dim: TagDimension): TagTier {
  return TAG_TIERS[dim];
}
