import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { getSmartAutopilotRecommendation } from '@/lib/dojo/smartAutopilot';
import { buildPatternMemory, deriveCoachingInsights } from '@/lib/dojo/patternMemory';
import { useAuth } from '@/contexts/AuthContext';
import type { PatternMemory, CoachingInsights } from '@/lib/dojo/types';

import { TodaysFocus } from '@/components/dojo/TodaysFocus';
import { TrainingModes } from '@/components/dojo/TrainingModes';
import { PerformanceSignals } from '@/components/dojo/PerformanceSignals';

export default function Dojo() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: stats } = useDojoStats();

  const { data: patternMemory } = useQuery<PatternMemory | null>({
    queryKey: ['dojo-pattern-memory', user?.id],
    enabled: !!user?.id && (stats?.totalSessions ?? 0) >= 3,
    queryFn: () => user ? buildPatternMemory(user.id) : null,
    staleTime: 5 * 60 * 1000,
  });

  const coachingInsights = useMemo<CoachingInsights | null>(
    () => patternMemory ? deriveCoachingInsights(patternMemory) : null,
    [patternMemory]
  );

  const recommendation = useMemo(
    () => getSmartAutopilotRecommendation(stats?.skillBreakdown, patternMemory),
    [stats?.skillBreakdown, patternMemory]
  );

  const skillStats = useMemo(() => {
    if (!stats?.skillBreakdown) return [];
    return [...stats.skillBreakdown].sort((a, b) => a.avgFirstAttempt - b.avgFirstAttempt);
  }, [stats?.skillBreakdown]);

  const startAutopilot = () => {
    navigate('/dojo/session', { state: { scenario: recommendation.scenario, mode: 'autopilot' } });
  };

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-6', SHELL.main.bottomPad)}>
        {/* Section 1: Today's Focus */}
        <TodaysFocus
          recommendation={recommendation}
          skillStats={skillStats}
          streak={stats?.streak ?? 0}
          lastScore={stats?.lastScore ?? null}
          bestScore={stats?.bestScore ?? null}
          onStartAutopilot={startAutopilot}
        />

        {/* Section 2: Training Modes */}
        <TrainingModes
          skillStats={skillStats}
          onStartAutopilot={startAutopilot}
        />

        {/* Section 3: Performance + Coaching Signals */}
        <PerformanceSignals
          skillStats={skillStats}
          coachingInsights={coachingInsights}
        />
      </div>
    </Layout>
  );
}
