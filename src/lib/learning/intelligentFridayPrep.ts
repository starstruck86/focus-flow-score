/**
 * Intelligent Friday Prep
 *
 * Instead of hardcoding objection_handling, inspects recent skill scores
 * and gaps to choose the most at-risk pressure skill dynamically.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import type { SkillSession } from './skillSession';
import { SKILL_SCENARIO_CONSTRAINTS } from './skillScenarioSelector';

export interface FridayPrepSelection {
  skill: SkillFocus;
  skillName: string;
  reason: string;
  whatWillBeTested: string;
  whatReadyLooksLike: string;
  pressureDimensions: string[];
  session: SkillSession;
}

/**
 * Choose the most at-risk skill for Friday pressure prep.
 * Falls back to executive_response if no data.
 */
export function selectFridayPrepSkill(
  skillLevels: UserSkillLevel[] | null | undefined,
): FridayPrepSelection {
  if (!skillLevels || skillLevels.length === 0) {
    return buildDefaultPrep('executive_response', 'No skill data yet — defaulting to executive response as highest-leverage pressure skill.');
  }

  // Sort by weakness: lowest tier first, then lowest progress
  const sorted = [...skillLevels].sort((a, b) => {
    if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
    return a.progressWithinTier - b.progressWithinTier;
  });

  const weakest = sorted[0];

  // Check for specific risk signals
  const riskSignals: Array<{ skill: SkillFocus; reason: string; priority: number }> = [];

  for (const level of skillLevels) {
    // Very low tier = high risk
    if (level.currentTier <= 1 && level.progressWithinTier < 30) {
      riskSignals.push({
        skill: level.skill,
        reason: `${SKILL_LABELS[level.skill]} is at Tier ${level.currentTier} with only ${level.progressWithinTier}% progress — this will break under pressure.`,
        priority: 1,
      });
    }

    // Declining trend
    if (level.trend === 'declining') {
      riskSignals.push({
        skill: level.skill,
        reason: `${SKILL_LABELS[level.skill]} is declining — scores are getting worse, not better.`,
        priority: 2,
      });
    }

    // Low consistency
    if (level.consistencyLabel === 'inconsistent') {
      riskSignals.push({
        skill: level.skill,
        reason: `${SKILL_LABELS[level.skill]} is inconsistent — good one rep, weak the next.`,
        priority: 3,
      });
    }
  }

  // Pick highest-priority risk signal
  if (riskSignals.length > 0) {
    riskSignals.sort((a, b) => a.priority - b.priority);
    const top = riskSignals[0];
    return buildDefaultPrep(top.skill, top.reason);
  }

  // Fallback: weakest overall
  return buildDefaultPrep(
    weakest.skill,
    `${SKILL_LABELS[weakest.skill]} is your weakest skill (Tier ${weakest.currentTier}, ${weakest.progressWithinTier}% progress).`,
  );
}

function buildDefaultPrep(skill: SkillFocus, reason: string): FridayPrepSelection {
  const constraints = SKILL_SCENARIO_CONSTRAINTS[skill];
  const skillName = SKILL_LABELS[skill];

  const whatWillBeTested: Record<SkillFocus, string> = {
    executive_response: 'Can you deliver a concise, outcome-first response when a senior buyer gives you 30 seconds?',
    objection_handling: 'Can you stay composed, diagnose the real concern, and redirect without counter-punching?',
    discovery: 'Can you go deeper when the buyer gives you shallow answers and quantify the pain?',
    deal_control: 'Can you maintain control when the deal stalls, name the risk, and lock a concrete next step?',
    qualification: 'Can you distinguish real opportunities from time-wasters and disqualify when needed?',
  };

  const whatReadyLooksLike: Record<SkillFocus, string> = {
    executive_response: 'You respond in ≤3 sentences, lead with a number, anchor to their priority, and project certainty.',
    objection_handling: 'You acknowledge without defending, isolate the real concern with one question, and redirect to value.',
    discovery: 'You ask one layered question at a time, quantify the pain, and connect to business impact.',
    deal_control: 'You propose a specific next step with a date, name what\'s at risk, and define mutual commitments.',
    qualification: 'You test urgency, map stakeholders, and are willing to walk away from weak opportunities.',
  };

  const session: SkillSession = {
    skillId: skill,
    skillName: `Friday Pressure: ${skillName}`,
    currentTier: 0,
    currentLevel: 0,
    targetTier: 0,
    scenarioType: 'advanced',
  };

  return {
    skill,
    skillName,
    reason,
    whatWillBeTested: whatWillBeTested[skill],
    whatReadyLooksLike: whatReadyLooksLike[skill],
    pressureDimensions: constraints.pressureTraits.slice(0, 3),
    session,
  };
}
