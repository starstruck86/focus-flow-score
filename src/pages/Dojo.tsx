import { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { getSmartAutopilotRecommendation } from '@/lib/dojo/smartAutopilot';
import { getRandomScenario } from '@/lib/dojo/scenarios';
import { buildPatternMemory, deriveCoachingInsights } from '@/lib/dojo/patternMemory';
import { buildSkillMemory } from '@/lib/dojo/skillMemory';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
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
import { KiProficiencyStrip } from '@/components/dojo/KiProficiencyStrip';
import { ProactiveDaveCard } from '@/components/dojo/ProactiveDaveCard';
import { TodaysFocus } from '@/components/dojo/TodaysFocus';
import { TrainingModes } from '@/components/dojo/TrainingModes';
import { PerformanceSignals } from '@/components/dojo/PerformanceSignals';
import { WeeklySummaryCard } from '@/components/dojo/WeeklySummaryCard';
import { BlockComparisonView } from '@/components/dojo/BlockComparisonView';
import { MasteryLanes } from '@/components/dojo/MasteryLanes';
import { ResumeLaneBanner } from '@/components/dojo/ResumeLaneBanner';
import { Card, CardContent } from '@/components/ui/card';
import { MicroDrillSession } from '@/components/dojo/MicroDrillSession';
import { Button } from '@/components/ui/button';
import { Flame, Target, ChevronRight, Zap, Brain, AlertTriangle } from 'lucide-react';

function BranchCountdown() {
  const startDate = new Date('2026-07-01');
  const today = new Date();
  const daysLeft = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (daysLeft <= 0) return null;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-primary/5 border border-primary/20">
      <div>
        <p className="text-xs font-semibold">Branch.io starts in</p>
        <p className="text-[11px] text-muted-foreground">Get your expansion plays sharp</p>
      </div>
      <div className="text-right">
        <p className="text-2xl font-bold font-mono text-primary">{daysLeft}</p>
        <p className="text-[10px] text-muted-foreground">days</p>
      </div>
    </div>
  );
}
function DailyProgress() {
  const storageKey = `daily_reps_${new Date().toISOString().split('T')[0]}`;
  const repsToday = (() => {
    try { return parseInt(localStorage.getItem(storageKey) ?? '0', 10) || 0; }
    catch { return 0; }
  })();
  const GOAL = 15;
  const pct = Math.min((repsToday / GOAL) * 100, 100);
  if (repsToday === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Today</p>
        <p className="text-xs font-mono font-semibold">
          {repsToday}/{GOAL} reps
          {repsToday >= GOAL && ' ✓'}
        </p>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-green-500' : 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
import { useIntensiveMode } from '@/hooks/useIntensiveMode';

export default function Dojo() {
  const intensive = useIntensiveMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { data: stats } = useDojoStats();

  // Resolve SkillSession from Learn → Dojo navigation
  const stateObj = (location.state ?? {}) as Record<string, unknown>;
  const skillSession = stateObj.skillSession as import('@/lib/learning/skillSession').SkillSession | undefined;

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
    staleTime: 2 * 60 * 1000, // Refetch quickly after session return
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
  const { data: hasBenchmark } = useQuery({
    queryKey: ['has-benchmark'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return false;
      const { count } = await (supabase as any)
        .from('skill_benchmarks')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      return (count ?? 0) > 0;
    },
  });

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

  const sessionCount = stats?.totalSessions ?? 0;
  const isNew = sessionCount < 5;
  const isEarly = sessionCount >= 5 && sessionCount < 20;
  const isMature = sessionCount >= 20;

  const startAutopilot = () => {
    // If launched with SkillSession from Learn, go directly to session with skill context
    if (skillSession) {
      const matchingScenario = getRandomScenario(skillSession.skillId);
      navigate('/dojo/session', {
        state: {
          scenario: matchingScenario,
          skillFocus: skillSession.skillId,
          skillSession,
          mode: 'autopilot',
        },
      });
      return;
    }

    const firstSpec = dailyAssignment?.scenarios[0];
    const scenario = firstSpec?.scenario ?? recommendation.scenario;
    const isSimulation = dailyAssignment?.simulationExpected && dailyAssignment?.simulationArcId;
    navigate('/dojo/session', {
      state: {
        scenario,
        mode: 'autopilot',
        sessionType: isSimulation ? 'simulation' : undefined,
        simulationArcId: isSimulation ? dailyAssignment.simulationArcId : undefined,
        assignmentId: dailyAssignment ? (dailyAssignment as any)._dbId ?? null : null,
        benchmarkTag: dailyAssignment?.benchmarkTag ?? false,
        scenarioFamilyId: dailyAssignment?.scenarioFamilyId ?? null,
        assignmentReason: dailyAssignment?.reason ?? null,
        assignmentAnchor: dailyAssignment?.dayAnchor ?? null,
        assignmentFocusPattern: dailyAssignment?.focusPattern ?? null,
        pressureLevel: firstSpec?.pressure?.level ?? null,
        pressureDimensions: firstSpec?.pressure?.dimensions ?? null,
      },
    });
  };

  const [microDimension, setMicroDimension] = useState<string | null>(null);

  if (microDimension && user) {
    return (
      <MicroDrillSession
        userId={user.id}
        dimension={microDimension}
        onExit={() => setMicroDimension(null)}
      />
    );
  }

  return (
    <Layout>
      <div className={cn('px-4 pt-4 space-y-6', SHELL.main.bottomPad)}>
        {/* Streak — always visible, loss-aversion framing */}
        {(stats?.streak ?? 0) > 0 ? (
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-2xl">🔥</span>
              <div>
                <p className="text-5xl font-bold font-mono leading-none">{stats?.streak}</p>
                <p className="text-xs text-muted-foreground">day streak</p>
              </div>
            </div>
            {(stats?.lastSessionDate && new Date().toDateString() !== new Date(stats.lastSessionDate).toDateString()) ? (
              <div className="text-right">
                <p className="text-xs text-amber-500 font-medium">Streak at risk</p>
                <p className="text-[10px] text-muted-foreground">Do 1 rep to protect it</p>
              </div>
            ) : stats?.streak > 0 ? (
              <div className="text-right">
                <p className="text-xs text-green-500 font-medium">Protected today ✓</p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex items-center gap-2 px-1">
            <span className="text-xl">🎯</span>
            <p className="text-sm text-muted-foreground">Start your streak today</p>
          </div>
        )}

        <BranchCountdown />
        <DailyProgress />

        {/* Mature-only: Block Header */}
        {isMature && activeBlock && (
          <BlockHeader
            blockNumber={activeBlock.blockNumber}
            currentWeek={activeBlock.currentWeek}
            phase={activeBlock.phase}
            stage={activeBlock.stage}
            completedAnchors={completedAnchors ?? []}
            todayAnchor={todayAnchor}
          />
        )}

        {/* Mature-only: Resume active lane banner */}
        {isMature && <ResumeLaneBanner />}

        {/* New users: large Start Session button */}
        {isNew && (
          <button
            onClick={() => navigate('/sharpen')}
            className="w-full py-5 rounded-2xl bg-primary text-primary-foreground flex flex-col items-center gap-1.5 shadow-lg active:scale-95 transition-transform"
          >
            <span className="text-2xl">▶</span>
            <p className="text-base font-bold">Start Today's Session</p>
            <p className="text-xs opacity-80">5 reps · ~12 minutes</p>
          </button>
        )}

        {/* Benchmark CTA — always when no benchmark */}
        {!hasBenchmark && (
          <button
            onClick={() => navigate('/benchmark')}
            className="w-full text-left p-2.5 rounded-lg border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold text-primary">Take Your Baseline Benchmark</p>
                <p className="text-[11px] text-muted-foreground">10 scenarios · seeds your spider chart · 15 min</p>
              </div>
              <ChevronRight className="h-4 w-4 text-primary ml-auto shrink-0" />
            </div>
          </button>
        )}

        {/* Proactive Dave — always visible */}
        <ProactiveDaveCard onMicroDrill={() => navigate('/sharpen')} />

        {/* Early / Mature: KI Proficiency strip */}
        {(isEarly || isMature) && <KiProficiencyStrip />}

        {/* Intensive mode card — visible when active (don't hide for early if enabled) */}
        {intensive.active && (
          <Card className="border-orange-500/40 bg-orange-500/5">
            <CardContent className="p-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Flame className="h-3.5 w-3.5 text-orange-500 shrink-0" />
                  <p className="text-sm font-bold text-orange-500">Intensive Mode · Day {intensive.daysIn + 1}</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Mon &amp; Wed anchors → Expansion + Deal Control until July
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[10px] text-muted-foreground shrink-0"
                onClick={() => intensive.toggle()}
              >
                Pause
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Mature: Enable Intensive Mode button */}
        {isMature && !intensive.active && (
          <button
            onClick={() => intensive.toggle()}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-orange-500/40 hover:bg-orange-500/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Enable Intensive Mode</p>
                <p className="text-[11px] text-muted-foreground">Mon &amp; Wed → Expansion + Deal Control drills</p>
              </div>
            </div>
          </button>
        )}

        {/* Early / Mature: Pre-Call Brief */}
        {isEarly && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Explore</p>
        )}
        {(isEarly || isMature) && (
          <button
            onClick={() => navigate('/brief')}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Scout</p>
                <p className="text-[11px] text-muted-foreground">Brief + warm-up rep before any call</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
            </div>
          </button>
        )}

        {/* Early / Mature: Recognition Drill */}
        {(isEarly || isMature) && (
          <button
            onClick={() => navigate('/dojo/session', {
              state: { skillFocus: 'discovery', sessionType: 'recognition' }
            })}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Recognition Drill</p>
                <p className="text-[11px] text-muted-foreground">Identify which play applies · 30-sec reps · no writing</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
            </div>
          </button>
        )}

        {/* Early / Mature: Adversarial Drill */}
        {(isEarly || isMature) && (
          <button
            onClick={() => navigate('/dojo/session', {
              state: { skillFocus: 'deal_control', sessionType: 'adversarial' }
            })}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-red-500/30 hover:bg-red-500/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Adversarial Drill</p>
                <p className="text-[11px] text-muted-foreground">Spot the anti-pattern · hardest drill type</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
            </div>
          </button>
        )}

        {isEarly && (
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Train</p>
        )}

        {/* Quick Drill / Start Session — always visible, label shifts for new users */}
        <button
          onClick={() => navigate('/sharpen')}
          className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
        >
          <div className="flex items-center gap-2">
            <Flame className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-sm font-medium">{isNew ? 'Start Session' : 'Quick Drill'}</p>
              <p className="text-[11px] text-muted-foreground">Fast-fire reps · Enter to submit · auto-advances</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
          </div>
        </button>

        {/* Early / Mature: Grind Session */}
        {(isEarly || isMature) && (
          <button
            onClick={() => navigate('/grind')}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Grind Session</p>
                <p className="text-[11px] text-muted-foreground">Concept → drills → reflection · pick a topic</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
            </div>
          </button>
        )}

        {/* Mature: Interleaved Drill */}
        {isMature && (
          <button
            onClick={() => navigate('/sharpen', { state: { interleaved: true } })}
            className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Interleaved Drill</p>
                <p className="text-[11px] text-muted-foreground">Mix dimensions · proven for long-term retention</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
            </div>
          </button>
        )}

        {/* Mature-only: Daily Assignment Card */}
        {isMature && dailyAssignment && (
          <DailyAssignmentCard assignment={dailyAssignment} />
        )}

        {/* Mature-only: Block Comparison — benchmark vs retest (Week 8+) */}
        {isMature && snapshotComparison && activeBlock && (
          <BlockComparisonView comparison={snapshotComparison} blockNumber={activeBlock.blockNumber} />
        )}

        {/* Mature-only: Weekly Summary */}
        {isMature && weeklySummary && weeklySummary.totalSessions > 0 && (
          <WeeklySummaryCard summary={weeklySummary} />
        )}

        {/* Mature-only: Today's Focus */}
        {isMature && (
          <TodaysFocus
            recommendation={recommendation}
            skillStats={skillStats}
            streak={stats?.streak ?? 0}
            lastScore={stats?.lastScore ?? null}
            bestScore={stats?.bestScore ?? null}
            onStartAutopilot={startAutopilot}
            lessonContext={lessonContext}
            dailyFocus={skillMemory?.dailyFocus ?? null}
            hideScenarioPreview={!!dailyAssignment}
            assignmentCompleted={dailyAssignment?.completed ?? false}
          />
        )}

        {/* Mature-only: Mastery Lanes */}
        {isMature && <MasteryLanes todayAnchor={todayAnchor} />}

        {/* Mature-only: Training Modes */}
        {isMature && (
          <TrainingModes
            skillStats={skillStats}
            onStartAutopilot={startAutopilot}
            highlightMode={lessonContext?.recommendedMode ?? null}
          />
        )}

        {/* Mature-only: Performance + Coaching Signals */}
        {isMature && (
          <PerformanceSignals
            skillStats={skillStats}
            coachingInsights={coachingInsights}
            skillProfiles={skillMemory?.profiles ?? null}
            progressSignals={skillMemory?.progressSignals ?? null}
          />
        )}
      </div>
    </Layout>
  );
}
