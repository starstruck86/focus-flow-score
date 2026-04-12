import { useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { getSmartAutopilotRecommendation } from '@/lib/dojo/smartAutopilot';
import { buildPatternMemory, deriveCoachingInsights } from '@/lib/dojo/patternMemory';
import { buildSkillMemory } from '@/lib/dojo/skillMemory';
import { useAuth } from '@/contexts/AuthContext';
import type { PatternMemory, CoachingInsights } from '@/lib/dojo/types';
import type { LessonContext } from '@/lib/learning/practiceMapping';

// V3 imports
import { getOrCreateActiveBlock } from '@/lib/dojo/v3/blockManager';
import { getOrCreateTodayAssignment } from '@/lib/dojo/v3/assignmentManager';
import { getCompletedAnchorsThisWeek } from '@/lib/dojo/v3/assignmentManager';
import type { DailyAssignment } from '@/lib/dojo/v3/programmingEngine';
import { getAnchorForDate } from '@/lib/dojo/v3/dayAnchors';
import { computeWeeklySummaryFromDB } from '@/lib/dojo/v3/weeklySummaryEngine';
import { getBlockSnapshots, compareSnapshots } from '@/lib/dojo/v3/snapshotManager';

import { BlockHeader } from '@/components/dojo/BlockHeader';
import { DailyAssignmentCard } from '@/components/dojo/DailyAssignmentCard';
import { TodaysFocus } from '@/components/dojo/TodaysFocus';
import { TrainingModes } from '@/components/dojo/TrainingModes';
import { PerformanceSignals } from '@/components/dojo/PerformanceSignals';
import { WeeklySummaryCard } from '@/components/dojo/WeeklySummaryCard';
import { BlockComparisonView } from '@/components/dojo/BlockComparisonView';

export default function Dojo() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { data: stats } = useDojoStats();

  const lessonContext = (location.state as LessonContext | null)?.fromLesson
    ? (location.state as LessonContext)
    : null;

  const { data: patternMemory } = useQuery<PatternMemory | null>({
    queryKey: ['dojo-pattern-memory', user?.id],
    enabled: !!user?.id && (stats?.totalSessions ?? 0) >= 3,
    queryFn: () => user ? buildPatternMemory(user.id) : null,
    staleTime: 5 * 60 * 1000,
  });

  const { data: skillMemory } = useQuery({
    queryKey: ['dojo-skill-memory', user?.id],
    enabled: !!user?.id,
    queryFn: () => user ? buildSkillMemory(user.id) : null,
    staleTime: 5 * 60 * 1000,
  });

  // V3: Fetch active training block
  const { data: activeBlock } = useQuery({
    queryKey: ['dojo-v3-block', user?.id],
    enabled: !!user?.id,
    queryFn: () => user ? getOrCreateActiveBlock(user.id) : null,
    staleTime: 10 * 60 * 1000,
  });

  // V3: Fetch or create today's assignment from DB (single source of truth)
  const { data: dailyAssignment } = useQuery<DailyAssignment | null>({
    queryKey: ['dojo-v3-assignment', user?.id, new Date().toISOString().split('T')[0]],
    enabled: !!user?.id,
    queryFn: () => user ? getOrCreateTodayAssignment(user.id) : null,
    staleTime: 30 * 60 * 1000,
  });

  // V3: Fetch real completed anchors for this week
  const { data: completedAnchors } = useQuery({
    queryKey: ['dojo-v3-completed-anchors', activeBlock?.id],
    enabled: !!activeBlock?.id,
    queryFn: () => activeBlock ? getCompletedAnchorsThisWeek(activeBlock.id) : [],
    staleTime: 2 * 60 * 1000,
  });

  // V3: Weekly summary (show when week has sessions)
  const { data: weeklySummary } = useQuery({
    queryKey: ['dojo-v3-weekly-summary', activeBlock?.id, activeBlock?.currentWeek],
    enabled: !!activeBlock?.id && (completedAnchors?.length ?? 0) >= 1,
    queryFn: () => activeBlock
      ? computeWeeklySummaryFromDB(activeBlock.userId, activeBlock.id, activeBlock.currentWeek)
      : null,
    staleTime: 5 * 60 * 1000,
  });

  // V3: Block snapshots for comparison (show when retest exists)
  const { data: blockSnapshots } = useQuery({
    queryKey: ['dojo-v3-snapshots', activeBlock?.id],
    enabled: !!activeBlock?.id && activeBlock?.currentWeek === 8,
    queryFn: () => activeBlock ? getBlockSnapshots(activeBlock.id) : null,
    staleTime: 10 * 60 * 1000,
  });

  const snapshotComparison = useMemo(() => {
    if (!blockSnapshots?.benchmark || !blockSnapshots?.retest) return null;
    return compareSnapshots(blockSnapshots.benchmark, blockSnapshots.retest);
  }, [blockSnapshots]);

  const coachingInsights = useMemo<CoachingInsights | null>(
    () => patternMemory ? deriveCoachingInsights(patternMemory) : null,
    [patternMemory]
  );

  const recommendation = useMemo(
    () => getSmartAutopilotRecommendation(stats?.skillBreakdown, patternMemory),
    [stats?.skillBreakdown, patternMemory]
  );

  const todayAnchor = useMemo(() => getAnchorForDate(new Date()), []);

  const skillStats = useMemo(() => {
    if (!stats?.skillBreakdown) return [];
    return [...stats.skillBreakdown].sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
  }, [stats?.skillBreakdown]);

  const startAutopilot = () => {
    // V3: Use assignment scenario + pass assignment metadata for session tagging
    const scenario = dailyAssignment?.scenarios[0]?.scenario ?? recommendation.scenario;
    navigate('/dojo/session', {
      state: {
        scenario,
        mode: 'autopilot',
        assignmentId: dailyAssignment ? (dailyAssignment as any)._dbId ?? null : null,
        benchmarkTag: dailyAssignment?.benchmarkTag ?? false,
        scenarioFamilyId: dailyAssignment?.scenarioFamilyId ?? null,
      },
    });
  };

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-6', SHELL.main.bottomPad)}>
        {/* V3: Block Header — uses real anchor completion data */}
        {activeBlock && (
          <BlockHeader
            blockNumber={activeBlock.blockNumber}
            currentWeek={activeBlock.currentWeek}
            phase={activeBlock.phase}
            stage={activeBlock.stage}
            completedAnchors={completedAnchors ?? []}
            todayAnchor={todayAnchor}
          />
        )}

        {/* V3: Daily Assignment Card */}
        {dailyAssignment && (
          <DailyAssignmentCard assignment={dailyAssignment} />
        )}

        {/* V3: Block Comparison — benchmark vs retest (Week 8+) */}
        {snapshotComparison && activeBlock && (
          <BlockComparisonView comparison={snapshotComparison} blockNumber={activeBlock.blockNumber} />
        )}

        {/* V3: Weekly Summary — shows after at least 1 anchor completed */}
        {weeklySummary && weeklySummary.totalSessions > 0 && (
          <WeeklySummaryCard summary={weeklySummary} />
        )}

        {/* Section 1: Today's Focus */}
        <TodaysFocus
          recommendation={recommendation}
          skillStats={skillStats}
          streak={stats?.streak ?? 0}
          lastScore={stats?.lastScore ?? null}
          bestScore={stats?.bestScore ?? null}
          onStartAutopilot={startAutopilot}
          lessonContext={lessonContext}
          dailyFocus={skillMemory?.dailyFocus ?? null}
        />

        {/* Section 2: Training Modes */}
        <TrainingModes
          skillStats={skillStats}
          onStartAutopilot={startAutopilot}
          highlightMode={lessonContext?.recommendedMode ?? null}
        />

        {/* Section 3: Performance + Coaching Signals */}
        <PerformanceSignals
          skillStats={skillStats}
          coachingInsights={coachingInsights}
          skillProfiles={skillMemory?.profiles ?? null}
          progressSignals={skillMemory?.progressSignals ?? null}
        />
      </div>
    </Layout>
  );
}
