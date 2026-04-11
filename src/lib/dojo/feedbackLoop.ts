import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { getPracticeMapping } from '@/lib/learning/practiceMapping';
import { getMistakeEntry, type MistakeEntry } from '@/lib/dojo/mistakeTaxonomy';

// ── Session Result ──

export interface SessionResult {
  skillFocus: SkillFocus;
  score: number;
  topMistake?: string;
  focusPattern?: string;
  practiceCue?: string;
  retryCount: number;
  sessionType: string;
  fromLessonId?: string;
}

// ── Session Insights ──

export interface SessionInsights {
  strengthSignal: string | null;
  weaknessSignal: string;
  /** Enriched mistake entry from taxonomy (null if no topMistake) */
  mistakeDetail: MistakeEntry | null;
  coachingMessage: string;
  /** Specific "what to do differently" instruction */
  actionableFix: string;
}

// ── Next Action ──

export type NextActionType = 'lesson' | 'dojo';

export interface NextAction {
  type: NextActionType;
  targetTopic: SkillFocus;
  suggestedMode?: string;
  lessonTopic?: string;
  message: string;
  ctaLabel: string;
}

// ── Recent Session Summary (for pattern-aware recommendations) ──

export interface RecentSessionSummary {
  skillFocus: SkillFocus;
  score: number;
  topMistake?: string;
  createdAt: string;
}

// ── Derive Insights ──

export function deriveSessionInsights(result: SessionResult): SessionInsights {
  const skillLabel = SKILL_LABELS[result.skillFocus] || result.skillFocus.replace(/_/g, ' ');
  const score = result.score;

  // Resolve mistake from taxonomy
  const mistakeDetail = result.topMistake ? getMistakeEntry(result.topMistake) : null;

  // Strength signal
  let strengthSignal: string | null = null;
  if (score >= 75) {
    strengthSignal = `Strong ${skillLabel} execution — your response showed real competence.`;
  } else if (score >= 55) {
    strengthSignal = `Decent foundation in ${skillLabel} — the structure is there.`;
  }

  // Weakness signal — use taxonomy for precision
  let weaknessSignal: string;
  if (mistakeDetail) {
    weaknessSignal = mistakeDetail.whyItHurts;
  } else if (score < 40) {
    weaknessSignal = `Your ${skillLabel} needs fundamental work — responses stayed surface-level.`;
  } else if (score < 60) {
    weaknessSignal = `You're getting the shape right but missing the precision that makes it land.`;
  } else {
    weaknessSignal = `Small execution gaps — tighten the specificity and conviction.`;
  }

  // Actionable fix — from taxonomy or generic
  let actionableFix: string;
  if (mistakeDetail) {
    actionableFix = mistakeDetail.whatGoodLooksLike;
  } else if (score < 40) {
    actionableFix = `Go back to basics: review the core concept and try applying it to a simple scenario first.`;
  } else {
    actionableFix = `Be more specific. Anchor every response to a concrete business consequence or proof point.`;
  }

  // Coaching message — sharper, uses drill cue when available
  let coachingMessage: string;
  if (score < 40) {
    coachingMessage = `Go back to the lesson on ${skillLabel}. You need the concept before reps will stick.`;
  } else if (mistakeDetail && score < 60) {
    coachingMessage = mistakeDetail.drillCue;
  } else if (score < 60) {
    coachingMessage = `You know what to do but aren't doing it consistently. Run another rep with focus.`;
  } else if (mistakeDetail && score < 75) {
    coachingMessage = `Almost there. ${mistakeDetail.drillCue}`;
  } else if (score < 75) {
    coachingMessage = `Getting close. One more focused rep and you'll lock this in.`;
  } else {
    coachingMessage = `Solid. Time to push into a harder skill or increase pressure.`;
  }

  return { strengthSignal, weaknessSignal, mistakeDetail, coachingMessage, actionableFix };
}

// ── Get Next Action (pattern-aware) ──

export function getNextAction(
  result: SessionResult,
  insights: SessionInsights,
  recentSessions?: RecentSessionSummary[],
): NextAction {
  const score = result.score;
  const skillLabel = SKILL_LABELS[result.skillFocus] || result.skillFocus.replace(/_/g, ' ');
  const practice = getPracticeMapping(result.skillFocus);

  // Check for repeated mistakes across recent sessions
  const repeatedMistake = detectRepeatedMistake(result, recentSessions);

  // Score < 40: concept gap → send to lesson
  if (score < 40) {
    return {
      type: 'lesson',
      targetTopic: result.skillFocus,
      lessonTopic: result.skillFocus,
      message: `Your ${skillLabel} fundamentals need work. Review the lesson to rebuild the foundation.`,
      ctaLabel: `Review ${skillLabel} Lesson`,
    };
  }

  // Repeated mistake detected → targeted drill on that specific pattern
  if (repeatedMistake) {
    const entry = getMistakeEntry(repeatedMistake.mistake);
    const targetSkill = entry.skill;
    const targetPractice = getPracticeMapping(targetSkill);

    // If severity is 3 and it's repeated 3+ times, send back to lesson
    if (entry.severity === 3 && repeatedMistake.count >= 3) {
      return {
        type: 'lesson',
        targetTopic: targetSkill,
        lessonTopic: targetSkill,
        message: `You've hit "${entry.label}" ${repeatedMistake.count} times. The concept needs reinforcement before more reps.`,
        ctaLabel: `Review ${SKILL_LABELS[targetSkill]} Lesson`,
      };
    }

    return {
      type: 'dojo',
      targetTopic: targetSkill,
      suggestedMode: targetPractice.recommendedMode,
      message: `You keep hitting "${entry.label}." ${entry.drillCue}`,
      ctaLabel: `Drill: ${entry.label}`,
    };
  }

  // Score 40–60: execution gap → another rep, same skill
  if (score < 60) {
    return {
      type: 'dojo',
      targetTopic: result.skillFocus,
      suggestedMode: practice.recommendedMode,
      message: `You understand the concept but the execution isn't consistent. Run another ${practice.label}.`,
      ctaLabel: `Run Another ${practice.label}`,
    };
  }

  // Score 60–75: close to locking in → one more focused rep
  if (score < 75) {
    return {
      type: 'dojo',
      targetTopic: result.skillFocus,
      suggestedMode: practice.recommendedMode,
      message: `Almost there. One more focused rep will lock this pattern in.`,
      ctaLabel: `One More Rep`,
    };
  }

  // Score 75+: strong → push to new skill or harder mode
  const allSkills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification'];

  // If we have recent sessions, find the weakest skill to recommend
  if (recentSessions?.length) {
    const weakestSkill = findWeakestSkill(result.skillFocus, recentSessions, allSkills);
    if (weakestSkill) {
      const nextPractice = getPracticeMapping(weakestSkill);
      const nextLabel = SKILL_LABELS[weakestSkill];
      return {
        type: 'dojo',
        targetTopic: weakestSkill,
        suggestedMode: nextPractice.recommendedMode,
        message: `${skillLabel} is solid. Your ${nextLabel} could use work — let's sharpen it.`,
        ctaLabel: `Work on ${nextLabel}`,
      };
    }
  }

  // Fallback: random other skill
  const otherSkills = allSkills.filter(s => s !== result.skillFocus);
  const nextSkill = otherSkills[Math.floor(Math.random() * otherSkills.length)];
  const nextPractice = getPracticeMapping(nextSkill);
  const nextLabel = SKILL_LABELS[nextSkill];

  return {
    type: 'dojo',
    targetTopic: nextSkill,
    suggestedMode: nextPractice.recommendedMode,
    message: `${skillLabel} is solid. Challenge yourself with ${nextLabel}.`,
    ctaLabel: `Try ${nextLabel}`,
  };
}

// ── Pattern Detection Helpers ──

interface RepeatedMistakeResult {
  mistake: string;
  count: number;
}

/** Detect if the same mistake appears 2+ times in recent sessions */
function detectRepeatedMistake(
  current: SessionResult,
  recentSessions?: RecentSessionSummary[],
): RepeatedMistakeResult | null {
  if (!recentSessions?.length || !current.topMistake) return null;

  const currentMistake = current.topMistake;
  let count = 1; // include current session

  for (const session of recentSessions) {
    if (session.topMistake === currentMistake) {
      count++;
    }
  }

  return count >= 2 ? { mistake: currentMistake, count } : null;
}

/** Find the skill with the lowest average score from recent sessions */
function findWeakestSkill(
  excludeSkill: SkillFocus,
  recentSessions: RecentSessionSummary[],
  allSkills: SkillFocus[],
): SkillFocus | null {
  const scoresBySkill: Partial<Record<SkillFocus, number[]>> = {};

  for (const session of recentSessions) {
    if (!scoresBySkill[session.skillFocus]) scoresBySkill[session.skillFocus] = [];
    scoresBySkill[session.skillFocus]!.push(session.score);
  }

  let weakest: SkillFocus | null = null;
  let lowestAvg = Infinity;

  for (const skill of allSkills) {
    if (skill === excludeSkill) continue;
    const scores = scoresBySkill[skill];
    if (!scores?.length) {
      // Unpracticed skill = weakest by default
      return skill;
    }
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < lowestAvg) {
      lowestAvg = avg;
      weakest = skill;
    }
  }

  return weakest;
}
