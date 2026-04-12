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
import { generateDailyAssignment, type DailyAssignment } from '@/lib/dojo/v3/programmingEngine';
import { getAnchorForDate } from '@/lib/dojo/v3/dayAnchors';

import { BlockHeader } from '@/components/dojo/BlockHeader';
import { DailyAssignmentCard } from '@/components/dojo/DailyAssignmentCard';
import { TodaysFocus } from '@/components/dojo/TodaysFocus';
import { TrainingModes } from '@/components/dojo/TrainingModes';
import { PerformanceSignals } from '@/components/dojo/PerformanceSignals';

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

  const coachingInsights = useMemo<CoachingInsights | null>(
    () => patternMemory ? deriveCoachingInsights(patternMemory) : null,
    [patternMemory]
  );

  const recommendation = useMemo(
    () => getSmartAutopilotRecommendation(stats?.skillBreakdown, patternMemory),
    [stats?.skillBreakdown, patternMemory]
  );

  // V3: Generate daily assignment
  const dailyAssignment = useMemo<DailyAssignment | null>(() => {
    if (!activeBlock) return null;
    return generateDailyAssignment({
      date: new Date(),
      block: activeBlock,
      skillMemory: skillMemory ?? null,
      recentAssignments: [], // TODO: fetch from daily_assignments table
      transcriptScenarios: [],
      kiCatalog: [],
    });
  }, [activeBlock, skillMemory]);

  const todayAnchor = useMemo(() => getAnchorForDate(new Date()), []);

  const skillStats = useMemo(() => {
    if (!stats?.skillBreakdown) return [];
    return [...stats.skillBreakdown].sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
  }, [stats?.skillBreakdown]);

  const startAutopilot = () => {
    // V3: Use assignment scenario if available
    const scenario = dailyAssignment?.scenarios[0]?.scenario ?? recommendation.scenario;
    navigate('/dojo/session', { state: { scenario, mode: 'autopilot' } });
  };

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-6', SHELL.main.bottomPad)}>
        {/* V3: Block Header */}
        {activeBlock && (
          <BlockHeader
            blockNumber={activeBlock.blockNumber}
            currentWeek={activeBlock.currentWeek}
            phase={activeBlock.phase}
            stage={activeBlock.stage}
            completedSessionsThisWeek={activeBlock.completedSessionsThisWeek}
            todayAnchor={todayAnchor}
          />
        )}

        {/* V3: Daily Assignment Card */}
        {dailyAssignment && (
          <DailyAssignmentCard assignment={dailyAssignment} />
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
