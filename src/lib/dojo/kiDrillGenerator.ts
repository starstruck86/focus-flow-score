import type { DojoScenario, SkillFocus } from '@/lib/dojo/scenarios';

export interface KnowledgeItemForDrill {
  id: string;
  chapter: string;
  spider_dimension: string | null;
  tactic_summary: string;
  macro_situation: string | null;
  micro_strategy: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  how_to_execute: string | null;
  example_usage: string | null;
  why_it_matters: string | null;
  what_this_unlocks: string | null;
  framework: string | null;
  who: string | null;
}

/**
 * Derives SkillFocus from KI chapter. Falls back to 'objection_handling'.
 */
function deriveSkillFocus(chapter: string): SkillFocus {
  const map: Record<string, SkillFocus> = {
    discovery: 'discovery',
    cold_calling: 'objection_handling',
    social_selling: 'objection_handling',
    stakeholder_navigation: 'deal_control',
    personas: 'executive_response',
    messaging: 'objection_handling',
    demo: 'objection_handling',
    closing: 'deal_control',
    negotiation: 'deal_control',
    follow_up: 'deal_control',
    pipeline_management: 'deal_control',
    objection_handling: 'objection_handling',
    expansion: 'deal_control',
    account_strategy: 'deal_control',
    coaching: 'discovery',
    qualification: 'qualification',
  };
  return map[chapter] ?? 'objection_handling';
}

export type KIDrillScenario = DojoScenario & {
  ki_source_id: string;
  ki_ideal_response: string;
  ki_rubric: string;
  tags?: string[];
  source?: string;
};

export function generateKIDrill(ki: KnowledgeItemForDrill): DojoScenario & {
  ki_source_id: string;
  ki_ideal_response: string;
  ki_rubric: string;
} {
  const skillFocus = deriveSkillFocus(ki.chapter);

  // The scenario context: what's happening in the call
  // Use macro_situation to set the scene without revealing the play
  const situationContext = [
    ki.macro_situation,
    ki.when_to_use ? `Situation: ${ki.when_to_use}` : null,
    ki.framework ? `Framework context: ${ki.framework}` : null,
  ].filter(Boolean).join('\n\n');

  // The challenge: a realistic buyer moment — NO mention of the play or tactic
  // Derived from the situation, NOT from tactic_summary
  const chapterChallenges: Record<string, string> = {
    discovery: 'The prospect just made a statement about their current situation. How do you respond to deepen the conversation?',
    cold_calling: 'You just reached the prospect. They answered. What do you say?',
    objection_handling: 'The buyer just raised an objection. How do you handle it?',
    closing: 'The buyer seems hesitant about moving forward. How do you respond?',
    negotiation: 'The buyer is pushing back on terms. How do you respond?',
    stakeholder_navigation: 'You need to navigate a complex stakeholder situation. What do you do?',
    messaging: 'The buyer asked you to explain your value. How do you respond?',
    follow_up: 'You need to follow up after the last meeting. What do you say?',
    demo: 'The buyer is watching your demo and asks a pointed question. How do you respond?',
    expansion: 'The existing customer raises a concern about expanding. How do you respond?',
    personas: 'You are engaging a specific type of buyer. How do you tailor your approach?',
    qualification: 'You need to qualify this opportunity. What do you ask or say?',
  };
  const challenge = chapterChallenges[ki.chapter] ?? 'Respond to this sales situation.';

  // The ideal response benchmark: the actual KI play — used for scoring ONLY, hidden during drill
  const idealResponse = [
    ki.micro_strategy,
    ki.example_usage ? `Talk track example: ${ki.example_usage}` : null,
    ki.what_this_unlocks ? `What this achieves: ${ki.what_this_unlocks}` : null,
  ].filter(Boolean).join('\n\n');

  // The grading rubric: KI execution steps — used for scoring ONLY
  const rubric = [
    ki.tactic_summary ? `The play being tested: ${ki.tactic_summary}` : null,
    ki.how_to_execute ? `Execution steps:\n${ki.how_to_execute}` : null,
    ki.when_not_to_use ? `Avoid when: ${ki.when_not_to_use}` : null,
    ki.why_it_matters ? `Why this matters: ${ki.why_it_matters}` : null,
  ].filter(Boolean).join('\n\n');

  return {
    id: `ki-${ki.id}`,
    title: `${ki.chapter.replace(/_/g, ' ')} · ${ki.framework ?? 'Practice'}`,
    skillFocus,
    context: situationContext || `You are in a ${ki.chapter.replace(/_/g, ' ')} situation.`,
    objection: challenge,
    difficulty: 'intermediate' as const,
    tags: [ki.chapter, ki.spider_dimension ?? 'general'].filter(Boolean),
    source: 'ki_library',
    ki_source_id: ki.id,
    ki_ideal_response: idealResponse,
    ki_rubric: rubric,
  } as any;
}
