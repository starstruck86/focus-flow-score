/**
 * Skill Builder — Curriculum Foundation
 *
 * Defines structured progression levels per skill.
 * Each level groups focus patterns that represent increasing sophistication.
 * This is the backbone of Skill Builder's progressive training.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface CurriculumLevel {
  level: number;
  name: string;
  description: string;
  focusPatterns: string[];
}

export interface SkillCurriculum {
  skill: SkillFocus;
  label: string;
  levels: CurriculumLevel[];
}

// ── Curriculum Definitions ────────────────────────────────────────

export const SKILL_CURRICULA: Record<SkillFocus, SkillCurriculum> = {
  objection_handling: {
    skill: 'objection_handling',
    label: 'Objection Handling',
    levels: [
      {
        level: 1,
        name: 'Surface Control',
        description: 'Stay calm and concise when objections hit. Don\'t ramble or over-explain.',
        focusPatterns: ['stay_concise_under_pressure', 'control_next_step'],
      },
      {
        level: 2,
        name: 'Isolation & Reframe',
        description: 'Surface the real concern before answering. Shift from feature/cost to impact.',
        focusPatterns: ['isolate_before_answering', 'reframe_to_business_impact'],
      },
      {
        level: 3,
        name: 'Proof & Precision',
        description: 'Anchor responses with concrete proof and drive to commitment.',
        focusPatterns: ['use_specific_proof', 'control_next_step'],
      },
    ],
  },
  discovery: {
    skill: 'discovery',
    label: 'Discovery',
    levels: [
      {
        level: 1,
        name: 'Surface Control',
        description: 'Ask singular questions. Don\'t stack. Let the buyer go deep.',
        focusPatterns: ['ask_singular_questions', 'deepen_one_level'],
      },
      {
        level: 2,
        name: 'Depth Creation',
        description: 'When the buyer gives a surface answer, push for cost and consequence.',
        focusPatterns: ['deepen_one_level', 'quantify_the_pain'],
      },
      {
        level: 3,
        name: 'Commercial Framing',
        description: 'Connect every problem to revenue, cost, or competitive risk.',
        focusPatterns: ['tie_to_business_impact', 'test_urgency'],
      },
      {
        level: 4,
        name: 'Strategic Discovery',
        description: 'Probe for timeline, trigger events, and urgency with precision.',
        focusPatterns: ['test_urgency', 'quantify_the_pain', 'tie_to_business_impact'],
      },
    ],
  },
  executive_response: {
    skill: 'executive_response',
    label: 'Executive Response',
    levels: [
      {
        level: 1,
        name: 'Brevity',
        description: 'Say it in 3 sentences or fewer. No hedging.',
        focusPatterns: ['cut_to_three_sentences', 'project_certainty'],
      },
      {
        level: 2,
        name: 'Number-Led',
        description: 'Open with a specific metric or outcome, not context.',
        focusPatterns: ['lead_with_the_number', 'anchor_to_their_priority'],
      },
      {
        level: 3,
        name: 'Executive Presence',
        description: 'Anchor to their priority, project certainty, and close with a specific ask.',
        focusPatterns: ['anchor_to_their_priority', 'close_with_a_specific_ask', 'project_certainty'],
      },
    ],
  },
  deal_control: {
    skill: 'deal_control',
    label: 'Deal Control',
    levels: [
      {
        level: 1,
        name: 'Next Step Control',
        description: 'End every conversation with a clear, time-bound next step.',
        focusPatterns: ['control_next_step', 'test_before_accepting'],
      },
      {
        level: 2,
        name: 'Risk Naming',
        description: 'Call out deal drift, stalling, or missing stakeholders directly.',
        focusPatterns: ['name_the_risk', 'create_urgency_without_pressure'],
      },
      {
        level: 3,
        name: 'Mutual Commitment',
        description: 'Define what both sides will do by when. Lock the deal mechanics.',
        focusPatterns: ['lock_mutual_commitment', 'name_the_risk', 'test_before_accepting'],
      },
    ],
  },
  qualification: {
    skill: 'qualification',
    label: 'Qualification',
    levels: [
      {
        level: 1,
        name: 'Pain Validation',
        description: 'Distinguish between genuine business pain and casual interest.',
        focusPatterns: ['validate_real_pain', 'tie_problem_to_business_impact'],
      },
      {
        level: 2,
        name: 'Stakeholder Mapping',
        description: 'Identify who decides, who influences, who controls budget.',
        focusPatterns: ['map_stakeholders', 'validate_real_pain'],
      },
      {
        level: 3,
        name: 'Pipeline Discipline',
        description: 'Be willing to walk away from low-quality pipeline.',
        focusPatterns: ['disqualify_weak_opportunities', 'map_stakeholders', 'tie_problem_to_business_impact'],
      },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────

/** Get all skills with their curricula */
export function getAllSkillCurricula(): SkillCurriculum[] {
  return Object.values(SKILL_CURRICULA);
}

/** Get curriculum for a specific skill */
export function getCurriculum(skill: SkillFocus): SkillCurriculum {
  return SKILL_CURRICULA[skill];
}

/** Get the level definition for a skill at a given level number */
export function getCurriculumLevel(skill: SkillFocus, level: number): CurriculumLevel | null {
  const curriculum = SKILL_CURRICULA[skill];
  return curriculum.levels.find(l => l.level === level) ?? null;
}

/** Get all focus patterns for a skill across all levels */
export function getAllPatternsForSkill(skill: SkillFocus): string[] {
  const curriculum = SKILL_CURRICULA[skill];
  const patterns = new Set<string>();
  for (const level of curriculum.levels) {
    for (const p of level.focusPatterns) patterns.add(p);
  }
  return Array.from(patterns);
}
