/**
 * Template recommendation scoring engine
 */

import type { ExecutionTemplate, OutputType, TemplateRecommendation } from './executionTemplateTypes';

interface ScoringContext {
  outputType: OutputType;
  stage?: string;
  persona?: string;
  competitor?: string;
  accountName?: string;
}

export function scoreTemplates(
  templates: ExecutionTemplate[],
  ctx: ScoringContext,
): TemplateRecommendation[] {
  return templates
    .map(t => scoreOne(t, ctx))
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score);
}

function scoreOne(t: ExecutionTemplate, ctx: ScoringContext): TemplateRecommendation {
  let score = 0;
  const reasons: string[] = [];

  // Pinned / favorite boosts
  if (t.is_pinned) { score += 30; reasons.push('Pinned by you'); }
  if (t.is_favorite) { score += 15; reasons.push('Favorited'); }

  // Exact output type match
  if (t.output_type === ctx.outputType) {
    score += 40;
    reasons.push(`Matches ${ctx.outputType.replace(/_/g, ' ')}`);
  }

  // Stage match
  if (ctx.stage && t.stage && t.stage.toLowerCase() === ctx.stage.toLowerCase()) {
    score += 15;
    reasons.push(`Same stage: ${ctx.stage}`);
  }

  // Persona match
  if (ctx.persona && t.persona && t.persona.toLowerCase() === ctx.persona.toLowerCase()) {
    score += 10;
    reasons.push(`Same persona: ${ctx.persona}`);
  }

  // Competitor match
  if (ctx.competitor && t.competitor && t.competitor.toLowerCase() === ctx.competitor.toLowerCase()) {
    score += 12;
    reasons.push(`Competitor: ${ctx.competitor}`);
  }

  // Usage frequency
  if (t.times_used > 0) {
    const usageBoost = Math.min(t.times_used * 3, 20);
    score += usageBoost;
    reasons.push(`Used ${t.times_used} time${t.times_used > 1 ? 's' : ''}`);
  }

  // Success signal
  if (t.times_successful > 0) {
    score += Math.min(t.times_successful * 5, 25);
    reasons.push(`Marked successful ${t.times_successful}x`);
  }

  // Recency
  if (t.last_used_at) {
    const daysSince = (Date.now() - new Date(t.last_used_at).getTime()) / 86400000;
    if (daysSince < 7) { score += 10; reasons.push('Used recently'); }
    else if (daysSince < 30) { score += 5; }
  }

  // Quality
  if (t.quality_score && t.quality_score > 70) {
    score += 8;
    reasons.push('High quality');
  }

  return { template: t, score, reasons };
}
