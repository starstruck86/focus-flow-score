/**
 * Learn Action Engine — Phase 6
 *
 * Determines the single best next action for the user.
 * Priority-based mode selection using real Learn V6 signals.
 *
 * Additive. Does not change Dojo logic.
 */

import { getLastRepInsights, type LastRepInsight } from './learnEngine';
import { getFridayReadiness, getBlockRemediationPlan } from './learnWeeklyEngine';
import { getAdaptiveStudyPath, type AdaptiveStudyPath } from './learnPathEngine';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────────────

export type LearnPrimaryActionMode =
  | 'run_today_rep'
  | 'replay_missed_moment'
  | 'open_lesson'
  | 'review_ki'
  | 'prep_friday'
  | 'remediate_anchor'
  | 'maintenance';

export interface LearnPrimaryAction {
  mode: LearnPrimaryActionMode;
  label: string;
  reason: string;
  target:
    | { type: 'dojo_session'; state: Record<string, unknown> }
    | { type: 'lesson'; lessonId: string }
    | { type: 'learn_section'; section: string }
    | { type: 'none' };
  confidence: 'high' | 'medium' | 'low';
}

// ── Main Entry ─────────────────────────────────────────────────────

export async function getPrimaryLearnAction(userId: string): Promise<LearnPrimaryAction | null> {
  const [lastRep, fridayReadiness, blockRemediation, adaptivePath, todayAssignment] =
    await Promise.all([
      getLastRepInsights(userId),
      getFridayReadiness(userId),
      getBlockRemediationPlan(userId),
      getAdaptiveStudyPath(userId),
      getTodayAssignment(userId),
    ]);

  // 1. replay_missed_moment
  const replay = buildReplayAction(lastRep);
  if (replay) return replay;

  // 2. run_today_rep
  const todayRep = buildTodayRepAction(todayAssignment);
  if (todayRep) return todayRep;

  // 3. prep_friday
  const friday = buildFridayPrepAction(fridayReadiness, todayAssignment);
  if (friday) return friday;

  // 4. open_lesson
  const lesson = buildLessonAction(adaptivePath);
  if (lesson) return lesson;

  // 5. review_ki
  const ki = buildKIReviewAction(adaptivePath);
  if (ki) return ki;

  // 6. remediate_anchor
  const remediation = buildRemediationAction(blockRemediation);
  if (remediation) return remediation;

  // 7. maintenance
  return buildMaintenanceAction();
}

// ── Helpers ────────────────────────────────────────────────────────

function buildReplayAction(lastRep: LastRepInsight | null): LearnPrimaryAction | null {
  if (!lastRep) return null;
  if (lastRep.focusApplied !== 'no' && lastRep.score >= 60) return null;

  return {
    mode: 'replay_missed_moment',
    label: 'Fix This Now',
    reason: lastRep.focusApplied === 'no'
      ? 'Your last rep missed the focus entirely — this is the highest-leverage correction right now.'
      : `Your last rep scored ${lastRep.score}. Replay and fix before moving on.`,
    target: {
      type: 'dojo_session',
      state: {
        replaySessionId: lastRep.sessionId,
        mode: 'replay',
      },
    },
    confidence: 'high',
  };
}

function buildTodayRepAction(
  assignment: TodayAssignment | null,
): LearnPrimaryAction | null {
  if (!assignment || assignment.completed) return null;

  return {
    mode: 'run_today_rep',
    label: "Run Today's Rep",
    reason: "Today's assignment is still open — complete it before moving to extra study.",
    target: {
      type: 'dojo_session',
      state: {
        assignmentId: assignment.id,
        dayAnchor: assignment.dayAnchor,
      },
    },
    confidence: 'high',
  };
}

function buildFridayPrepAction(
  fridayReadiness: Awaited<ReturnType<typeof getFridayReadiness>>,
  todayAssignment: TodayAssignment | null,
): LearnPrimaryAction | null {
  if (!fridayReadiness || !fridayReadiness.expected) return null;
  // Only suggest Friday prep if today's rep is done or absent
  if (todayAssignment && !todayAssignment.completed) return null;

  const riskNote = fridayReadiness.primaryRisk ? ` ${fridayReadiness.primaryRisk}` : '';

  return {
    mode: 'prep_friday',
    label: 'Prepare for Friday',
    reason: `Friday will test you under pressure.${riskNote}`,
    target: { type: 'learn_section', section: 'friday_readiness' },
    confidence: fridayReadiness.primaryRisk ? 'high' : 'medium',
  };
}

function buildLessonAction(
  adaptivePath: AdaptiveStudyPath | null,
): LearnPrimaryAction | null {
  if (!adaptivePath) return null;
  const lesson = adaptivePath.recommendedLessons[0];
  if (!lesson) return null;
  // Only promote lesson if study path is clearly lesson-oriented
  if (adaptivePath.primaryFocus.type === 'ki') return null;

  return {
    mode: 'open_lesson',
    label: 'Study This Lesson',
    reason: `${lesson.title} — ${lesson.reason.toLowerCase()}.`,
    target: { type: 'lesson', lessonId: lesson.lessonId },
    confidence: adaptivePath.confidence === 'high' ? 'high' : 'medium',
  };
}

function buildKIReviewAction(
  adaptivePath: AdaptiveStudyPath | null,
): LearnPrimaryAction | null {
  if (!adaptivePath) return null;
  const ki = adaptivePath.recommendedKIs[0];
  if (!ki) return null;

  return {
    mode: 'review_ki',
    label: 'Review Before You Practice',
    reason: `${ki.title} — the concept is right but execution is fading.`,
    target: { type: 'learn_section', section: 'adaptive_path' },
    confidence: adaptivePath.confidence,
  };
}

function buildRemediationAction(
  remediation: Awaited<ReturnType<typeof getBlockRemediationPlan>>,
): LearnPrimaryAction | null {
  if (!remediation || remediation.gaps.length === 0) return null;

  return {
    mode: 'remediate_anchor',
    label: 'Remediate This Weak Spot',
    reason: remediation.gaps[0],
    target: { type: 'learn_section', section: 'block_remediation' },
    confidence: remediation.gaps.length >= 2 ? 'high' : 'medium',
  };
}

function buildMaintenanceAction(): LearnPrimaryAction {
  return {
    mode: 'maintenance',
    label: 'Keep Building',
    reason: 'No urgent correction is active. Reinforce what you\'ve been learning.',
    target: { type: 'none' },
    confidence: 'low',
  };
}

// ── Today Assignment Helper ────────────────────────────────────────

interface TodayAssignment {
  id: string;
  completed: boolean;
  dayAnchor: string;
}

async function getTodayAssignment(userId: string): Promise<TodayAssignment | null> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_assignments')
    .select('id, completed, day_anchor')
    .eq('user_id', userId)
    .eq('assignment_date', today)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return { id: data.id, completed: data.completed, dayAnchor: data.day_anchor };
}
