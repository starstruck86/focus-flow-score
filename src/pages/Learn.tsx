import { useNavigate } from 'react-router-dom';
import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { GraduationCap, Loader2, BookOpen, CheckCircle2, Circle, Lock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useCourses, useUserProgress } from '@/lib/learning/hooks';
import type { LearningProgress } from '@/lib/learning/types';
import { useDailyKI } from '@/hooks/useDailyKI';
import { useLearnLoop } from '@/hooks/useLearnLoop';
import { useSkillLevels } from '@/hooks/useSkillLevels';
import { useSubSkillProgress } from '@/hooks/useSubSkillProgress';
import { useClosedLoopCoaching } from '@/hooks/useClosedLoopCoaching';
import { isTierUpDismissed } from '@/lib/learning/levelEventStore';
import { buildLoopResumeInfo } from '@/lib/daveClosedLoopResume';
import { SKILL_LABELS } from '@/lib/dojo/scenarios';
import { loadActiveLane } from '@/lib/sessionDurability';
import { DAY_ANCHORS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';

// Cards — new grid system
import { LearnFocusCard } from '@/components/learn/cards/LearnFocusCard';
import { LearnSkillCard } from '@/components/learn/cards/LearnSkillCard';
import { LearnPressureCard } from '@/components/learn/cards/LearnPressureCard';
import { LearnMomentumCard } from '@/components/learn/cards/LearnMomentumCard';

// Existing cards kept for deep data
import { PrimaryActionCard } from '@/components/learn/PrimaryActionCard';
import { DaveActiveLoopCard } from '@/components/DaveActiveLoopCard';
import { DaveLoopCompletionCard } from '@/components/DaveLoopCompletionCard';
import { SkillTierUpModal } from '@/components/learn/SkillTierUpModal';
import { SubSkillProgressPanel } from '@/components/learn/SubSkillProgressPanel';
import { DaveCoachingHistory } from '@/components/DaveCoachingHistory';
import { LessonGenerationPanel } from '@/components/learn/LessonGenerationPanel';

export default function Learn() {
  const navigate = useNavigate();
  const { data: courses, isLoading } = useCourses();
  const { data: progress } = useUserProgress();
  const { data: dailyKI } = useDailyKI();
  const { data: learnLoop } = useLearnLoop();
  const { data: skillLevels } = useSkillLevels();
  const { data: subSkillSummaries } = useSubSkillProgress();
  const closedLoop = useClosedLoopCoaching();
  const { user } = useAuth();

  // Tier-up modal
  const [tierUpLevel, setTierUpLevel] = useState<UserSkillLevel | null>(null);
  const [tierUpOpen, setTierUpOpen] = useState(false);
  const prevTiersRef = useRef<Record<string, number>>({});

  useEffect(() => {
    if (!skillLevels || skillLevels.length === 0) return;
    const prev = prevTiersRef.current;
    const hasPrev = Object.keys(prev).length > 0;

    for (const level of skillLevels) {
      if (hasPrev && prev[level.skill] != null && level.currentTier > prev[level.skill]) {
        if (!isTierUpDismissed(level.skill, level.currentTier)) {
          setTierUpLevel(level);
          setTierUpOpen(true);
          break;
        }
      }
      prev[level.skill] = level.currentTier;
    }

    if (!hasPrev) {
      for (const level of skillLevels) {
        prev[level.skill] = level.currentTier;
      }
    }
  }, [skillLevels]);

  const progressMap = useMemo(() => {
    const map: Record<string, LearningProgress> = {};
    (progress || []).forEach(p => { map[p.lesson_id] = p; });
    return map;
  }, [progress]);

  const { data: nextLesson } = useQuery({
    queryKey: ['recommended-lesson', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      if (!user) return null;
      const { data: passed } = await (supabase as any)
        .from('user_lesson_progress')
        .select('lesson_id')
        .eq('user_id', user.id)
        .eq('status', 'passed');
      const passedIds = new Set((passed ?? []).map((r: any) => r.lesson_id));

      const { data: lessons } = await (supabase as any)
        .from('learning_lessons')
        .select(`
          id, title, module_id, generation_status,
          learning_modules!inner(
            id, title, course_id,
            learning_courses!inner(id, title)
          )
        `)
        .eq('generation_status', 'complete')
        .order('id');

      if (!lessons?.length) return null;

      const next = lessons.find((l: any) => !passedIds.has(l.id));
      if (!next) return null;

      return {
        lessonId: next.id,
        lessonTitle: next.title,
        moduleTitle: next.learning_modules?.[0]?.title,
        courseTitle: next.learning_modules?.[0]?.learning_courses?.[0]?.title,
        passedCount: passedIds.size,
        totalCount: lessons.length,
      };
    },
    staleTime: 5 * 60 * 1000,
  });

  // Sorted skill levels: weakest first
  const sortedLevels = useMemo(() => {
    if (!skillLevels || skillLevels.length === 0) return [];
    return [...skillLevels].sort((a, b) => {
      if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
      return a.progressWithinTier - b.progressWithinTier;
    });
  }, [skillLevels]);

  // All lessons with generation status for batch generation panel
  const allLessonsForGeneration = useMemo(() => {
    if (!courses) return [];
    const result: { id: string; title: string; generation_status: string | null }[] = [];
    for (const course of courses) {
      for (const mod of course.learning_modules) {
        for (const lesson of mod.learning_lessons) {
          result.push({
            id: lesson.id,
            title: lesson.title,
            generation_status: (lesson as any).generation_status ?? null,
          });
        }
      }
    }
    return result;
  }, [courses]);

  // Focus skill = weakest
  const focusSkill = sortedLevels[0] ?? null;
  // Other skills = everything except focus
  const otherSkills = sortedLevels.slice(1);

  const handlePrimaryAction = useCallback(() => {
    const action = learnLoop?.primaryAction;
    if (!action) return;
    if (action.target.type === 'dojo_session') {
      navigate('/dojo/session', { state: action.target.state });
    } else if (action.target.type === 'lesson') {
      navigate(`/learn/lesson/${action.target.lessonId}`);
    }
  }, [learnLoop?.primaryAction, navigate]);

  const handleResumeLoop = useCallback(() => {
    if (!closedLoop.session) return;
    const info = buildLoopResumeInfo(closedLoop.session);
    if (info.nextSurface === 'dojo') {
      navigate('/dojo/session', { state: info.launchState });
    } else if (info.nextSurface === 'skill_builder') {
      navigate('/skill-builder/session', { state: info.launchState });
    }
  }, [closedLoop.session, navigate]);

  if (isLoading) {
    return (
      <Layout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  const activeLoopShown = closedLoop.session && closedLoop.isActive;

  return (
    <Layout>
      <SkillTierUpModal
        level={tierUpLevel}
        open={tierUpOpen}
        onClose={() => setTierUpOpen(false)}
      />

      <div className={cn('px-4 pt-4 space-y-5', SHELL.main.bottomPad)}>
        {/* Lesson Generation Panel */}
        <LessonGenerationPanel
          lessons={allLessonsForGeneration}
          onComplete={() => window.location.reload()}
        />

        {/* Header */}
        {(() => {
          const activeLane = loadActiveLane();
          const laneAnchorDef = activeLane?.anchor ? DAY_ANCHORS[activeLane.anchor as DayAnchor] : null;
          const isLaneActive = activeLane && activeLane.repsThisSession > 0 && laneAnchorDef;
          return (
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <div className="space-y-1 pt-0.5">
                <p className="text-sm font-medium text-foreground">
                  {isLaneActive ? `Reinforcing: ${laneAnchorDef.shortLabel}` : 'Training System'}
                </p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {isLaneActive
                    ? `${activeLane.repsThisSession} reps completed · Content targets your ${laneAnchorDef.shortLabel} lane`
                    : activeLoopShown
                      ? `Dave is coaching: ${closedLoop.session!.subSkill || closedLoop.session!.taughtConcept}`
                      : focusSkill
                        ? `Focus: ${SKILL_LABELS[focusSkill.skill]} — Tier ${focusSkill.currentTier}`
                        : 'All skills progressing.'}
                </p>
              </div>
            </div>
          );
        })()}

        {/* Loop completion */}
        {closedLoop.session && !closedLoop.isActive && closedLoop.session.status === 'completed' && (
          <DaveLoopCompletionCard
            concept={closedLoop.session.subSkill || closedLoop.session.taughtConcept}
            skill={closedLoop.session.skill}
            attempts={closedLoop.session.attempts.length}
            onContinue={() => closedLoop.advanceToNext().then(() => {
              const info = closedLoop.session ? buildLoopResumeInfo(closedLoop.session) : null;
              if (info?.nextSurface === 'dojo') navigate('/dojo/session', { state: info.launchState });
            })}
            onDismiss={() => closedLoop.endLoop()}
          />
        )}

        {/* Active coaching loop — top priority */}
        {activeLoopShown && (
          <DaveActiveLoopCard
            session={closedLoop.session!}
            onResume={handleResumeLoop}
          />
        )}

        {/* Primary Action — suppressed when active loop dominates */}
        {learnLoop?.primaryAction && !activeLoopShown && (
          <PrimaryActionCard action={learnLoop.primaryAction} onExecute={handlePrimaryAction} />
        )}

        {/* ═══ CARD GRID ═══ */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Focus Card — spans full width */}
          {focusSkill && (
            <LearnFocusCard
              level={focusSkill}
              insight={learnLoop?.topMistake}
            />
          )}

          {/* Pressure Card */}
          {learnLoop?.fridayReadiness && (
            <LearnPressureCard readiness={learnLoop.fridayReadiness} />
          )}

          {/* Momentum Card */}
          {sortedLevels.length > 0 && (
            <LearnMomentumCard levels={sortedLevels} />
          )}

          {/* Skill Cards — rest of grid */}
          {otherSkills.map(level => (
            <LearnSkillCard key={level.skill} level={level} />
          ))}
        </div>

        {/* Sub-Skill Breakdown */}
        {subSkillSummaries && subSkillSummaries.length > 0 && (
          <SubSkillProgressPanel summaries={subSkillSummaries} />
        )}

        {/* Coaching History */}
        <DaveCoachingHistory />

        {/* ═══ Mastery Gate · Lesson List ═══ */}
        {courses && courses.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Mastery Progression</h2>
            {courses.map(course => (
              <div key={course.id} className="rounded-lg border border-border bg-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-muted/30">
                  <p className="text-sm font-medium text-foreground">{course.title}</p>
                </div>
                <div className="divide-y divide-border">
                  {course.learning_modules.map(mod => (
                    <div key={mod.id} className="px-4 py-3">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                        {mod.title}
                      </p>
                      <ul className="space-y-1.5">
                        {mod.learning_lessons.map((lesson, idx) => {
                          const lp = progressMap[lesson.id] as any;
                          const bestScore = lp?.best_score ?? lp?.mastery_score ?? 0;
                          const isPassed = lp?.status === 'passed' || bestScore >= 65;
                          const inProgress = !isPassed && (lp?.status === 'in_progress' || bestScore > 0);

                          const prev = idx > 0 ? mod.learning_lessons[idx - 1] : null;
                          const prevLp = prev ? (progressMap[prev.id] as any) : null;
                          const prevPassed = !prev
                            ? true
                            : prevLp?.status === 'passed' || (prevLp?.best_score ?? prevLp?.mastery_score ?? 0) >= 65;
                          const isLocked = idx > 0 && !prevPassed && !isPassed && !inProgress;

                          return (
                            <li key={lesson.id}>
                              <button
                                onClick={() => navigate(`/learn/lesson/${lesson.id}`)}
                                className="w-full flex items-center gap-3 py-1.5 px-2 -mx-2 rounded-md hover:bg-accent/50 transition-colors text-left"
                              >
                                <span className="shrink-0">
                                  {isPassed ? (
                                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                                  ) : inProgress ? (
                                    <Circle className="h-4 w-4 text-amber-500" strokeWidth={2.5} />
                                  ) : (
                                    <Circle className="h-4 w-4 text-muted-foreground/50" />
                                  )}
                                </span>
                                <span className="flex-1 min-w-0 flex items-center gap-1.5">
                                  {isLocked && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                                  <span className={cn(
                                    "text-sm truncate",
                                    isLocked ? "text-muted-foreground" : "text-foreground"
                                  )}>
                                    {lesson.title}
                                  </span>
                                </span>
                                <span className={cn(
                                  "shrink-0 text-xs font-medium",
                                  isPassed ? "text-green-600" :
                                  inProgress ? "text-amber-600" :
                                  "text-muted-foreground"
                                )}>
                                  {isPassed ? `Mastered · ${bestScore}/100` :
                                   inProgress ? `In Progress · ${bestScore}/100` :
                                   'Start'}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Recommended next lesson */}
        {nextLesson ? (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4 space-y-3">
              <div className="space-y-0.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">Next Lesson</p>
                  <p className="text-[10px] text-muted-foreground">{nextLesson.passedCount}/{nextLesson.totalCount} complete</p>
                </div>
                <p className="text-base font-bold leading-snug">{nextLesson.lessonTitle}</p>
                <p className="text-xs text-muted-foreground">{nextLesson.courseTitle} · {nextLesson.moduleTitle}</p>
              </div>
              {/* Progress bar */}
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-all"
                  style={{ width: `${Math.round((nextLesson.passedCount / nextLesson.totalCount) * 100)}%` }}
                />
              </div>
              <Button
                className="w-full"
                onClick={() => navigate(`/learn/lesson/${nextLesson.lessonId}`)}
              >
                Start Lesson →
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-green-500/30 bg-green-500/5">
            <CardContent className="p-4">
              <p className="text-sm font-semibold text-green-600 dark:text-green-400">All lessons complete 🎉</p>
              <p className="text-xs text-muted-foreground mt-0.5">Review any course below to revisit the material.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
}
