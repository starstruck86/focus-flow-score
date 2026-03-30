/**
 * Relevance-ranked resource fetching for Prep Command Center.
 * Scores templates, examples, and knowledge items against current workflow context.
 */

import { supabase } from '@/integrations/supabase/client';

export interface RankedResource {
  id: string;
  title: string;
  type: 'template' | 'example' | 'knowledge_item';
  body: string;
  score: number;
  reasons: string[];
}

interface RankingContext {
  userId: string;
  actionId: string;
  stage?: string;
  persona?: string;
  competitor?: string;
  contextText?: string;
}

function scoreMatch(value: string | null | undefined, target: string | undefined): number {
  if (!value || !target) return 0;
  const v = value.toLowerCase();
  const t = target.toLowerCase();
  if (v === t) return 1;
  if (v.includes(t) || t.includes(v)) return 0.6;
  return 0;
}

function contextKeywordScore(text: string, contextText: string): number {
  if (!contextText || !text) return 0;
  const contextWords = new Set(
    contextText.toLowerCase().split(/\W+/).filter(w => w.length > 3)
  );
  const textWords = text.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  if (textWords.length === 0) return 0;
  const matches = textWords.filter(w => contextWords.has(w)).length;
  return Math.min(matches / Math.max(contextWords.size, 1), 1);
}

function recencyScore(dateStr: string | null): number {
  if (!dateStr) return 0;
  const age = Date.now() - new Date(dateStr).getTime();
  const days = age / (1000 * 60 * 60 * 24);
  if (days < 7) return 1;
  if (days < 30) return 0.7;
  if (days < 90) return 0.4;
  return 0.1;
}

// Map action IDs to relevant output_type patterns and keywords
const ACTION_RELEVANCE: Record<string, { outputTypes: string[]; keywords: string[] }> = {
  'discovery-plan': { outputTypes: ['discovery_prep_sheet'], keywords: ['discovery', 'plan', 'research', 'prep'] },
  'discovery-questions': { outputTypes: ['discovery_prep_sheet'], keywords: ['discovery', 'questions', 'pain', 'qualify'] },
  'prep-for-call': { outputTypes: ['discovery_prep_sheet', 'demo_prep_sheet', 'meeting_agenda'], keywords: ['call', 'prep', 'meeting', 'agenda'] },
  'recap-email': { outputTypes: ['discovery_recap_email'], keywords: ['recap', 'email', 'summary', 'follow-up'] },
  'pricing-call-prep': { outputTypes: ['pricing_followup_email', 'executive_brief'], keywords: ['pricing', 'value', 'roi', 'negotiation'] },
  'cfo-email': { outputTypes: ['executive_followup_email', 'pricing_followup_email'], keywords: ['cfo', 'executive', 'roi', 'finance'] },
  'roi-summary': { outputTypes: ['executive_brief', 'pricing_followup_email'], keywords: ['roi', 'business case', 'value', 'impact', 'cost'] },
};

export async function fetchRankedResources(ctx: RankingContext): Promise<{
  templates: RankedResource[];
  examples: RankedResource[];
  knowledgeItems: RankedResource[];
}> {
  const actionMeta = ACTION_RELEVANCE[ctx.actionId] || { outputTypes: [], keywords: [] };

  // Fetch all three resource types in parallel
  const [templatesRes, examplesRes, kiRes] = await Promise.all([
    supabase
      .from('execution_templates')
      .select('id, title, body, output_type, stage, persona, competitor, tone, times_used, last_used_at, is_favorite, is_pinned, status, tags')
      .eq('user_id', ctx.userId)
      .eq('status', 'active')
      .order('times_used', { ascending: false })
      .limit(20),
    supabase
      .from('execution_outputs')
      .select('id, title, content, output_type, stage, persona, competitor, is_strong_example, times_reused, created_at')
      .eq('user_id', ctx.userId)
      .eq('is_strong_example', true)
      .order('times_reused', { ascending: false })
      .limit(15),
    supabase
      .from('knowledge_items')
      .select('id, title, tactic_summary, when_to_use, when_not_to_use, chapter, tags, confidence_score, updated_at')
      .eq('user_id', ctx.userId)
      .eq('active', true)
      .order('confidence_score', { ascending: false })
      .limit(20),
  ]);

  // Score templates
  const templates: RankedResource[] = (templatesRes.data || []).map(t => {
    let score = 0;
    const reasons: string[] = [];

    // Output type match
    if (actionMeta.outputTypes.includes(t.output_type)) { score += 3; reasons.push('Matches action type'); }

    // Field matches
    const stageScore = scoreMatch(t.stage, ctx.stage);
    if (stageScore > 0) { score += stageScore * 2; reasons.push('Stage match'); }
    const personaScore = scoreMatch(t.persona, ctx.persona);
    if (personaScore > 0) { score += personaScore * 2; reasons.push('Persona match'); }
    const competitorScore = scoreMatch(t.competitor, ctx.competitor);
    if (competitorScore > 0) { score += competitorScore * 2.5; reasons.push('Competitor match'); }

    // Usage
    if (t.times_used > 0) { score += Math.min(t.times_used / 5, 1); reasons.push(`Used ${t.times_used}x`); }
    if (t.is_favorite) { score += 1; reasons.push('Favorite'); }
    if (t.is_pinned) { score += 0.5; reasons.push('Pinned'); }

    // Recency
    const rec = recencyScore(t.last_used_at);
    if (rec > 0.5) { score += rec; reasons.push('Recently used'); }

    // Keyword match from context
    if (ctx.contextText) {
      const kwScore = contextKeywordScore(t.body, ctx.contextText);
      if (kwScore > 0.1) { score += kwScore * 2; reasons.push('Context keyword match'); }
    }

    // Tag overlap with action keywords
    if (t.tags?.length) {
      const tagHits = t.tags.filter(tag => actionMeta.keywords.some(kw => tag.toLowerCase().includes(kw))).length;
      if (tagHits > 0) { score += tagHits * 0.5; reasons.push('Tag match'); }
    }

    return { id: t.id, title: t.title, type: 'template', body: t.body.slice(0, 500), score, reasons };
  });

  // Score examples
  const examples: RankedResource[] = (examplesRes.data || []).map(o => {
    let score = 0;
    const reasons: string[] = [];

    if (actionMeta.outputTypes.includes(o.output_type)) { score += 3; reasons.push('Matches action type'); }
    const stageScore = scoreMatch(o.stage, ctx.stage);
    if (stageScore > 0) { score += stageScore * 2; reasons.push('Stage match'); }
    const personaScore = scoreMatch(o.persona, ctx.persona);
    if (personaScore > 0) { score += personaScore * 2; reasons.push('Persona match'); }
    const competitorScore = scoreMatch(o.competitor, ctx.competitor);
    if (competitorScore > 0) { score += competitorScore * 2.5; reasons.push('Competitor match'); }
    if (o.times_reused > 0) { score += Math.min(o.times_reused / 3, 1); reasons.push(`Reused ${o.times_reused}x`); }
    const rec = recencyScore(o.created_at);
    if (rec > 0.3) { score += rec * 0.5; reasons.push('Recent'); }

    return { id: o.id, title: o.title, type: 'example', body: o.content.slice(0, 500), score, reasons };
  });

  // Score knowledge items
  const knowledgeItems: RankedResource[] = (kiRes.data || []).map(k => {
    let score = 0;
    const reasons: string[] = [];

    // Chapter / action relevance
    const chapterLower = k.chapter?.toLowerCase() || '';
    if (actionMeta.keywords.some(kw => chapterLower.includes(kw))) { score += 2; reasons.push('Chapter matches action'); }

    // Confidence
    if (k.confidence_score >= 0.7) { score += 1.5; reasons.push('High confidence'); }
    else if (k.confidence_score >= 0.55) { score += 0.8; }

    // Tags
    if (k.tags?.length) {
      const tagHits = k.tags.filter(tag => actionMeta.keywords.some(kw => tag.toLowerCase().includes(kw))).length;
      if (tagHits > 0) { score += tagHits * 0.5; reasons.push('Tag match'); }
    }

    // Context keyword match
    const fullText = `${k.title} ${k.tactic_summary || ''} ${k.when_to_use || ''}`;
    if (ctx.contextText) {
      const kwScore = contextKeywordScore(fullText, ctx.contextText);
      if (kwScore > 0.1) { score += kwScore * 2; reasons.push('Context keyword match'); }
    }
    if (ctx.stage) {
      const stageHit = scoreMatch(fullText, ctx.stage);
      if (stageHit > 0) { score += stageHit; reasons.push('Stage relevance'); }
    }
    if (ctx.competitor) {
      const compHit = scoreMatch(fullText, ctx.competitor);
      if (compHit > 0) { score += compHit * 1.5; reasons.push('Competitor relevance'); }
    }

    const rec = recencyScore(k.updated_at);
    if (rec > 0.5) { score += rec * 0.5; }

    return {
      id: k.id,
      title: k.title,
      type: 'knowledge_item',
      body: k.tactic_summary || k.when_to_use || k.title,
      score,
      reasons,
    };
  });

  // Sort by score descending, return top results
  templates.sort((a, b) => b.score - a.score);
  examples.sort((a, b) => b.score - a.score);
  knowledgeItems.sort((a, b) => b.score - a.score);

  return {
    templates: templates.slice(0, 3),
    examples: examples.slice(0, 3),
    knowledgeItems: knowledgeItems.slice(0, 5),
  };
}
