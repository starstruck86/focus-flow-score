/**
 * Sales Context Model — Phase 2
 *
 * A lightweight context object that drives context-aware knowledge retrieval,
 * meeting prep, and Dave grounding. Used across prep, roleplay, and coaching.
 */

import { queryKnowledge, type KnowledgeQuery } from './knowledgeRetrieval';
import type { KnowledgeItem } from '@/hooks/useKnowledgeItems';
import { createLogger } from '@/lib/logger';

const log = createLogger('SalesContext');

// ── Context Model ───────────────────────────────────────────

export interface SalesContext {
  account_name?: string;
  competitors?: string[];
  product_areas?: string[];
  stage?: string;
  persona?: string;
  context_type?: string; // cold_call, discovery_call, demo, pricing_call, etc.
}

// ── Context-Aware Retrieval ─────────────────────────────────

/**
 * Retrieve knowledge items ranked by contextual relevance.
 *
 * Strategy: fetch a broader set, then score + rank client-side.
 * This avoids over-filtering with AND logic in the DB query.
 */
export async function queryKnowledgeByContext(
  ctx: SalesContext,
  opts?: { maxItems?: number },
): Promise<KnowledgeItem[]> {
  const max = opts?.maxItems ?? 25;

  // Build tag filters for the DB query (light filtering)
  const tags: string[] = [];
  if (ctx.context_type) tags.push(`context:${ctx.context_type}`);

  // Fetch active items with light filters — broader pool
  const items = await queryKnowledge({
    activeOnly: true,
    tags: tags.length ? tags : undefined,
    maxItems: Math.min(max * 3, 60), // fetch extra to rank
    context: 'prep',
  });

  // Also fetch competitor-specific items separately if competitor set
  let competitorItems: KnowledgeItem[] = [];
  if (ctx.competitors?.length) {
    const promises = ctx.competitors.map(c =>
      queryKnowledge({ activeOnly: true, competitor: c, maxItems: 15 }),
    );
    const results = await Promise.all(promises);
    competitorItems = results.flat();
  }

  // Merge & dedupe
  const seen = new Set<string>();
  const pool: KnowledgeItem[] = [];
  for (const item of [...items, ...competitorItems]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      pool.push(item);
    }
  }

  // Score each item for context relevance
  const scored = pool.map(item => ({
    item,
    score: scoreRelevance(item, ctx),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, max).map(s => s.item);
}

function scoreRelevance(item: KnowledgeItem, ctx: SalesContext): number {
  let score = item.confidence_score; // base: 0-100

  const tags = item.tags ?? [];
  const tagSet = new Set(tags);

  // Context type match: +30
  if (ctx.context_type && tagSet.has(`context:${ctx.context_type}`)) score += 30;

  // Competitor match: +25
  if (ctx.competitors?.length) {
    for (const c of ctx.competitors) {
      if (item.competitor_name?.toLowerCase() === c.toLowerCase()) score += 25;
      if (tagSet.has(`competitor:${c.toLowerCase()}`)) score += 15;
    }
  }

  // Product area match: +20
  if (ctx.product_areas?.length) {
    for (const p of ctx.product_areas) {
      if (item.product_area?.toLowerCase() === p.toLowerCase()) score += 20;
      if (tagSet.has(`product:${p.toLowerCase()}`)) score += 10;
    }
  }

  // Stage match: +15
  if (ctx.stage && tagSet.has(`stage:${ctx.stage}`)) score += 15;

  // Persona match: +10
  if (ctx.persona && tagSet.has(`persona:${ctx.persona}`)) score += 10;

  // Skill tag relevance (context_type → skill mapping)
  const ctxSkillMap: Record<string, string[]> = {
    cold_call: ['cold_calling', 'messaging', 'objection_handling'],
    discovery_call: ['discovery', 'stakeholder_navigation'],
    demo: ['demo', 'messaging', 'personas'],
    pricing_call: ['pricing', 'negotiation', 'objection_handling'],
    objection_response: ['objection_handling'],
    follow_up_email: ['follow_up', 'messaging'],
    meeting_prep: ['account_strategy', 'discovery'],
    account_research: ['account_strategy'],
  };
  const relevantSkills = ctx.context_type ? ctxSkillMap[ctx.context_type] ?? [] : [];
  for (const skill of relevantSkills) {
    if (tagSet.has(`skill:${skill}`) || item.chapter === skill) score += 10;
  }

  return score;
}

// ── Meeting Prep Generator ──────────────────────────────────

export interface PrepOutput {
  context_summary: string;
  focus_areas: string[];
  recommended_tactics: string[];
  risks: string[];
  talk_tracks: string[];
  competitive_angles: string[];
  questions_to_ask: string[];
  grounded_item_count: number;
  source_items: Array<{ id: string; title: string; chapter: string }>;
}

export async function generatePrep(ctx: SalesContext): Promise<PrepOutput> {
  const items = await queryKnowledgeByContext(ctx, { maxItems: 20 });

  log.info('Prep generation', { context: ctx, itemCount: items.length });

  const contextParts: string[] = [];
  if (ctx.context_type) contextParts.push(ctx.context_type.replace(/_/g, ' '));
  if (ctx.account_name) contextParts.push(`with ${ctx.account_name}`);
  if (ctx.competitors?.length) contextParts.push(`vs ${ctx.competitors.join(', ')}`);
  if (ctx.stage) contextParts.push(`at ${ctx.stage.replace(/_/g, ' ')} stage`);
  if (ctx.persona) contextParts.push(`targeting ${ctx.persona.replace(/_/g, ' ')}`);

  const context_summary = contextParts.length
    ? contextParts.join(' · ')
    : 'General preparation';

  const focus_areas: string[] = [];
  const recommended_tactics: string[] = [];
  const risks: string[] = [];
  const talk_tracks: string[] = [];
  const competitive_angles: string[] = [];
  const questions_to_ask: string[] = [];

  for (const item of items) {
    // Focus areas from chapter alignment
    const chapterLabel = item.chapter.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (!focus_areas.includes(chapterLabel)) focus_areas.push(chapterLabel);

    // Tactics
    if (item.tactic_summary) {
      recommended_tactics.push(`${item.title}: ${item.tactic_summary}`);
    }

    // Risks / anti-patterns
    if (item.when_not_to_use) {
      risks.push(item.when_not_to_use);
    }

    // Talk tracks
    if (item.example_usage) {
      talk_tracks.push(item.example_usage);
    }

    // Competitive angles
    if (item.knowledge_type === 'competitive' && item.competitor_name) {
      const angle = item.tactic_summary || item.title;
      competitive_angles.push(`vs ${item.competitor_name}: ${angle}`);
    }

    // Discovery questions from when_to_use
    if (item.when_to_use && (item.chapter === 'discovery' || item.chapter === 'stakeholder_navigation')) {
      questions_to_ask.push(item.when_to_use);
    }
  }

  // If no explicit questions, generate from context
  if (questions_to_ask.length === 0 && ctx.context_type === 'discovery_call') {
    questions_to_ask.push('What\'s driving the timeline for evaluating solutions?');
    questions_to_ask.push('Who else is involved in this decision?');
    questions_to_ask.push('What happens if you don\'t solve this?');
  }

  return {
    context_summary,
    focus_areas: focus_areas.slice(0, 5),
    recommended_tactics: recommended_tactics.slice(0, 8),
    risks: risks.slice(0, 5),
    talk_tracks: talk_tracks.slice(0, 6),
    competitive_angles: competitive_angles.slice(0, 5),
    questions_to_ask: questions_to_ask.slice(0, 6),
    grounded_item_count: items.length,
    source_items: items.map(i => ({ id: i.id, title: i.title, chapter: i.chapter })),
  };
}

// ── Auto-Suggest Context ────────────────────────────────────

/**
 * Suggest likely context fields from partial input.
 * Lightweight — uses existing tag vocabulary.
 */
export function suggestContext(partial: Partial<SalesContext>): Partial<SalesContext> {
  const suggestions: Partial<SalesContext> = {};

  // If competitor is set but no context_type, suggest competitive scenarios
  if (partial.competitors?.length && !partial.context_type) {
    suggestions.context_type = 'pricing_call';
  }

  // Stage → context_type mapping
  if (partial.stage && !partial.context_type) {
    const stageCtxMap: Record<string, string> = {
      prospecting: 'cold_call',
      early_discovery: 'discovery_call',
      late_discovery: 'discovery_call',
      demo_stage: 'demo',
      pricing_stage: 'pricing_call',
      negotiation_stage: 'pricing_call',
      closing_stage: 'pricing_call',
    };
    if (stageCtxMap[partial.stage]) suggestions.context_type = stageCtxMap[partial.stage];
  }

  return suggestions;
}
