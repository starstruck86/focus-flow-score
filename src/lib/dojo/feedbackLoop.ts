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

  // Strength signal — only when earned, specific to what they did right
  let strengthSignal: string | null = null;
  if (score >= 80) {
    strengthSignal = `Your ${skillLabel} showed real conviction — the structure, specificity, and control were all there.`;
  } else if (score >= 70) {
    strengthSignal = `Good instincts on ${skillLabel}. The right moves are there — precision will take it further.`;
  } else if (score >= 60) {
    strengthSignal = `You made the right structural choices. The gap is in specificity and conviction, not direction.`;
  }
  // No strength signal below 60 — empty praise is worse than none

  // Weakness signal — taxonomy-driven, specific to what went wrong
  let weaknessSignal: string;
  if (mistakeDetail) {
    weaknessSignal = mistakeDetail.whyItHurts;
  } else if (score < 35) {
    weaknessSignal = `Your response missed the core concept. This isn't an execution problem — the foundational understanding needs work.`;
  } else if (score < 50) {
    weaknessSignal = `You recognized the situation but responded with a generic approach. The buyer heard nothing that would change their mind.`;
  } else if (score < 65) {
    weaknessSignal = `The direction was right but the response lacked the specificity and conviction that makes a buyer take action.`;
  } else {
    weaknessSignal = `Small gaps in precision. The difference between good and elite here is concrete language and tighter control of the next step.`;
  }

  // Actionable fix — exact phrasing from taxonomy, never conceptual
  let actionableFix: string;
  if (mistakeDetail) {
    actionableFix = mistakeDetail.whatGoodLooksLike;
  } else if (score < 35) {
    actionableFix = `Start with the lesson. Understand the underlying principle, then come back and try applying it to this exact scenario.`;
  } else if (score < 50) {
    actionableFix = `Anchor your response to the buyer\'s specific situation. Say: "You mentioned [their exact problem] — here\'s what we see when that goes unaddressed: [consequence with a number]."`;
  } else {
    actionableFix = `Add one concrete proof point and replace any vague language with the buyer\'s own words. End with a specific ask, not "let me know."`;
  }

  // Coaching message — drill cue when available, behavioral instruction always
  let coachingMessage: string;
  if (score < 35) {
    coachingMessage = `Review the ${skillLabel} lesson first. You need the concept before reps will build the muscle.`;
  } else if (mistakeDetail && score < 55) {
    coachingMessage = mistakeDetail.drillCue;
  } else if (score < 55) {
    coachingMessage = `Run another rep on this exact scenario. Focus on being specific — use names, numbers, and consequences.`;
  } else if (mistakeDetail && score < 75) {
    coachingMessage = `You're close. ${mistakeDetail.drillCue}`;
  } else if (score < 75) {
    coachingMessage = `One more focused rep. Tighten your language: fewer words, more proof, stronger close.`;
  } else {
    coachingMessage = `This is solid. Push yourself: try a harder scenario or switch to a skill where you're less comfortable.`;
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
