/**
 * Structured Tagging System
 *
 * Operational tags for resources and knowledge items.
 * Tags are structured across dimensions: skill, context, competitor, product, persona, stage, signal.
 */

// ── Tag Dimensions ──────────────────────────────────────────

export type TagDimension = 'skill' | 'context' | 'competitor' | 'product' | 'persona' | 'stage' | 'signal';

export interface StructuredTag {
  dimension: TagDimension;
  value: string;
  inherited?: boolean; // true if propagated from resource → knowledge item
}

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

// ── Tag Inference ──────────────────────────────────────────

const SKILL_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'cold_calling', patterns: [/cold call/i, /outbound/i, /opener/i, /dial/i, /gatekeeper/i, /voicemail/i] },
  { tag: 'discovery', patterns: [/discovery/i, /pain point/i, /qualifying/i, /excavat/i] },
  { tag: 'objection_handling', patterns: [/objection/i, /pushback/i, /rebuttal/i, /overcome/i] },
  { tag: 'negotiation', patterns: [/negotiat/i, /discount/i, /concession/i, /anchor/i] },
  { tag: 'closing', patterns: [/clos(e|ing)/i, /urgency/i, /commitment/i, /ask.*for.*business/i] },
  { tag: 'messaging', patterns: [/messaging/i, /value.*prop/i, /positioning/i, /pitch/i, /narrative/i] },
  { tag: 'demo', patterns: [/demo/i, /product.*show/i, /walkthrough/i] },
  { tag: 'pricing', patterns: [/pricing/i, /price/i, /cost/i, /budget/i] },
  { tag: 'follow_up', patterns: [/follow.up/i, /next step/i, /after.*call/i] },
  { tag: 'account_strategy', patterns: [/account.*strat/i, /territory/i, /account.*plan/i] },
  { tag: 'stakeholder_navigation', patterns: [/stakeholder/i, /multi.thread/i, /executive/i, /buying committee/i] },
  { tag: 'expansion', patterns: [/expan(d|sion)/i, /upsell/i, /cross.sell/i, /renewal/i] },
  { tag: 'personas', patterns: [/persona/i, /buyer.*profile/i, /champion/i, /economic.*buyer/i] },
];

const PRODUCT_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'segmentation', patterns: [/segment/i, /audience/i, /cohort/i] },
  { tag: 'automation', patterns: [/automat/i, /flow/i, /workflow/i, /journey/i] },
  { tag: 'analytics', patterns: [/analytic/i, /report/i, /dashboard/i, /metric/i] },
  { tag: 'integrations', patterns: [/integrat/i, /api/i, /connect/i] },
  { tag: 'personalization', patterns: [/personali[sz]/i] },
  { tag: 'messaging_channels', patterns: [/email/i, /sms/i, /push notification/i] },
  { tag: 'loyalty', patterns: [/loyalt/i, /reward/i, /retention/i] },
];

const PERSONA_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'vp_marketing', patterns: [/vp.*market/i, /vice president.*market/i] },
  { tag: 'cmo', patterns: [/\bcmo\b/i, /chief marketing/i] },
  { tag: 'lifecycle_marketing_manager', patterns: [/lifecycle/i, /retention.*manager/i] },
  { tag: 'ecommerce_lead', patterns: [/ecommerce.*lead/i, /head.*ecommerce/i, /ecom.*director/i] },
];

const STAGE_PATTERNS: Array<{ tag: string; patterns: RegExp[] }> = [
  { tag: 'prospecting', patterns: [/prospect/i, /outbound/i, /cold/i] },
  { tag: 'early_discovery', patterns: [/first.*call/i, /initial.*discovery/i, /qualify/i] },
  { tag: 'demo_stage', patterns: [/demo/i, /product.*present/i] },
  { tag: 'pricing_stage', patterns: [/pricing/i, /proposal/i, /quote/i] },
  { tag: 'negotiation_stage', patterns: [/negotiat/i, /contract/i, /redline/i] },
  { tag: 'closing_stage', patterns: [/clos(e|ing)/i, /sign/i, /commit/i] },
];

/**
 * Infer structured tags from text content.
 */
export function inferTags(text: string): StructuredTag[] {
  if (!text || text.length < 50) return [];
  const lower = text.toLowerCase();
  const tags: StructuredTag[] = [];

  // Skills
  for (const { tag, patterns } of SKILL_PATTERNS) {
    if (patterns.some(p => p.test(lower))) {
      tags.push({ dimension: 'skill', value: tag });
    }
  }

  // Competitors
  for (const c of COMPETITOR_TAGS) {
    if (lower.includes(c.toLowerCase())) {
      tags.push({ dimension: 'competitor', value: c });
    }
  }

  // Product areas
  for (const { tag, patterns } of PRODUCT_PATTERNS) {
    if (patterns.some(p => p.test(lower))) {
      tags.push({ dimension: 'product', value: tag });
    }
  }

  // Personas
  for (const { tag, patterns } of PERSONA_PATTERNS) {
    if (patterns.some(p => p.test(lower))) {
      tags.push({ dimension: 'persona', value: tag });
    }
  }

  // Deal stages
  for (const { tag, patterns } of STAGE_PATTERNS) {
    if (patterns.some(p => p.test(lower))) {
      tags.push({ dimension: 'stage', value: tag });
    }
  }

  // Infer contexts from skills
  const skillValues = new Set(tags.filter(t => t.dimension === 'skill').map(t => t.value));
  if (skillValues.has('cold_calling')) tags.push({ dimension: 'context', value: 'cold_call' });
  if (skillValues.has('discovery')) tags.push({ dimension: 'context', value: 'discovery_call' });
  if (skillValues.has('demo')) tags.push({ dimension: 'context', value: 'demo' });
  if (skillValues.has('pricing')) tags.push({ dimension: 'context', value: 'pricing_call' });
  if (skillValues.has('objection_handling')) tags.push({ dimension: 'context', value: 'objection_response' });
  if (skillValues.has('follow_up')) tags.push({ dimension: 'context', value: 'follow_up_email' });

  // Signals
  if (/high.intent/i.test(lower)) tags.push({ dimension: 'signal', value: 'high_intent' });
  if (/churn/i.test(lower)) tags.push({ dimension: 'signal', value: 'churn_risk' });
  if (/displac/i.test(lower) || /competitive.*switch/i.test(lower)) tags.push({ dimension: 'signal', value: 'competitive_displacement' });

  return tags;
}

/**
 * Convert structured tags to flat string array for storage.
 * Format: "dimension:value"
 */
export function tagsToFlat(tags: StructuredTag[]): string[] {
  return tags.map(t => `${t.dimension}:${t.value}`);
}

/**
 * Parse flat tag strings back to structured tags.
 */
export function parseFlatTags(flat: string[]): StructuredTag[] {
  return flat
    .filter(t => t.includes(':'))
    .map(t => {
      const [dimension, ...rest] = t.split(':');
      return { dimension: dimension as TagDimension, value: rest.join(':') };
    });
}

/**
 * Get tags grouped by dimension from a flat array.
 */
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

/**
 * Merge existing tags with newly inferred tags (deduplicates).
 */
export function mergeTags(existing: string[], inferred: StructuredTag[]): string[] {
  const set = new Set(existing);
  for (const tag of inferred) {
    set.add(`${tag.dimension}:${tag.value}`);
  }
  return [...set];
}

/**
 * Check if tags include a specific dimension:value.
 */
export function hasTag(tags: string[], dimension: TagDimension, value: string): boolean {
  return tags.includes(`${dimension}:${value}`);
}

/**
 * Get all values for a given dimension from flat tags.
 */
export function getTagValues(tags: string[], dimension: TagDimension): string[] {
  return tags
    .filter(t => t.startsWith(`${dimension}:`))
    .map(t => t.slice(dimension.length + 1));
}

/**
 * Get dimension label for display.
 */
export function getDimensionLabel(dim: TagDimension): string {
  const labels: Record<TagDimension, string> = {
    skill: 'Skill',
    context: 'Context',
    competitor: 'Competitor',
    product: 'Product',
    persona: 'Persona',
    stage: 'Stage',
    signal: 'Signal',
  };
  return labels[dim];
}

/**
 * Get color for dimension (tailwind classes using semantic tokens).
 */
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
