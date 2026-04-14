import { useNavigate } from 'react-router-dom';
import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { GraduationCap, Loader2, BookOpen } from 'lucide-react';
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

  // Sorted skill levels: weakest first
  const sortedLevels = useMemo(() => {
    if (!skillLevels || skillLevels.length === 0) return [];
    return [...skillLevels].sort((a, b) => {
      if (a.currentTier !== b.currentTier) return a.currentTier - b.currentTier;
      return a.progressWithinTier - b.progressWithinTier;
    });
  }, [skillLevels]);

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
        {/* Header */}
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <GraduationCap className="h-5 w-5 text-primary" />
          </div>
          <div className="space-y-1 pt-0.5">
            <p className="text-sm font-medium text-foreground">Training System</p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {activeLoopShown
                ? `Dave is coaching: ${closedLoop.session!.subSkill || closedLoop.session!.taughtConcept}`
                : focusSkill
                  ? `Focus: ${SKILL_LABELS[focusSkill.skill]} — Tier ${focusSkill.currentTier}`
                  : 'All skills progressing.'}
            </p>
          </div>
        </div>

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

        {/* Secondary lesson CTA */}
        {nextLesson && !learnLoop?.primaryAction && (
          <button
            onClick={() => navigate(`/learn/lesson/${nextLesson.lesson.id}`)}
            className="w-full h-11 rounded-md border border-border bg-card text-foreground font-medium text-sm flex items-center justify-center gap-2 hover:bg-accent/50 transition-colors"
          >
            <BookOpen className="h-4 w-4" />
            Continue: {nextLesson.lesson.title}
          </button>
        )}
      </div>
    </Layout>
  );
}
