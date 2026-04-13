import { useNavigate } from 'react-router-dom';
import { useCallback, useState, useEffect, useRef } from 'react';
import { Layout } from '@/components/Layout';
import { Badge } from '@/components/ui/badge';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { BookOpen, Loader2, TrendingUp, TrendingDown, GraduationCap } from 'lucide-react';
import { useCourses, useUserProgress } from '@/lib/learning/hooks';
import type { LearningProgress } from '@/lib/learning/types';
import { useMemo } from 'react';
import { useDailyKI } from '@/hooks/useDailyKI';
import { useLearnLoop } from '@/hooks/useLearnLoop';
import { DailyKICard } from '@/components/learn/DailyKICard';
import { TodaysMentalModel } from '@/components/learn/TodaysMentalModel';
import { LastRepInsights } from '@/components/learn/LastRepInsights';
import { ReinforcementQueue } from '@/components/learn/ReinforcementQueue';
import { CourseCard } from '@/components/learn/CourseCard';
import { NextRepExecutionCard } from '@/components/learn/NextRepExecutionCard';
import { ReplayMomentCard } from '@/components/learn/ReplayMomentCard';
import { PatternRecognitionCard } from '@/components/learn/PatternRecognitionCard';
import { PressureBreakdownCard } from '@/components/learn/PressureBreakdownCard';
import { StakeholderMissCard } from '@/components/learn/StakeholderMissCard';
import { ReinforcementDecayCard } from '@/components/learn/ReinforcementDecayCard';
import { TransferSignalCard } from '@/components/learn/TransferSignalCard';
import { WeeklyCoachingPlanCard } from '@/components/learn/WeeklyCoachingPlanCard';
import { FridayReadinessCard } from '@/components/learn/FridayReadinessCard';
import { WeakestAnchorCard } from '@/components/learn/WeakestAnchorCard';
import { BlockRemediationCard } from '@/components/learn/BlockRemediationCard';
import { AdaptiveStudyPathCard } from '@/components/learn/AdaptiveStudyPathCard';
import { PrimaryActionCard } from '@/components/learn/PrimaryActionCard';
import { SkillBuilderEntryCard } from '@/components/learn/SkillBuilderEntryCard';
import { SkillLevelsPanel } from '@/components/learn/SkillLevelsPanel';
import { SkillTierUpModal } from '@/components/learn/SkillTierUpModal';
import { SkillProgressTimeline } from '@/components/learn/SkillProgressTimeline';
import { SubSkillProgressPanel } from '@/components/learn/SubSkillProgressPanel';
import { useSkillLevels } from '@/hooks/useSkillLevels';
import { useSubSkillProgress } from '@/hooks/useSubSkillProgress';
import { isTierUpDismissed } from '@/lib/learning/levelEventStore';
import type { UserSkillLevel } from '@/lib/learning/learnLevelEvaluator';
import { DaveActiveLoopCard } from '@/components/DaveActiveLoopCard';
import { DaveCoachingHistory } from '@/components/DaveCoachingHistory';
import { useClosedLoopCoaching } from '@/hooks/useClosedLoopCoaching';
import { buildLoopResumeInfo } from '@/lib/daveClosedLoopResume';

export default function Learn() {
  const navigate = useNavigate();
  const { data: courses, isLoading } = useCourses();
  const { data: progress } = useUserProgress();
  const { data: dailyKI } = useDailyKI();
  const { data: learnLoop } = useLearnLoop();
  const { data: skillLevels } = useSkillLevels();
  const { data: subSkillSummaries } = useSubSkillProgress();
  const closedLoop = useClosedLoopCoaching();

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

  const topicMastery = useMemo(() => {
    if (!courses || !progress) return [];
    const topics: Record<string, { total: number; completed: number; totalScore: number }> = {};
    courses.forEach(c => {
      if (!topics[c.topic]) topics[c.topic] = { total: 0, completed: 0, totalScore: 0 };
      c.learning_modules.forEach(m => {
        m.learning_lessons.forEach(l => {
          topics[c.topic].total++;
          const p = progressMap[l.id];
          if (p?.status === 'completed') {
            topics[c.topic].completed++;
            topics[c.topic].totalScore += p.mastery_score ?? 0;
          }
        });
      });
    });
    return Object.entries(topics).map(([topic, data]) => ({
      topic,
      total: data.total,
      completed: data.completed,
      avgMastery: data.completed > 0 ? data.totalScore / data.completed : 0,
      pct: data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0,
    }));
  }, [courses, progress, progressMap]);

  const strongest = topicMastery.length > 0
    ? topicMastery.reduce((a, b) => a.avgMastery > b.avgMastery ? a : b)
    : null;
  const weakest = topicMastery.length > 1
    ? topicMastery.reduce((a, b) => a.avgMastery < b.avgMastery ? a : b)
    : null;

  const nextLesson = useMemo(() => {
    if (!courses) return null;
    for (const course of courses) {
      for (const mod of course.learning_modules) {
        for (const lesson of mod.learning_lessons) {
          const p = progressMap[lesson.id];
          if (!p || p.status !== 'completed') {
            return { lesson, course };
          }
        }
      }
    }
    return null;
  }, [courses, progressMap]);

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
    } else if (info.nextSurface === 'learn') {
      // Already on learn — the loop will continue via existing lesson flow
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

  const ki = dailyKI?.items[0];

  return (
    <Layout>
      {/* Tier-Up Modal */}
      <SkillTierUpModal
        level={tierUpLevel}
        open={tierUpOpen}
        onClose={() => setTierUpOpen(false)}
      />

      <div className={cn('px-4 pt-4 space-y-5', SHELL.main.bottomPad)}>
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Learning Engine</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {closedLoop.session && closedLoop.isActive
                ? `Dave is coaching: ${closedLoop.session.subSkill || closedLoop.session.taughtConcept}`
                : nextLesson
                  ? `Up next: ${nextLesson.lesson.title}`
                  : 'All lessons completed. Review weak areas below.'}
            </p>
          </div>
        </div>

        {/* Active Coaching Loop — top priority when present */}
        {closedLoop.session && closedLoop.isActive && (
          <DaveActiveLoopCard
            session={closedLoop.session}
            onResume={handleResumeLoop}
          />
        )}

        {/* 1. Today's Mental Model */}
        {learnLoop?.mentalModel && <TodaysMentalModel model={learnLoop.mentalModel} />}

        {/* 2. Primary Action (Phase 6) — only when no active loop dominates */}
        {learnLoop?.primaryAction && (
          <PrimaryActionCard action={learnLoop.primaryAction} onExecute={handlePrimaryAction} />
        )}

        {/* 3. Skill Progression Levels */}
        {skillLevels && skillLevels.length > 0 && (
          <SkillLevelsPanel levels={skillLevels} />
        )}

        {/* 3b. Progress Timeline */}
        <SkillProgressTimeline />

        {/* 3c. Sub-Skill Breakdown */}
        {subSkillSummaries && subSkillSummaries.length > 0 && (
          <SubSkillProgressPanel summaries={subSkillSummaries} />
        )}

        {/* 4. Adaptive Study Path (Phase 5) */}
        {learnLoop?.adaptiveStudyPath && <AdaptiveStudyPathCard path={learnLoop.adaptiveStudyPath} />}

        {/* Skill Builder Entry (Mode 2) */}
        <SkillBuilderEntryCard />

        {/* 3. Weekly Coaching Plan (Phase 4) */}
        {learnLoop?.weeklyPlan && <WeeklyCoachingPlanCard plan={learnLoop.weeklyPlan} />}

        {/* 3. In Your Next Rep */}
        {ki && <NextRepExecutionCard ki={ki} topMistake={learnLoop?.topMistake} />}

        {/* 4. Daily KI */}
        {dailyKI && <DailyKICard context={dailyKI} topMistake={learnLoop?.topMistake} />}

        {/* 5. Friday Readiness (Phase 4, conditional) */}
        {learnLoop?.fridayReadiness && <FridayReadinessCard readiness={learnLoop.fridayReadiness} />}

        {/* 6. Replay That Moment (conditional) */}
        {learnLoop?.lastRep && <ReplayMomentCard lastRep={learnLoop.lastRep} />}

        {/* 7. Last Rep Insights */}
        {learnLoop?.lastRep && <LastRepInsights insight={learnLoop.lastRep} />}

        {/* 8. Under Pressure (Phase 3) */}
        {learnLoop?.pressureBreakdown && <PressureBreakdownCard pressure={learnLoop.pressureBreakdown} />}

        {/* 9. Who You Missed (Phase 3) */}
        {learnLoop?.multiThreadMiss && <StakeholderMissCard miss={learnLoop.multiThreadMiss} />}

        {/* 10. Weakest Anchor (Phase 4, conditional) */}
        {learnLoop?.weeklyPlan?.weakestAnchorLabel && learnLoop.weeklyPlan.weakestAnchorReason && (
          <WeakestAnchorCard
            anchorLabel={learnLoop.weeklyPlan.weakestAnchorLabel}
            reason={learnLoop.weeklyPlan.weakestAnchorReason}
          />
        )}

        {/* 11. Pattern Recognition */}
        {learnLoop?.skillMemory && <PatternRecognitionCard skillMemory={learnLoop.skillMemory} />}

        {/* 12. What's Fading (Phase 3) */}
        {learnLoop?.decayItems && learnLoop.decayItems.length > 0 && (
          <ReinforcementDecayCard items={learnLoop.decayItems} />
        )}

        {/* 13. Is It Sticking? (Phase 3) */}
        {learnLoop?.transferSignal && <TransferSignalCard signal={learnLoop.transferSignal} />}

        {/* 14. Block Remediation (Phase 4, conditional) */}
        {learnLoop?.blockRemediation && <BlockRemediationCard remediation={learnLoop.blockRemediation} />}

        {/* 15. Reinforcement Queue */}
        {learnLoop?.reinforcement && learnLoop.reinforcement.length > 0 && (
          <ReinforcementQueue items={learnLoop.reinforcement} />
        )}

        {/* 16. Coaching History */}
        <DaveCoachingHistory />

        {/* Secondary lesson CTA (downgraded from primary) */}
        {nextLesson && !learnLoop?.primaryAction && (
          <button
            onClick={() => navigate(`/learn/lesson/${nextLesson.lesson.id}`)}
            className="w-full h-11 rounded-md border border-border bg-card text-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-accent/50 transition-colors"
          >
            <BookOpen className="h-4 w-4" />
            Continue: {nextLesson.lesson.title}
          </button>
        )}

        {/* 17. Topic mastery */}
        {topicMastery.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Topic Mastery
            </p>
            {topicMastery.map(t => (
              <div key={t.topic} className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium capitalize">{t.topic.replace(/_/g, ' ')}</p>
                  <span className="text-xs text-muted-foreground">{t.completed}/{t.total} lessons · {t.pct}%</span>
                </div>
                <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      'h-full rounded-full transition-all',
                      t.pct >= 75 ? 'bg-green-500' : t.pct >= 40 ? 'bg-amber-500' : 'bg-primary'
                    )}
                    style={{ width: `${t.pct}%` }}
                  />
                </div>
              </div>
            ))}
            <div className="grid grid-cols-2 gap-2 pt-1">
              {strongest && strongest.completed > 0 && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-green-500/5 border border-green-500/15">
                  <TrendingUp className="h-3 w-3 text-green-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Strong:</span> {strongest.topic.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
              {weakest && weakest !== strongest && (
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-md bg-red-500/5 border border-red-500/15">
                  <TrendingDown className="h-3 w-3 text-red-500 shrink-0" />
                  <p className="text-[10px] text-muted-foreground truncate">
                    <span className="font-medium text-foreground">Needs work:</span> {weakest.topic.replace(/_/g, ' ')}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 18. Course list */}
        {(courses || []).map(course => (
          <CourseCard
            key={course.id}
            course={course}
            progressMap={progressMap}
            onLessonClick={(id) => navigate(`/learn/lesson/${id}`)}
          />
        ))}
      </div>
    </Layout>
  );
}
