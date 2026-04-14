/**
 * Sub-Skill Map — Canonical mapping layer.
 *
 * Connects sub-skills to patterns, concepts, and the skill decomposition layer.
 * Single source of truth for what each sub-skill requires.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';

export interface SubSkillDefinition {
  skill: SkillFocus;
  name: string;
  patterns: string[];
  concepts: string[];
}

// ── Discovery ─────────────────────────────────────────────────────

const DISCOVERY_SUB_SKILLS: SubSkillDefinition[] = [
  {
    skill: 'discovery',
    name: 'Pain Excavation',
    patterns: ['ask_singular_questions', 'deepen_one_level', 'three_whys'],
    concepts: ['root_cause_discovery', 'pain_depth', 'buyer_psychology'],
  },
  {
    skill: 'discovery',
    name: 'Depth Creation',
    patterns: ['deepen_one_level', 'quantify_the_pain', 'peel_back_layering'],
    concepts: ['operational_impact', 'cost_of_inaction', 'specificity'],
  },
  {
    skill: 'discovery',
    name: 'Business Impact Mapping',
    patterns: ['connect_to_business_impact', 'revenue_risk_time'],
    concepts: ['impact_chain', 'executive_language', 'financial_framing'],
  },
  {
    skill: 'discovery',
    name: 'Urgency Testing',
    patterns: ['test_urgency', 'trigger_event_probe', 'timeline_pressure'],
    concepts: ['buyer_urgency', 'change_catalyst', 'trigger_events'],
  },
  {
    skill: 'discovery',
    name: 'Stakeholder Discovery',
    patterns: ['map_stakeholders', 'org_power_map', 'multi_thread'],
    concepts: ['decision_makers', 'org_dynamics', 'political_navigation'],
  },
];

// ── Objection Handling ────────────────────────────────────────────

const OBJECTION_HANDLING_SUB_SKILLS: SubSkillDefinition[] = [
  {
    skill: 'objection_handling',
    name: 'Containment',
    patterns: ['acknowledge_isolate', 'isolate_the_objection', 'contain_scope'],
    concepts: ['objection_isolation', 'emotional_control', 'scope_management'],
  },
  {
    skill: 'objection_handling',
    name: 'Reframing',
    patterns: ['reframe_objection', 'feature_to_impact', 'perspective_shift'],
    concepts: ['value_reframe', 'competitive_positioning', 'mental_models'],
  },
  {
    skill: 'objection_handling',
    name: 'Proof Deployment',
    patterns: ['deploy_proof', 'relevant_proof_anchor', 'social_proof'],
    concepts: ['evidence_selection', 'credibility_building', 'case_studies'],
  },
  {
    skill: 'objection_handling',
    name: 'Commitment Recovery',
    patterns: ['recover_commitment', 'micro_commitment', 'close_after_objection'],
    concepts: ['momentum_recovery', 'next_step_lock', 'micro_commitments'],
  },
  // ── Cold Calling sub-skills (Monday anchor, tracked under objection_handling) ──
  {
    skill: 'objection_handling',
    name: 'Pattern Interrupt',
    patterns: ['pattern_interrupt', 'opening_cold_call', 'opening_hook'],
    concepts: ['cold_call_opening', 'attention_capture', 'pattern_break'],
  },
  {
    skill: 'objection_handling',
    name: 'Opening Hook',
    patterns: ['opening_hook', 'value_prop_hook', 'opening_cold_call'],
    concepts: ['first_impression', 'relevance_signal', 'hook_construction'],
  },
  {
    skill: 'objection_handling',
    name: 'Early Objection Handling',
    patterns: ['early_objection_handling', 'gatekeeper_navigation', 'brush_off_recovery'],
    concepts: ['initial_resistance', 'early_rapport', 'persistence_without_pushiness'],
  },
  {
    skill: 'objection_handling',
    name: 'Meeting Setting Close',
    patterns: ['meeting_setting_close', 'micro_commitment', 'calendar_close'],
    concepts: ['call_to_action', 'meeting_conversion', 'closing_on_cold_call'],
  },
];

// ── Deal Control ──────────────────────────────────────────────────

const DEAL_CONTROL_SUB_SKILLS: SubSkillDefinition[] = [
  {
    skill: 'deal_control',
    name: 'Next Step Discipline',
    patterns: ['lock_next_step', 'time_bound_action', 'mutual_commitment'],
    concepts: ['sales_process', 'deal_velocity', 'accountability'],
  },
  {
    skill: 'deal_control',
    name: 'Risk Naming',
    patterns: ['name_risk_directly', 'direct_risk_callout', 'confront_stall'],
    concepts: ['deal_risk', 'transparency', 'courage_in_sales'],
  },
  {
    skill: 'deal_control',
    name: 'Mutual Action Planning',
    patterns: ['mutual_plan', 'joint_commitment', 'process_alignment'],
    concepts: ['deal_structure', 'buyer_alignment', 'collaborative_close'],
  },
  {
    skill: 'deal_control',
    name: 'Urgency Creation',
    patterns: ['create_urgency', 'consequence_framing', 'timeline_pressure'],
    concepts: ['cost_of_delay', 'decision_forcing', 'commercial_pressure'],
  },
  // ── Cold Calling sub-skills (Monday anchor, tracked under deal_control) ──
  {
    skill: 'deal_control',
    name: 'Early Call Control',
    patterns: ['early_call_control', 'opening_cold_call', 'call_direction'],
    concepts: ['call_steering', 'frame_setting', 'early_authority'],
  },
  {
    skill: 'deal_control',
    name: 'Tonality and Pacing',
    patterns: ['tonality_and_pacing', 'vocal_control', 'pacing_management'],
    concepts: ['vocal_authority', 'speech_pacing', 'confidence_signaling'],
  },
];

// ── Executive Response ────────────────────────────────────────────

const EXECUTIVE_RESPONSE_SUB_SKILLS: SubSkillDefinition[] = [
  {
    skill: 'executive_response',
    name: 'Brevity Under Pressure',
    patterns: ['be_concise', 'three_sentence_rule', 'cut_filler'],
    concepts: ['executive_communication', 'clarity', 'confidence'],
  },
  {
    skill: 'executive_response',
    name: 'Executive Anchoring',
    patterns: ['anchor_to_priority', 'priority_first_frame', 'strategic_alignment'],
    concepts: ['cxo_alignment', 'business_priorities', 'strategic_framing'],
  },
  {
    skill: 'executive_response',
    name: 'Number-Led Communication',
    patterns: ['lead_with_numbers', 'metric_story_ask', 'quantify_impact'],
    concepts: ['data_driven', 'financial_language', 'roi_communication'],
  },
  {
    skill: 'executive_response',
    name: 'Composure and Certainty',
    patterns: ['project_certainty', 'stay_composed', 'handle_pushback'],
    concepts: ['executive_presence', 'authority', 'calm_under_fire'],
  },
];

// ── Qualification ─────────────────────────────────────────────────

const QUALIFICATION_SUB_SKILLS: SubSkillDefinition[] = [
  {
    skill: 'qualification',
    name: 'Pain Validation',
    patterns: ['validate_pain', 'pain_reality_test', 'confirm_priority'],
    concepts: ['qualification_rigor', 'pain_confirmation', 'deal_quality'],
  },
  {
    skill: 'qualification',
    name: 'Stakeholder Mapping',
    patterns: ['map_decision_makers', 'decision_architecture', 'multi_thread'],
    concepts: ['buying_committee', 'org_navigation', 'political_awareness'],
  },
  {
    skill: 'qualification',
    name: 'Pipeline Discipline',
    patterns: ['qualify_hard', 'gate_system', 'disqualify_early'],
    concepts: ['pipeline_quality', 'deal_hygiene', 'qualification_gates'],
  },
  {
    skill: 'qualification',
    name: 'Budget and Priority Testing',
    patterns: ['test_budget', 'budget_reality_probe', 'priority_ranking'],
    concepts: ['budget_qualification', 'competing_priorities', 'fiscal_awareness'],
  },
];

// ── Registry ──────────────────────────────────────────────────────

const ALL_SUB_SKILL_DEFINITIONS: SubSkillDefinition[] = [
  ...DISCOVERY_SUB_SKILLS,
  ...OBJECTION_HANDLING_SUB_SKILLS,
  ...DEAL_CONTROL_SUB_SKILLS,
  ...EXECUTIVE_RESPONSE_SUB_SKILLS,
  ...QUALIFICATION_SUB_SKILLS,
];

export function getSubSkillsForSkill(skill: SkillFocus): SubSkillDefinition[] {
  return ALL_SUB_SKILL_DEFINITIONS.filter(d => d.skill === skill);
}

export function getAllSubSkillDefinitions(): SubSkillDefinition[] {
  return ALL_SUB_SKILL_DEFINITIONS;
}

export function getSubSkillDefinition(skill: SkillFocus, name: string): SubSkillDefinition | null {
  return ALL_SUB_SKILL_DEFINITIONS.find(d => d.skill === skill && d.name === name) ?? null;
}

// ── Anchor-based sub-skill grouping ───────────────────────────────
// Maps day anchors to their specific sub-skills for lane-based mastery tracking.

const ANCHOR_SUB_SKILL_NAMES: Record<string, string[]> = {
  opening_cold_call: [
    'Pattern Interrupt', 'Opening Hook', 'Early Objection Handling',
    'Meeting Setting Close', 'Early Call Control', 'Tonality and Pacing',
  ],
  discovery_qualification: [
    'Pain Excavation', 'Depth Creation', 'Business Impact Mapping',
    'Urgency Testing', 'Stakeholder Discovery',
    'Pain Validation', 'Stakeholder Mapping', 'Pipeline Discipline', 'Budget and Priority Testing',
  ],
  objection_pricing: [
    'Containment', 'Reframing', 'Proof Deployment', 'Commitment Recovery',
  ],
  deal_control_negotiation: [
    'Next Step Discipline', 'Risk Naming', 'Mutual Action Planning', 'Urgency Creation',
  ],
  executive_roi_mixed: [
    'Brevity Under Pressure', 'Executive Anchoring', 'Number-Led Communication', 'Composure and Certainty',
  ],
};

/**
 * Get sub-skill definitions relevant to a specific day anchor (mastery lane).
 * This allows tracking cold-calling progress as a distinct lane
 * while keeping it inside the existing 5-skill model.
 */
export function getSubSkillsForAnchor(anchor: string): SubSkillDefinition[] {
  const names = ANCHOR_SUB_SKILL_NAMES[anchor];
  if (!names) return [];
  return ALL_SUB_SKILL_DEFINITIONS.filter(d => names.includes(d.name));
}
