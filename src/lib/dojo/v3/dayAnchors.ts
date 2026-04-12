/**
 * V3 Day Anchor Registry
 *
 * Maps weekdays to fixed training anchors.
 * Monday–Friday structure is stable and visible to the learner.
 */

import type { SkillFocus } from '../scenarios';

// ── Day Anchor Types ──────────────────────────────────────────────

export type DayAnchor =
  | 'opening_cold_call'
  | 'discovery_qualification'
  | 'objection_pricing'
  | 'deal_control_negotiation'
  | 'executive_roi_mixed';

export interface AnchorDefinition {
  anchor: DayAnchor;
  label: string;
  shortLabel: string;
  /** Primary skills this anchor develops */
  primarySkills: SkillFocus[];
  /** Sub-skills that can be chained within this day */
  subSkills: string[];
  /** Emoji for UI */
  icon: string;
}

// ── Anchor Registry ───────────────────────────────────────────────

export const DAY_ANCHORS: Record<DayAnchor, AnchorDefinition> = {
  opening_cold_call: {
    anchor: 'opening_cold_call',
    label: 'Opening / Cold Call',
    shortLabel: 'Cold Call',
    primarySkills: ['objection_handling', 'deal_control'],
    subSkills: [
      'pattern_interrupt',
      'opening_hook',
      'early_objection_handling',
      'meeting_setting_close',
      'early_call_control',       // explicitly covers call control, not just opening lines
      'tonality_and_pacing',
    ],
    icon: '📞',
  },
  discovery_qualification: {
    anchor: 'discovery_qualification',
    label: 'Discovery / Qualification',
    shortLabel: 'Discovery',
    primarySkills: ['discovery', 'qualification'],
    subSkills: [
      'pain_discovery',
      'problem_quantification',
      'stakeholder_mapping',
      'qualification_frameworks',
      'urgency_testing',
      'buying_process_mapping',
    ],
    icon: '🔍',
  },
  objection_pricing: {
    anchor: 'objection_pricing',
    label: 'Objection Handling / Pricing',
    shortLabel: 'Objections',
    primarySkills: ['objection_handling'],
    subSkills: [
      'standard_objections',
      'pricing_pressure',
      'competitive_positioning',
      'cost_of_inaction',
      'budget_objections',
      'timing_objections',
    ],
    icon: '🛡️',
  },
  deal_control_negotiation: {
    anchor: 'deal_control_negotiation',
    label: 'Deal Control / Negotiation / MAP',
    shortLabel: 'Deal Control',
    primarySkills: ['deal_control'],
    subSkills: [
      'next_step_control',
      'mutual_action_plans',
      'timeline_negotiation',
      'deal_mechanics',
      'procurement_navigation',
      'champion_coaching',
    ],
    icon: '🎯',
  },
  executive_roi_mixed: {
    anchor: 'executive_roi_mixed',
    label: 'Executive / ROI / Mixed Pressure',
    shortLabel: 'Executive',
    primarySkills: ['executive_response'],
    subSkills: [
      'cfo_conversations',
      'vp_conversations',
      'roi_framing',
      'board_level_selling',
      'business_case_construction',
      'blended_multi_skill_simulation',
    ],
    icon: '👔',
  },
};

// ── Weekday Mapping ───────────────────────────────────────────────
// 0=Sunday, 1=Monday ... 5=Friday, 6=Saturday

const WEEKDAY_TO_ANCHOR: Record<number, DayAnchor> = {
  1: 'opening_cold_call',
  2: 'discovery_qualification',
  3: 'objection_pricing',
  4: 'deal_control_negotiation',
  5: 'executive_roi_mixed',
};

/** Get today's anchor. Returns null for weekends. */
export function getAnchorForDate(date: Date): DayAnchor | null {
  const day = date.getDay(); // 0=Sun, 1=Mon...
  return WEEKDAY_TO_ANCHOR[day] ?? null;
}

/** Get anchor for a specific weekday number (1=Mon...5=Fri) */
export function getAnchorForWeekday(weekday: 1 | 2 | 3 | 4 | 5): DayAnchor {
  return WEEKDAY_TO_ANCHOR[weekday];
}

/** Get the anchor definition */
export function getAnchorDef(anchor: DayAnchor): AnchorDefinition {
  return DAY_ANCHORS[anchor];
}

/** All anchors in weekday order */
export const ANCHORS_IN_ORDER: DayAnchor[] = [
  'opening_cold_call',
  'discovery_qualification',
  'objection_pricing',
  'deal_control_negotiation',
  'executive_roi_mixed',
];
