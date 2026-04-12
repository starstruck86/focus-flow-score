/**
 * Learn Path Engine — Phase 5
 *
 * Adaptive study path selection based on real Dojo performance data.
 * Decides what the user should study next and why.
 *
 * Additive. Does not change Dojo logic.
 */

import { supabase } from '@/integrations/supabase/client';
import { getWeeklyCoachingPlan, getFridayReadiness, getBlockRemediationPlan } from './learnWeeklyEngine';
import { getPressureBreakdown, getRecentMultiThreadMiss } from './learnAdaptationEngine';
import { DAY_ANCHORS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import type { CourseWithModules, LearningProgress } from './types';

// ── Types ──────────────────────────────────────────────────────────

export type StudyMode =
  | 'today_rep'
  | 'weak_anchor'
  | 'friday_prep'
  | 'pressure_gap'
  | 'multi_thread'
  | 'block_remediation'
  | 'maintenance';

export interface AdaptiveStudyPath {
  mode: StudyMode;
  headline: string;
  rationale: string;
  primaryFocus: {
    type: 'ki' | 'lesson' | 'anchor' | 'skill';
    label: string;
  };
  recommendedKIs: Array<{
    id: string;
    title: string;
    reason: string;
  }>;
  recommendedLessons: Array<{
    lessonId: string;
    title: string;
    reason: string;
  }>;
  recommendedAnchor: {
    key: string;
    label: string;
  } | null;
  confidence: 'high' | 'medium' | 'low';
}

// ── Main Entry ─────────────────────────────────────────────────────

export async function getAdaptiveStudyPath(userId: string): Promise<AdaptiveStudyPath | null> {
  // Fetch all signals in parallel
  const [weeklyPlan, fridayReadiness, blockRemediation, pressureBreakdown, multiThreadMiss, todayAssignment] =
    await Promise.all([
      getWeeklyCoachingPlan(userId),
      getFridayReadiness(userId),
      getBlockRemediationPlan(userId),
      getPressureBreakdown(userId),
      getRecentMultiThreadMiss(userId),
      getTodayAssignmentStatus(userId),
    ]);

  // ── Mode selection (priority order) ──

  // 1. today_rep
  if (todayAssignment && !todayAssignment.completed) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'anchor',
      anchor: todayAssignment.dayAnchor,
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'anchor',
      anchor: todayAssignment.dayAnchor,
    });
    const anchorInfo = DAY_ANCHORS[todayAssignment.dayAnchor as DayAnchor];
    return {
      mode: 'today_rep',
      headline: 'Study this before today\'s rep',
      rationale: `Today's ${anchorInfo?.shortLabel ?? todayAssignment.dayAnchor} rep is still open. These will sharpen your execution.`,
      primaryFocus: {
        type: 'anchor',
        label: anchorInfo?.shortLabel ?? todayAssignment.dayAnchor,
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: anchorInfo ? { key: todayAssignment.dayAnchor, label: anchorInfo.shortLabel } : null,
      confidence: kis.length > 0 || lessons.length > 0 ? 'high' : 'medium',
    };
  }

  // 2. friday_prep
  if (fridayReadiness && fridayReadiness.expected) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'anchor',
      anchor: 'executive_roi_mixed',
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'skill',
      skill: 'executive_response',
    });
    const riskLine = fridayReadiness.primaryRisk
      ? ` ${fridayReadiness.primaryRisk}`
      : '';
    return {
      mode: 'friday_prep',
      headline: 'Tighten this before Friday',
      rationale: `Friday is coming and will test you under pressure.${riskLine}`,
      primaryFocus: {
        type: 'anchor',
        label: 'Executive / ROI',
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: { key: 'executive_roi_mixed', label: 'Executive / ROI' },
      confidence: kis.length > 0 ? 'high' : 'medium',
    };
  }

  // 3. block_remediation
  if (blockRemediation && blockRemediation.gaps.length >= 2) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'remediation',
      themes: blockRemediation.gaps,
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'topic',
      topic: blockRemediation.primaryGap,
    });
    return {
      mode: 'block_remediation',
      headline: 'Address what\'s still costing you',
      rationale: blockRemediation.headline,
      primaryFocus: {
        type: 'skill',
        label: blockRemediation.primaryGap,
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: null,
      confidence: 'high',
    };
  }

  // 4. pressure_gap
  if (pressureBreakdown && pressureBreakdown.gap != null && pressureBreakdown.gap > 10) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'theme',
      theme: 'pressure',
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'topic',
      topic: 'pressure',
    });
    return {
      mode: 'pressure_gap',
      headline: 'Pressure is where your execution slips',
      rationale: `Your baseline is ${pressureBreakdown.firstAttemptStrength} but drops to ${pressureBreakdown.pressureScore} under pressure — a ${pressureBreakdown.gap}-point gap.`,
      primaryFocus: {
        type: 'skill',
        label: 'Pressure durability',
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: null,
      confidence: pressureBreakdown.gap > 15 ? 'high' : 'medium',
    };
  }

  // 5. multi_thread
  if (multiThreadMiss && (multiThreadMiss.missedStakeholders.length > 0 || multiThreadMiss.momentum === 'at_risk')) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'theme',
      theme: 'multi_thread',
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'topic',
      topic: 'multi-thread',
    });
    return {
      mode: 'multi_thread',
      headline: 'You\'re missing the room, not just the answer',
      rationale: `You recently missed ${multiThreadMiss.missedStakeholders.join(', ')} in a multi-stakeholder rep.`,
      primaryFocus: {
        type: 'skill',
        label: 'Multi-thread readiness',
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: null,
      confidence: multiThreadMiss.momentum === 'at_risk' ? 'high' : 'medium',
    };
  }

  // 6. weak_anchor
  if (weeklyPlan?.weakestAnchor && weeklyPlan.weakestAnchorLabel) {
    const kis = await getRecommendedKIsForFocus(userId, {
      type: 'anchor',
      anchor: weeklyPlan.weakestAnchor,
    });
    const lessons = await getRecommendedLessonsForFocus(userId, {
      type: 'anchor',
      anchor: weeklyPlan.weakestAnchor,
    });
    return {
      mode: 'weak_anchor',
      headline: 'Your weakest anchor still needs work',
      rationale: weeklyPlan.weakestAnchorReason ?? `${weeklyPlan.weakestAnchorLabel} is your lowest-performing area this week.`,
      primaryFocus: {
        type: 'anchor',
        label: weeklyPlan.weakestAnchorLabel,
      },
      recommendedKIs: kis,
      recommendedLessons: lessons,
      recommendedAnchor: { key: weeklyPlan.weakestAnchor, label: weeklyPlan.weakestAnchorLabel },
      confidence: kis.length > 0 ? 'medium' : 'low',
    };
  }

  // 7. maintenance
  const kis = await getRecommendedKIsForFocus(userId, { type: 'recent' });
  const lessons = await getRecommendedLessonsForFocus(userId, { type: 'incomplete' });
  if (kis.length === 0 && lessons.length === 0) return null;

  return {
    mode: 'maintenance',
    headline: 'Stay sharp — keep building',
    rationale: 'No urgent gaps right now. Use this time to reinforce what you\'ve been working on.',
    primaryFocus: {
      type: 'skill',
      label: 'General reinforcement',
    },
    recommendedKIs: kis,
    recommendedLessons: lessons,
    recommendedAnchor: null,
    confidence: 'low',
  };
}

// ── Helpers ────────────────────────────────────────────────────────

async function getTodayAssignmentStatus(userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('daily_assignments')
    .select('id, completed, day_anchor, kis')
    .eq('user_id', userId)
    .eq('assignment_date', today)
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    id: data.id,
    completed: data.completed,
    dayAnchor: data.day_anchor,
    kiIds: (data.kis as unknown as string[]) ?? [],
  };
}

// ── Anchor → Skill mapping ────────────────────────────────────────

const ANCHOR_SKILL_MAP: Record<string, string> = {
  objection_handling: 'objection_handling',
  discovery_qualification: 'discovery',
  advanced_objection: 'objection_handling',
  deal_control_negotiation: 'deal_control',
  executive_roi_mixed: 'executive_response',
};

const ANCHOR_TOPICS: Record<string, string[]> = {
  objection_handling: ['objection', 'handling', 'reframe'],
  discovery_qualification: ['discovery', 'qualification', 'question'],
  advanced_objection: ['objection', 'advanced', 'reframe', 'price'],
  deal_control_negotiation: ['deal', 'control', 'negotiation', 'close'],
  executive_roi_mixed: ['executive', 'roi', 'value', 'business case'],
};

// ── KI Recommender ────────────────────────────────────────────────

type KIFocusQuery =
  | { type: 'anchor'; anchor: string }
  | { type: 'theme'; theme: string }
  | { type: 'remediation'; themes: string[] }
  | { type: 'recent' };

export async function getRecommendedKIsForFocus(
  userId: string,
  query: KIFocusQuery,
): Promise<Array<{ id: string; title: string; reason: string }>> {
  // Strategy: get KIs from recent assignments related to the focus area
  let anchorFilter: string | null = null;
  let reasonPrefix = 'Relevant to your current focus';

  if (query.type === 'anchor') {
    anchorFilter = query.anchor;
    const anchorInfo = DAY_ANCHORS[query.anchor as DayAnchor];
    reasonPrefix = `Tied to ${anchorInfo?.shortLabel ?? query.anchor}`;
  } else if (query.type === 'theme') {
    // Map theme to anchor
    if (query.theme === 'pressure') {
      reasonPrefix = 'Helps with pressure execution';
    } else if (query.theme === 'multi_thread') {
      reasonPrefix = 'Covers multi-stakeholder dynamics';
    }
  } else if (query.type === 'remediation') {
    reasonPrefix = 'Addresses a persistent gap';
  } else {
    reasonPrefix = 'Recently relevant';
  }

  // Fetch recent assignment KIs
  let assignmentQuery = supabase
    .from('daily_assignments')
    .select('kis, day_anchor')
    .eq('user_id', userId)
    .order('assignment_date', { ascending: false })
    .limit(10);

  if (anchorFilter) {
    assignmentQuery = assignmentQuery.eq('day_anchor', anchorFilter);
  }

  const { data: assignments } = await assignmentQuery;
  if (!assignments || assignments.length === 0) return [];

  const kiIds = [...new Set(assignments.flatMap(a => (a.kis as unknown as string[]) ?? []))].slice(0, 10);
  if (kiIds.length === 0) return [];

  const { data: kiRows } = await supabase
    .from('knowledge_items' as any)
    .select('id, title')
    .in('id', kiIds);

  return ((kiRows ?? []) as any[])
    .filter((ki: any) => ki.title)
    .slice(0, 3)
    .map((ki: any) => ({
      id: ki.id,
      title: ki.title,
      reason: reasonPrefix,
    }));
}

// ── Lesson Recommender ────────────────────────────────────────────

type LessonFocusQuery =
  | { type: 'anchor'; anchor: string }
  | { type: 'skill'; skill: string }
  | { type: 'topic'; topic: string }
  | { type: 'incomplete' };

export async function getRecommendedLessonsForFocus(
  userId: string,
  query: LessonFocusQuery,
): Promise<Array<{ lessonId: string; title: string; reason: string }>> {
  // Get all courses with lessons
  const { data: courses } = await supabase
    .from('learning_courses' as any)
    .select(`
      *,
      learning_modules (
        *,
        learning_lessons (id, title, topic, difficulty_level, order_index, generation_status)
      )
    `)
    .eq('is_active', true);

  if (!courses || courses.length === 0) return [];

  // Get user progress
  const { data: progress } = await supabase
    .from('learning_progress' as any)
    .select('lesson_id, status, mastery_score')
    .eq('user_id', userId);

  const progressMap = new Map<string, { status: string; mastery_score: number | null }>();
  for (const p of (progress ?? []) as any[]) {
    progressMap.set(p.lesson_id, { status: p.status, mastery_score: p.mastery_score });
  }

  // Flatten all lessons
  const allLessons: Array<{ id: string; title: string; topic: string; courseTopic: string }> = [];
  for (const course of courses as any[]) {
    for (const mod of course.learning_modules ?? []) {
      for (const lesson of mod.learning_lessons ?? []) {
        if (lesson.generation_status === 'completed') {
          allLessons.push({
            id: lesson.id,
            title: lesson.title,
            topic: lesson.topic ?? course.topic,
            courseTopic: course.topic,
          });
        }
      }
    }
  }

  // Build search keywords
  let keywords: string[] = [];
  let reasonPrefix = 'Relevant to your focus';

  if (query.type === 'anchor') {
    keywords = ANCHOR_TOPICS[query.anchor] ?? [];
    const anchorInfo = DAY_ANCHORS[query.anchor as DayAnchor];
    reasonPrefix = `Covers ${anchorInfo?.shortLabel ?? query.anchor}`;
  } else if (query.type === 'skill') {
    keywords = [query.skill.replace(/_/g, ' ')];
    reasonPrefix = `Builds ${query.skill.replace(/_/g, ' ')}`;
  } else if (query.type === 'topic') {
    keywords = query.topic.toLowerCase().split(/[\s_-]+/);
    reasonPrefix = `Related to ${query.topic}`;
  } else {
    // incomplete — just find incomplete lessons
    reasonPrefix = 'Continue where you left off';
  }

  // Score and filter lessons
  const scored = allLessons.map(lesson => {
    const prog = progressMap.get(lesson.id);
    const completed = prog?.status === 'completed';
    const mastered = completed && (prog?.mastery_score ?? 0) >= 80;

    // Prefer incomplete, then low mastery, then not started
    let score = 0;
    if (mastered) score = -10; // Skip mastered
    if (completed && !mastered) score = 2; // Low mastery = review
    if (prog?.status === 'in_progress') score = 5; // In progress = continue
    if (!prog) score = 3; // Not started = new

    // Keyword match
    if (keywords.length > 0) {
      const titleLower = lesson.title.toLowerCase();
      const topicLower = (lesson.topic + ' ' + lesson.courseTopic).toLowerCase();
      const matchCount = keywords.filter(k => titleLower.includes(k) || topicLower.includes(k)).length;
      score += matchCount * 3;
    }

    return { ...lesson, score, completed, mastered };
  });

  return scored
    .filter(l => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map(l => ({
      lessonId: l.id,
      title: l.title,
      reason: reasonPrefix,
    }));
}
