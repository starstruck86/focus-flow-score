/**
 * Next-Step Recommendation Engine
 * 
 * After each rep, determines the correct next action based on score,
 * missed dimensions, retry count, and consistency of misses.
 */

import { SKILL_RUBRICS, normalizeDimensionScores } from './skillRubric';

export type NextAction =
  | 'retry_same'           // Same scenario, apply the constraint
  | 'retry_dimension_focus' // Same scenario, isolate one weak dimension
  | 'return_to_training'   // Go back to Skill Builder for the weak area
  | 'advance_pressure'     // Move to higher pressure / harder scenario
  | 'switch_scenario_same_skill'; // Different scenario, same skill

export interface NextStepRecommendation {
  action: NextAction;
  label: string;
  reason: string;
  focusDimension?: string;
  focusDimensionLabel?: string;
}

const ACTION_LABELS: Record<NextAction, string> = {
  retry_same: 'Retry This Scenario',
  retry_dimension_focus: 'Retry — Isolate One Dimension',
  return_to_training: 'Return to Skill Builder',
  advance_pressure: 'Try a Harder Scenario',
  switch_scenario_same_skill: 'Try a Different Scenario',
};

export function recommendNextStep(opts: {
  score: number;
  dimensions: Record<string, unknown> | null | undefined;
  skill: string;
  retryCount: number;
  topMistake: string;
  previousTopMistake?: string;
}): NextStepRecommendation {
  const { score, dimensions, skill, retryCount, topMistake, previousTopMistake } = opts;
  const rubric = SKILL_RUBRICS[skill];
  const normalized = normalizeDimensionScores(dimensions);

  // Find weakest dimension
  let weakestDim: string | undefined;
  let weakestScore = 10;
  let weakestLabel = '';
  if (normalized && rubric) {
    for (const dim of rubric.dimensions) {
      const s = normalized[dim.key]?.score ?? 5;
      if (s < weakestScore) {
        weakestScore = s;
        weakestDim = dim.key;
        weakestLabel = dim.label;
      }
    }
  }

  const sameMistakeRepeated = previousTopMistake && topMistake === previousTopMistake;

  // Decision cascade
  // 1. Elite score → advance
  if (score >= 80) {
    return {
      action: 'advance_pressure',
      label: ACTION_LABELS.advance_pressure,
      reason: 'Strong score — push to a harder scenario to test durability.',
    };
  }

  // 2. Good score (70-79) with retries → switch scenario
  if (score >= 70 && retryCount >= 1) {
    return {
      action: 'switch_scenario_same_skill',
      label: ACTION_LABELS.switch_scenario_same_skill,
      reason: 'Solid improvement. Test the same skill in a different context.',
    };
  }

  // 3. Repeated same mistake across retries → return to training
  if (sameMistakeRepeated && retryCount >= 2) {
    return {
      action: 'return_to_training',
      label: ACTION_LABELS.return_to_training,
      reason: `Same mistake (${topMistake.replace(/_/g, ' ')}) persisting after ${retryCount} retries. Revisit the concept.`,
      focusDimension: weakestDim,
      focusDimensionLabel: weakestLabel,
    };
  }

  // 4. Very low score → return to training
  if (score < 40) {
    return {
      action: 'return_to_training',
      label: ACTION_LABELS.return_to_training,
      reason: 'Score indicates a fundamental gap. Review the skill framework first.',
      focusDimension: weakestDim,
      focusDimensionLabel: weakestLabel,
    };
  }

  // 5. One dimension severely below others → isolate it
  if (weakestDim && weakestScore <= 3 && retryCount < 3) {
    return {
      action: 'retry_dimension_focus',
      label: ACTION_LABELS.retry_dimension_focus,
      reason: `${weakestLabel} scored ${weakestScore}/10 — isolate and fix this one dimension.`,
      focusDimension: weakestDim,
      focusDimensionLabel: weakestLabel,
    };
  }

  // 6. Default: retry same scenario
  if (retryCount < 3) {
    return {
      action: 'retry_same',
      label: ACTION_LABELS.retry_same,
      reason: `Apply the retry rule and sharpen your answer.`,
      focusDimension: weakestDim,
      focusDimensionLabel: weakestLabel,
    };
  }

  // 7. Too many retries → switch scenario
  return {
    action: 'switch_scenario_same_skill',
    label: ACTION_LABELS.switch_scenario_same_skill,
    reason: 'Multiple retries on this scenario. Try a fresh one to avoid pattern fatigue.',
  };
}
