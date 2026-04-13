/**
 * Focus Application Evaluator
 *
 * Determines whether a rep actually applied the declared training focus
 * by checking the relevant scoring dimensions.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import { DIMENSION_TO_SUBSKILL, SKILL_DIMENSION_KEYS } from './learnScoringSchema';
import { getSubSkillsForSkill } from './learnSubSkillMap';

// ── Types ─────────────────────────────────────────────────────────

export interface FocusContext {
  skill: SkillFocus;
  subSkill?: string;
  focusPatterns: string[];
  concepts: string[];
}

export interface FocusApplicationResult {
  applied: boolean;
  strength: number; // 0–100
  missingAreas: string[];
  improvedDimensions: string[];
  weakDimensions: string[];
}

// ── Pattern → Dimension mapping ───────────────────────────────────

const PATTERN_TO_DIMENSIONS: Record<string, string[]> = {
  // Discovery
  ask_singular_questions: ['questionArchitecture'],
  deepen_one_level: ['painExcavation', 'painQuantification'],
  three_whys: ['painExcavation'],
  quantify_the_pain: ['painQuantification'],
  tie_to_business_impact: ['businessImpact'],
  connect_to_business_impact: ['businessImpact'],
  test_urgency: ['urgencyTesting'],
  trigger_event_probe: ['urgencyTesting'],
  map_stakeholders: ['stakeholderDiscovery'],
  org_power_map: ['stakeholderDiscovery'],
  multi_thread: ['stakeholderDiscovery'],
  // Objection Handling
  isolate_before_answering: ['isolation', 'composure'],
  reframe_to_business_impact: ['reframing'],
  use_specific_proof: ['proof'],
  control_next_step: ['commitmentControl', 'nextStepControl'],
  stay_concise_under_pressure: ['composure'],
  // Deal Control
  name_the_risk: ['riskNaming'],
  lock_mutual_commitment: ['mutualPlan'],
  test_before_accepting: ['nextStepControl'],
  create_urgency_without_pressure: ['stakeholderAlignment'],
  // Executive Response
  lead_with_the_number: ['numberLed'],
  cut_to_three_sentences: ['brevity'],
  anchor_to_their_priority: ['priorityAnchoring'],
  project_certainty: ['executivePresence'],
  close_with_a_specific_ask: ['commitmentControl'],
  // Qualification
  validate_real_pain: ['painValidation'],
  disqualify_weak_opportunities: ['disqualification'],
  tie_problem_to_business_impact: ['painValidation'],
};

// ── Core evaluator ────────────────────────────────────────────────

/**
 * Evaluate whether the declared focus was applied in this rep.
 */
export function evaluateFocusApplication(
  focusContext: FocusContext,
  scoreDimensions: Record<string, number> | null,
): FocusApplicationResult {
  if (!scoreDimensions) {
    return { applied: false, strength: 0, missingAreas: [], improvedDimensions: [], weakDimensions: [] };
  }

  // Find which dimensions are relevant to the focus
  const relevantDimensions = new Set<string>();

  // From focus patterns
  for (const pattern of focusContext.focusPatterns) {
    const dims = PATTERN_TO_DIMENSIONS[pattern];
    if (dims) dims.forEach(d => relevantDimensions.add(d));
  }

  // From sub-skill name
  if (focusContext.subSkill) {
    const allDims = SKILL_DIMENSION_KEYS[focusContext.skill] || [];
    for (const dim of allDims) {
      if (DIMENSION_TO_SUBSKILL[dim] === focusContext.subSkill) {
        relevantDimensions.add(dim);
      }
    }
  }

  // If no relevant dimensions found, check all for this skill
  if (relevantDimensions.size === 0) {
    const allDims = SKILL_DIMENSION_KEYS[focusContext.skill] || [];
    allDims.forEach(d => relevantDimensions.add(d));
  }

  const improved: string[] = [];
  const weak: string[] = [];
  let totalScore = 0;
  let count = 0;

  for (const dim of relevantDimensions) {
    const score = scoreDimensions[dim];
    if (score == null) continue;
    totalScore += score;
    count++;
    if (score >= 7) {
      improved.push(dim);
    } else if (score <= 4) {
      weak.push(dim);
    }
  }

  const avgScore = count > 0 ? totalScore / count : 0;
  const strength = Math.round(avgScore * 10); // 0–10 → 0–100
  const applied = avgScore >= 6;

  // Missing areas = relevant dimensions that scored poorly
  const missingAreas: string[] = [];
  for (const dim of relevantDimensions) {
    const score = scoreDimensions[dim];
    if (score != null && score < 5) {
      const subSkill = DIMENSION_TO_SUBSKILL[dim];
      if (subSkill && !missingAreas.includes(subSkill)) {
        missingAreas.push(subSkill);
      }
    }
  }

  return {
    applied,
    strength,
    missingAreas,
    improvedDimensions: improved,
    weakDimensions: weak,
  };
}

/**
 * Compare dimensions between two sessions to find improvements.
 */
export function compareDimensions(
  previous: Record<string, number> | null,
  current: Record<string, number> | null,
): { improved: string[]; declined: string[]; unchanged: string[] } {
  if (!previous || !current) return { improved: [], declined: [], unchanged: [] };

  const improved: string[] = [];
  const declined: string[] = [];
  const unchanged: string[] = [];

  for (const key of Object.keys(current)) {
    const prev = previous[key];
    const curr = current[key];
    if (prev == null || curr == null) continue;

    if (curr > prev + 1) {
      improved.push(key);
    } else if (curr < prev - 1) {
      declined.push(key);
    } else {
      unchanged.push(key);
    }
  }

  return { improved, declined, unchanged };
}
