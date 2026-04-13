/**
 * Dynamic Playbook Engine — Schema
 *
 * Defines playbook structure: what a playbook is, how it's typed,
 * and what metadata it carries.
 *
 * Playbooks are the product. KIs are the source material.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

// ── Playbook Types ────────────────────────────────────────────────

export type PlaybookType =
  | 'core_mastery'           // Broad coverage of a skill
  | 'sub_skill_deep_dive'    // Focused on one sub-skill
  | 'situation'              // Contextual (e.g., "cold call objections")
  | 'environment'            // Environment-based (e.g., "executive meeting")
  | 'remediation';           // Fix a specific weakness

export interface PlaybookDefinition {
  id: string;
  label: string;
  skill: SkillFocus;
  subSkill?: string;
  playbookType: PlaybookType;

  /** Concepts that MUST be covered in any session from this playbook */
  requiredConcepts: string[];
  /** Concepts that SHOULD be included if depth allows */
  optionalConcepts: string[];

  /** Contexts this playbook targets (e.g., "cold_call", "renewal", "executive") */
  targetContexts: string[];
  /** Focus patterns this playbook draws from */
  targetPatterns: string[];

  minDurationMinutes: number;
  maxDurationMinutes: number;
}

// ── Assembled Playbook Output ─────────────────────────────────────

export type KILessonRole =
  | 'core_concept'
  | 'example'
  | 'counterexample'
  | 'framework_step'
  | 'cheat'
  | 'diagnostic'
  | 'practice_seed';

export interface PlaybookSlot {
  kiId: string;
  title: string;
  role: KILessonRole;
  concept: string;
  difficulty: number;
  sectionIndex: number;
}

export interface AssembledPlaybook {
  playbookId: string;
  label: string;
  skill: SkillFocus;
  durationMinutes: number;
  slots: PlaybookSlot[];
  conceptsCovered: string[];
  conceptsMissing: string[];
  degraded: boolean;
  degradationReason?: string;
}

// ── Built-in Playbook Registry ────────────────────────────────────

export const PLAYBOOK_REGISTRY: PlaybookDefinition[] = [
  // ── Discovery ─────────────────────────────────────
  {
    id: 'discovery_foundations',
    label: 'Discovery Foundations',
    skill: 'discovery',
    playbookType: 'core_mastery',
    requiredConcepts: ['singular_questions', 'depth_creation', 'pain_quantification'],
    optionalConcepts: ['urgency_testing', 'business_impact_framing'],
    targetContexts: ['discovery', 'needs_analysis'],
    targetPatterns: ['ask_singular_questions', 'deepen_one_level', 'quantify_the_pain'],
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
  },
  {
    id: 'discovery_quantifying_pain',
    label: 'Deep Dive: Quantifying Pain',
    skill: 'discovery',
    subSkill: 'Pain Excavation',
    playbookType: 'sub_skill_deep_dive',
    requiredConcepts: ['pain_quantification', 'cost_consequence', 'number_anchoring'],
    optionalConcepts: ['urgency_testing'],
    targetContexts: ['discovery', 'qualification'],
    targetPatterns: ['quantify_the_pain', 'deepen_one_level', 'tie_to_business_impact'],
    minDurationMinutes: 15,
    maxDurationMinutes: 45,
  },
  {
    id: 'discovery_stakeholder',
    label: 'Deep Dive: Stakeholder Discovery',
    skill: 'discovery',
    subSkill: 'Stakeholder Discovery',
    playbookType: 'sub_skill_deep_dive',
    requiredConcepts: ['stakeholder_mapping', 'influence_identification', 'power_dynamics'],
    optionalConcepts: ['multi_thread_navigation'],
    targetContexts: ['stakeholder_navigation', 'discovery'],
    targetPatterns: ['deepen_one_level', 'ask_singular_questions'],
    minDurationMinutes: 15,
    maxDurationMinutes: 45,
  },
  {
    id: 'discovery_executive_pressure',
    label: 'Executive Discovery Under Pressure',
    skill: 'discovery',
    subSkill: 'Pain Excavation',
    playbookType: 'environment',
    requiredConcepts: ['executive_brevity', 'pain_quantification', 'urgency_testing'],
    optionalConcepts: ['strategic_framing'],
    targetContexts: ['executive', 'c_suite', 'leadership'],
    targetPatterns: ['quantify_the_pain', 'test_urgency', 'tie_to_business_impact'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },

  // ── Objection Handling ────────────────────────────
  {
    id: 'objection_foundations',
    label: 'Objection Handling Foundations',
    skill: 'objection_handling',
    playbookType: 'core_mastery',
    requiredConcepts: ['isolation', 'reframing', 'proof_anchoring', 'composure'],
    optionalConcepts: ['commitment_recovery', 'competitive_deflection'],
    targetContexts: ['objection_handling', 'pricing', 'competitive'],
    targetPatterns: ['stay_concise_under_pressure', 'isolate_before_answering', 'reframe_to_business_impact', 'use_specific_proof'],
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
  },
  {
    id: 'objection_pricing',
    label: 'Deep Dive: Pricing Objections',
    skill: 'objection_handling',
    subSkill: 'Reframing',
    playbookType: 'situation',
    requiredConcepts: ['reframing', 'value_anchoring', 'proof_anchoring'],
    optionalConcepts: ['composure'],
    targetContexts: ['pricing', 'negotiation', 'competitive'],
    targetPatterns: ['reframe_to_business_impact', 'use_specific_proof'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },
  {
    id: 'objection_competitive',
    label: 'Deep Dive: Competitive Objections',
    skill: 'objection_handling',
    subSkill: 'Reframing',
    playbookType: 'situation',
    requiredConcepts: ['competitive_deflection', 'proof_anchoring', 'reframing'],
    optionalConcepts: ['isolation'],
    targetContexts: ['competitive', 'objection_handling'],
    targetPatterns: ['use_specific_proof', 'reframe_to_business_impact', 'isolate_before_answering'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },

  // ── Deal Control ──────────────────────────────────
  {
    id: 'deal_control_foundations',
    label: 'Deal Control Foundations',
    skill: 'deal_control',
    playbookType: 'core_mastery',
    requiredConcepts: ['next_step_discipline', 'risk_naming', 'mutual_commitment'],
    optionalConcepts: ['urgency_creation', 'testing_before_accepting'],
    targetContexts: ['deal_control', 'closing', 'negotiation', 'follow_up'],
    targetPatterns: ['control_next_step', 'name_the_risk', 'lock_mutual_commitment', 'test_before_accepting'],
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
  },
  {
    id: 'deal_control_stalled_deals',
    label: 'Deep Dive: Stalled Deals',
    skill: 'deal_control',
    subSkill: 'Risk Naming',
    playbookType: 'situation',
    requiredConcepts: ['risk_naming', 'urgency_creation', 'next_step_discipline'],
    optionalConcepts: ['mutual_commitment'],
    targetContexts: ['pipeline', 'deal_control', 'pipeline_management'],
    targetPatterns: ['name_the_risk', 'create_urgency_without_pressure', 'control_next_step'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },

  // ── Executive Response ────────────────────────────
  {
    id: 'executive_foundations',
    label: 'Executive Response Foundations',
    skill: 'executive_response',
    playbookType: 'core_mastery',
    requiredConcepts: ['brevity', 'number_led_opening', 'priority_anchoring', 'certainty_projection'],
    optionalConcepts: ['specific_ask_closing'],
    targetContexts: ['executive', 'c_suite', 'leadership', 'business_case'],
    targetPatterns: ['cut_to_three_sentences', 'lead_with_the_number', 'anchor_to_their_priority', 'project_certainty'],
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
  },
  {
    id: 'executive_c_suite',
    label: 'Deep Dive: C-Suite Conversations',
    skill: 'executive_response',
    subSkill: 'Executive Anchoring',
    playbookType: 'environment',
    requiredConcepts: ['priority_anchoring', 'brevity', 'specific_ask_closing'],
    optionalConcepts: ['certainty_projection'],
    targetContexts: ['c_suite', 'executive', 'roi'],
    targetPatterns: ['anchor_to_their_priority', 'cut_to_three_sentences', 'close_with_a_specific_ask'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },

  // ── Qualification ─────────────────────────────────
  {
    id: 'qualification_foundations',
    label: 'Qualification Foundations',
    skill: 'qualification',
    playbookType: 'core_mastery',
    requiredConcepts: ['pain_validation', 'stakeholder_mapping', 'pipeline_discipline'],
    optionalConcepts: ['disqualification_courage'],
    targetContexts: ['qualification', 'discovery'],
    targetPatterns: ['validate_real_pain', 'map_stakeholders', 'tie_problem_to_business_impact', 'disqualify_weak_opportunities'],
    minDurationMinutes: 15,
    maxDurationMinutes: 60,
  },
  {
    id: 'qualification_pipeline_discipline',
    label: 'Deep Dive: Pipeline Discipline',
    skill: 'qualification',
    subSkill: 'Pipeline Discipline',
    playbookType: 'sub_skill_deep_dive',
    requiredConcepts: ['disqualification_courage', 'pipeline_discipline', 'pain_validation'],
    optionalConcepts: ['stakeholder_mapping'],
    targetContexts: ['qualification', 'pipeline_management'],
    targetPatterns: ['disqualify_weak_opportunities', 'validate_real_pain'],
    minDurationMinutes: 15,
    maxDurationMinutes: 30,
  },
];

// ── Helpers ───────────────────────────────────────────────────────

export function getPlaybooksForSkill(skill: SkillFocus): PlaybookDefinition[] {
  return PLAYBOOK_REGISTRY.filter(p => p.skill === skill);
}

export function getPlaybookById(id: string): PlaybookDefinition | undefined {
  return PLAYBOOK_REGISTRY.find(p => p.id === id);
}

export function getDeepDivePlaybooks(skill: SkillFocus): PlaybookDefinition[] {
  return PLAYBOOK_REGISTRY.filter(
    p => p.skill === skill && p.playbookType !== 'core_mastery',
  );
}
