/**
 * Dynamic action ranking — reorders stage actions based on
 * persona, competitor, context, and available assets.
 */

import type { StageAction } from './stageConfig';
import type { RankedResource } from './resourceRanking';

interface RankContext {
  persona: string;
  competitor: string;
  hasContext: boolean;
  templates: RankedResource[];
  knowledgeItems: RankedResource[];
}

// Persona → action affinity map
const PERSONA_AFFINITY: Record<string, string[]> = {
  cfo: ['roi-summary', 'cfo-email', 'pricing-call-prep', 'business-case'],
  finance: ['roi-summary', 'cfo-email', 'pricing-call-prep', 'business-case'],
  'vp finance': ['roi-summary', 'cfo-email', 'business-case'],
  champion: ['champion-email', 'business-case', 'mutual-action-plan', 'stakeholder-map'],
  'vp marketing': ['discovery-plan', 'demo-prep', 'recap-email'],
  'vp sales': ['roi-summary', 'business-case', 'demo-prep'],
  procurement: ['procurement-email', 'security-questionnaire'],
  it: ['security-questionnaire', 'procurement-email'],
  security: ['security-questionnaire', 'procurement-email'],
  cto: ['security-questionnaire', 'demo-prep', 'roi-summary'],
  ciso: ['security-questionnaire', 'procurement-email'],
};

export function rankActions(
  actions: StageAction[],
  ctx: RankContext,
): StageAction[] {
  const scores = new Map<string, number>();

  for (const a of actions) {
    let score = 0;

    // Persona affinity
    const pLower = ctx.persona.toLowerCase();
    for (const [persona, affinityIds] of Object.entries(PERSONA_AFFINITY)) {
      if (pLower.includes(persona)) {
        const idx = affinityIds.indexOf(a.id);
        if (idx !== -1) score += (affinityIds.length - idx) * 5;
      }
    }

    // Competitor present boosts competitive actions
    if (ctx.competitor) {
      if (a.id.includes('pricing') || a.id.includes('roi') || a.id.includes('business-case')) {
        score += 3;
      }
    }

    // Context present boosts generation-heavy actions
    if (ctx.hasContext) {
      if (a.id.includes('recap') || a.id.includes('prep') || a.id.includes('plan')) {
        score += 2;
      }
    }

    // Asset availability — boost actions that have matching templates/knowledge
    const promptLower = a.systemPrompt.toLowerCase();
    for (const t of ctx.templates) {
      if (t.reasons.some(r => r.toLowerCase().includes('action type'))) {
        score += 2;
      }
    }
    for (const k of ctx.knowledgeItems) {
      const kText = `${k.title} ${k.body}`.toLowerCase();
      if (promptLower.includes('roi') && kText.includes('roi')) score += 1;
      if (promptLower.includes('discovery') && kText.includes('discovery')) score += 1;
      if (promptLower.includes('pricing') && kText.includes('pricing')) score += 1;
    }

    scores.set(a.id, score);
  }

  return [...actions].sort((a, b) => (scores.get(b.id) || 0) - (scores.get(a.id) || 0));
}
