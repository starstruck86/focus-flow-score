import type { SkillFocus } from '@/lib/dojo/scenarios';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { getPracticeMapping } from '@/lib/learning/practiceMapping';

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
  coachingMessage: string;
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

// ── Derive Insights ──

export function deriveSessionInsights(result: SessionResult): SessionInsights {
  const skillLabel = SKILL_LABELS[result.skillFocus] || result.skillFocus.replace(/_/g, ' ');
  const score = result.score;

  // Strength signal
  let strengthSignal: string | null = null;
  if (score >= 75) {
    strengthSignal = `Strong ${skillLabel} execution — your response showed real competence.`;
  } else if (score >= 55) {
    strengthSignal = `Decent foundation in ${skillLabel} — the structure is there.`;
  }

  // Weakness signal
  let weaknessSignal: string;
  if (result.topMistake) {
    weaknessSignal = result.topMistake.replace(/_/g, ' ');
  } else if (score < 40) {
    weaknessSignal = `Your ${skillLabel} needs fundamental work — responses stayed surface-level.`;
  } else if (score < 60) {
    weaknessSignal = `You're getting the shape right but missing the precision that makes it land.`;
  } else {
    weaknessSignal = `Small execution gaps — tighten the specificity and conviction.`;
  }

  // Coaching message
  let coachingMessage: string;
  if (score < 40) {
    coachingMessage = `Go back to the lesson on ${skillLabel}. You need the concept before reps will stick.`;
  } else if (score < 60) {
    coachingMessage = `You know what to do but aren't doing it consistently. Run another rep with focus.`;
  } else if (score < 75) {
    coachingMessage = `Getting close. One more focused rep and you'll lock this in.`;
  } else {
    coachingMessage = `Solid. Time to push into a harder skill or increase pressure.`;
  }

  return { strengthSignal, weaknessSignal, coachingMessage };
}

// ── Get Next Action ──

export function getNextAction(result: SessionResult, insights: SessionInsights): NextAction {
  const score = result.score;
  const skillLabel = SKILL_LABELS[result.skillFocus] || result.skillFocus.replace(/_/g, ' ');
  const practice = getPracticeMapping(result.skillFocus);

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
  // Pick a different skill to broaden
  const allSkills: SkillFocus[] = ['objection_handling', 'discovery', 'executive_response', 'deal_control', 'qualification'];
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
