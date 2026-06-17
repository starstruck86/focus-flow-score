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

/**
 * Converts a KI record into a DojoScenario using the KI's own fields.
 * macro_situation -> prompt context, micro_strategy + example_usage -> benchmark,
 * how_to_execute -> rubric.
 */
export function generateKIDrill(ki: KnowledgeItemForDrill): KIDrillScenario {
  const skillFocus = deriveSkillFocus(ki.chapter);

  const situationContext = [
    ki.macro_situation,
    ki.when_to_use ? `This play applies when: ${ki.when_to_use}` : null,
    ki.framework ? `Framework: ${ki.framework}` : null,
    ki.who ? `Source: ${ki.who}` : null,
  ].filter(Boolean).join('\n\n');

  const challenge = ki.tactic_summary.length > 200
    ? ki.tactic_summary.substring(0, 200) + '...'
    : ki.tactic_summary;

  const idealResponse = [
    ki.micro_strategy,
    ki.example_usage ? `Example: ${ki.example_usage}` : null,
    ki.what_this_unlocks ? `What this unlocks: ${ki.what_this_unlocks}` : null,
  ].filter(Boolean).join('\n\n');

  const rubric = [
    ki.how_to_execute ? `Execution steps:\n${ki.how_to_execute}` : null,
    ki.when_not_to_use ? `Avoid when: ${ki.when_not_to_use}` : null,
    ki.why_it_matters ? `Why this matters: ${ki.why_it_matters}` : null,
  ].filter(Boolean).join('\n\n');

  const title = ki.tactic_summary.length > 80
    ? ki.tactic_summary.substring(0, 77) + '...'
    : ki.tactic_summary;

  return {
    id: `ki-${ki.id}`,
    skillFocus,
    title,
    context: situationContext || ki.tactic_summary,
    objection: `Apply this play: ${challenge}`,
    difficulty: 'intermediate',
    tags: [ki.chapter, ki.spider_dimension ?? 'general'].filter(Boolean) as string[],
    source: 'ki_library',
    ki_source_id: ki.id,
    ki_ideal_response: idealResponse,
    ki_rubric: rubric,
  };
}
