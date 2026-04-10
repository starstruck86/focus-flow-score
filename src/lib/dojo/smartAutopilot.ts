/**
 * Smart Autopilot V2 — selects next rep using pattern memory, not just weak skill.
 */

import type { SkillFocus, DojoScenario, SkillStat } from './scenarios';
import { getRandomScenario, SKILL_LABELS } from './scenarios';
import type { PatternMemory } from './types';

export interface SmartAutopilotResult {
  scenario: DojoScenario;
  daveMessage: string;
  reason: string;
  reasonType: 'no_history' | 'unpracticed' | 'weak_first_attempt' | 'repeated_mistake' |
    'weak_retry_conversion' | 'under_practiced' | 'under_practiced_focus' | 'score_trend' | 'random';
}

/**
 * Enhanced autopilot that considers:
 * 1. Unpracticed skills
 * 2. Repeated mistake patterns → drill the skill with that mistake most
 * 3. Weakest first-attempt skill
 * 4. Worst retry conversion rate
 * 5. Under-practiced skill
 * 6. Under-practiced focus pattern
 * 7. Recent score trend (declining)
 * 8. Random
 */
export function getSmartAutopilotRecommendation(
  stats?: SkillStat[],
  patternMemory?: PatternMemory | null,
): SmartAutopilotResult {
  const allSkills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification'];

  // No history
  if (!stats || stats.length === 0) {
    const scenario = getRandomScenario();
    return {
      scenario,
      daveMessage: "Let's get your first rep in. No history yet — we'll start building your baseline.",
      reason: 'no_history',
      reasonType: 'no_history',
    };
  }

  const practiced = new Set(stats.map(s => s.skill));

  // 1. Unpracticed skills
  const unpracticed = allSkills.filter(s => !practiced.has(s));
  if (unpracticed.length > 0) {
    const skill = unpracticed[Math.floor(Math.random() * unpracticed.length)];
    const scenario = getRandomScenario(skill);
    const reasons: Record<SkillFocus, string> = {
      objection_handling: "You haven't drilled objection handling yet. Let's fix that.",
      discovery: "No discovery reps logged. That's where deals are won or lost.",
      executive_response: "You haven't practiced exec responses. Executives punish the unprepared.",
      deal_control: "Zero reps on deal control. Deals don't close themselves — you need to drive them.",
      qualification: "You haven't drilled qualification yet. Half your pipeline is probably unqualified — let's fix your instincts.",
    };
    return {
      scenario,
      daveMessage: reasons[skill],
      reason: `unpracticed:${skill}`,
      reasonType: 'unpracticed',
    };
  }

  // 2. Repeated mistake patterns — if a specific mistake keeps appearing, drill that skill
  if (patternMemory && patternMemory.commonMistakes.length >= 3) {
    const topMistake = patternMemory.commonMistakes[0];
    if (topMistake.count >= 3) {
      // Map mistakes to skills (rough heuristic)
      const mistakeToSkill: Record<string, SkillFocus> = {
        pitched_too_early: 'discovery',
        weak_objection_handle: 'objection_handling',
        no_business_impact: 'discovery',
        lack_of_control: 'deal_control',
        too_generic: 'objection_handling',
        too_long: 'executive_response',
        no_proof: 'objection_handling',
        weak_close: 'deal_control',
        stacked_questions: 'discovery',
        failed_to_deepen: 'discovery',
        vague_next_step: 'deal_control',
        too_passive: 'deal_control',
        no_mutual_plan: 'deal_control',
        accepted_delay: 'deal_control',
        failed_to_qualify: 'qualification',
        accepted_weak_pain: 'qualification',
        no_urgency: 'qualification',
        skipped_stakeholders: 'qualification',
        no_disqualification: 'qualification',
      };
      const skill = mistakeToSkill[topMistake.pattern] || 'objection_handling';
      const scenario = getRandomScenario(skill);
      const mistakeLabel = topMistake.pattern.replace(/_/g, ' ');
      return {
        scenario,
        daveMessage: `You keep hitting "${mistakeLabel}" — ${topMistake.count} times now. We're staying on ${SKILL_LABELS[skill].toLowerCase()} until that becomes instinct.`,
        reason: `repeated_mistake:${topMistake.pattern}:${topMistake.count}`,
        reasonType: 'repeated_mistake',
      };
    }
  }

  // 3. Weakest first-attempt average
  const withFirstAttempts = stats.filter(s => s.recentFirstAttempts.length > 0);
  if (withFirstAttempts.length > 0) {
    const sorted = [...withFirstAttempts].sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
    const weakest = sorted[0];

    // 4. Check retry conversion — if weak retries, stay on that skill
    if (patternMemory) {
      const skillRetryData = patternMemory.scoreImprovementBySkill[weakest.skill];
      if (skillRetryData && skillRetryData.retryScores.length >= 3) {
        const avgRetry = skillRetryData.retryScores.reduce((a, b) => a + b, 0) / skillRetryData.retryScores.length;
        const avgFirst = weakest.avgFirstAttempt;
        const retryGain = avgRetry - avgFirst;
        if (retryGain < 5) {
          const scenario = getRandomScenario(weakest.skill);
          const label = SKILL_LABELS[weakest.skill];
          return {
            scenario,
            daveMessage: `Your first attempts in ${label.toLowerCase()} are weak, and your retries aren't improving much yet. That means the issue is understanding, not just execution. One more rep here.`,
            reason: `weak_retry_conversion:${weakest.skill}:${Math.round(retryGain)}`,
            reasonType: 'weak_retry_conversion',
          };
        }
        if (retryGain >= 10) {
          const scenario = getRandomScenario(weakest.skill);
          const label = SKILL_LABELS[weakest.skill];
          return {
            scenario,
            daveMessage: `Your first attempts in ${label.toLowerCase()} are weak, but your retries improve fast. That means the issue is execution, not understanding. Let's make the first instinct sharper.`,
            reason: `weak_first_attempt:${weakest.skill}:${weakest.avgFirstAttempt}`,
            reasonType: 'weak_first_attempt',
          };
        }
      }
    }

    const scenario = getRandomScenario(weakest.skill);
    const label = SKILL_LABELS[weakest.skill];
    return {
      scenario,
      daveMessage: `Your recent ${label.toLowerCase()} first-attempts are averaging ${weakest.avgFirstAttempt}. That's your instinct score — let's sharpen it.`,
      reason: `weak_first_attempt:${weakest.skill}:${weakest.avgFirstAttempt}`,
      reasonType: 'weak_first_attempt',
    };
  }

  // 5. Least-practiced skill
  const sortedByCount = [...stats].sort((a, b) => a.count - b.count);
  const leastPracticed = sortedByCount[0];
  if (leastPracticed.count < sortedByCount[sortedByCount.length - 1].count) {
    const scenario = getRandomScenario(leastPracticed.skill);
    const label = SKILL_LABELS[leastPracticed.skill];
    return {
      scenario,
      daveMessage: `${label} is your least-practiced category. Balance matters — let's get a rep in.`,
      reason: `under_practiced:${leastPracticed.skill}:${leastPracticed.count}`,
      reasonType: 'under_practiced',
    };
  }

  // 6. Random fallback
  const scenario = getRandomScenario();
  return {
    scenario,
    daveMessage: "Time for a rep. Stay sharp.",
    reason: 'random',
    reasonType: 'random',
  };
}
