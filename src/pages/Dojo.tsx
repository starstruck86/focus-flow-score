import { useMemo, useState, useEffect } from 'react';
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
import { useKISync } from '@/hooks/useKISync';
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
import { DailyLadderCard } from '@/components/train/DailyLadderCard';
import { KiProficiencyStrip } from '@/components/dojo/KiProficiencyStrip';

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
import { Flame, Target, ChevronRight, Zap, Brain, AlertTriangle, TrendingUp, BookOpen, MessageSquare, Swords, BookMarked } from 'lucide-react';
import { useIntensiveMode } from '@/hooks/useIntensiveMode';

function BranchCountdown() {
  const startDate = new Date('2026-07-13');
  const today = new Date();
  const daysLeft = Math.ceil((startDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  const daysIn = Math.floor((today.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  const weekNum = Math.ceil(daysIn / 5);

  if (daysLeft > 0) {
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

  if (daysIn <= 90) {
    return (
      <div className="flex items-center justify-between px-3 py-2.5 rounded-lg bg-green-500/5 border border-green-500/20">
        <div>
          <p className="text-xs font-semibold text-green-600 dark:text-green-400">Day {daysIn} at Branch.io</p>
          <p className="text-[11px] text-muted-foreground">Week {weekNum} · every rep counts now</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold font-mono text-green-500">{daysIn}</p>
          <p className="text-[10px] text-muted-foreground">in</p>
        </div>
      </div>
    );
  }

  return null;
}


function WeeklyCommitmentCard() {
  const navigate = useNavigate();
  const day = new Date().getDay(); // 1=Mon, 2=Tue
  if (day !== 1 && day !== 2) return null;

  try {
    const raw = localStorage.getItem('weekly_commitment');
    if (!raw) return null;
    const { text, dimension, setAt } = JSON.parse(raw);
    if (!text) return null;
    const setDate = new Date(setAt);
    const daysSince = Math.floor((Date.now() - setDate.getTime()) / (1000 * 60 * 60 * 24));
    if (daysSince > 7) return null; // stale — older than a week

    const dimLabel = dimension?.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());

    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-bold text-primary uppercase tracking-wider">This Week's Focus</p>
          {dimLabel && <span className="text-[10px] text-muted-foreground">{dimLabel}</span>}
        </div>
        <p className="text-sm leading-relaxed">{text}</p>
        <button
          onClick={() => navigate('/sharpen', { state: { dimension } })}
          className="text-[11px] font-medium text-primary hover:text-primary/80"
        >
          Drill this focus →
        </button>
      </div>
    );
  } catch {
    return null;
  }
}

function DailyProgress() {
  const storageKey = `daily_reps_${new Date().toISOString().split('T')[0]}`;
  const repsToday = (() => {
    try { return parseInt(localStorage.getItem(storageKey) ?? '0', 10) || 0; }
    catch { return 0; }
  })();
  const GOAL = 15;
  const pct = Math.min((repsToday / GOAL) * 100, 100);
  

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Today</p>
        <p className="text-xs font-mono font-semibold">
          {repsToday === 0 ? `0/${GOAL} — start here` : `${repsToday}/${GOAL} reps${repsToday >= GOAL ? ' ✓' : ''}`}
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

function PWAInstallBanner() {
  const [installEvent, setInstallEvent] = useState<any>(null);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('pwa_install_dismissed') === 'true'; } catch { return false; }
  });

  useEffect(() => {
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true;
    if (isStandalone) { setDismissed(true); return; }

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  if (dismissed || !installEvent) return null;

  return (
    <div className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-muted/60 border border-border/60">
      <div className="flex items-center gap-2.5">
        <span className="text-base">📱</span>
        <div>
          <p className="text-xs font-semibold">Install Dynamic</p>
          <p className="text-[11px] text-muted-foreground">Add to home screen for one-tap access</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={async () => {
            if (!installEvent) return;
            (installEvent as any).prompt();
            const { outcome } = await (installEvent as any).userChoice;
            if (outcome === 'accepted') {
              localStorage.setItem('pwa_install_dismissed', 'true');
              setDismissed(true);
            }
          }}
          className="text-xs font-medium text-primary hover:text-primary/80 px-2 py-1 rounded-lg border border-primary/30 bg-primary/5"
        >
          Install
        </button>
        <button
          onClick={() => {
            localStorage.setItem('pwa_install_dismissed', 'true');
            setDismissed(true);
          }}
          className="text-xs text-muted-foreground/60 hover:text-muted-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function Dojo() {
  const intensive = useIntensiveMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { data: stats } = useDojoStats();
  const { status: kiSyncStatus, cachedCount: kiCachedCount } = useKISync();


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

  const streak = (stats as any)?.streak ?? 0;

  // Save streak for recovery messaging
  useEffect(() => {
    if (streak > 0) {
      localStorage.setItem('dynamic_last_streak', String(streak));
    }
  }, [streak]);

  const lastKnownStreak = (() => {
    try {
      const v = localStorage.getItem('dynamic_last_streak');
      return v ? parseInt(v, 10) : 0;
    } catch { return 0; }
  })();

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

  // Days until Branch Day 1 (July 13, 2026)
  const daysUntilDay1 = useMemo(() => {
    const start = new Date('2026-07-13');
    return Math.max(0, Math.ceil((start.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
  }, []);

  const repsToday = useMemo(() => {
    try {
      const key = `daily_reps_${new Date().toISOString().split('T')[0]}`;
      return parseInt(localStorage.getItem(key) ?? '0', 10) || 0;
    } catch { return 0; }
  }, []);

  return (
    <Layout>
      <div className={cn('flex-1 overflow-y-auto', SHELL.main.bottomPad)}>
        <PWAInstallBanner />

        {/* 1. Streak + daily progress — compact one-row */}
        <div className="px-4 pt-4 pb-3 flex items-center justify-between border-b border-border/30">
          <div className="flex items-center gap-2">
            <span className="text-lg">🔥</span>
            <div>
              <p className="text-sm font-bold">{streak} day streak</p>
              <p className="text-[11px] text-muted-foreground">{repsToday} reps today</p>
            </div>
          </div>
          {daysUntilDay1 > 0 && (
            <div className="text-right">
              <p className="text-xs font-semibold text-primary">{daysUntilDay1}d to Day 1</p>
              <p className="text-[10px] text-muted-foreground">July 13</p>
            </div>
          )}
        </div>

        <div className="px-4 py-4 space-y-4">
          {/* 2. Branch Prep Mode — primary entry point */}
          <div className="rounded-xl border border-green-500/30 bg-green-500/5 px-3 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-green-700 dark:text-green-400">🌿 Branch Prep Mode</p>
                <p className="text-[11px] text-muted-foreground">586 Branch.io KIs · product, expansion, deal control, competitive</p>
              </div>
              <button
                onClick={() => navigate('/sharpen', { state: { branchMode: true } })}
                className="text-xs font-semibold text-green-600 dark:text-green-400 hover:text-green-500 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 shrink-0"
              >
                Drill →
              </button>
            </div>
            {kiSyncStatus === 'synced' && (
              <p className="text-[10px] text-green-600/80 dark:text-green-400/80">✅ {kiCachedCount} KIs cached offline</p>
            )}
            {kiSyncStatus === 'syncing' && (
              <p className="text-[10px] text-muted-foreground">⟳ Caching KIs for offline...</p>
            )}
            {kiSyncStatus === 'offline' && kiCachedCount > 0 && (
              <p className="text-[10px] text-amber-600 dark:text-amber-400">📶 Offline · {kiCachedCount} KIs available</p>
            )}
            {kiSyncStatus === 'offline' && kiCachedCount === 0 && (
              <p className="text-[10px] text-destructive">⚠️ No offline cache — connect to sync</p>
            )}
          </div>

          {/* 3. TRAIN v2 — full curriculum entry + per-type shortcuts */}
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 px-1">Train by Type</p>
            <button
              onClick={() => navigate('/train')}
              className="w-full text-left p-2.5 rounded-lg border border-primary/40 bg-primary/5 hover:bg-primary/10 transition-all"
            >
              <div className="flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-primary shrink-0" />
                <div>
                  <p className="text-sm font-semibold text-primary">Open Training Curriculum</p>
                  <p className="text-[11px] text-muted-foreground">10 spokes · 100+ topics · Foundation → Expert</p>
                </div>
                <ChevronRight className="h-4 w-4 text-primary ml-auto shrink-0" />
              </div>
            </button>
            {[
              { emoji: '📞', label: 'Prospecting', desc: 'Messaging, outreach, follow-up', spoke: 'messaging' },
              { emoji: '🔍', label: 'Discovery', desc: 'Questions, frameworks, demo technique', spoke: 'discovery' },
              { emoji: '⚔️', label: 'Deal Control', desc: 'Negotiation, closing, deal mechanics', spoke: 'deal_control' },
              { emoji: '🏛️', label: 'Stakeholder', desc: 'Executive engagement, champion building', spoke: 'stakeholder_navigation' },
              { emoji: '🎯', label: 'Competitive', desc: 'Competitive intel and positioning', spoke: 'competitive' },
            ].map(cat => (
              <button
                key={cat.label}
                onClick={() => navigate(`/train/${cat.spoke}`)}
                className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="flex items-center gap-2">
                  <span className="text-base shrink-0">{cat.emoji}</span>
                  <div>
                    <p className="text-sm font-medium">{cat.label}</p>
                    <p className="text-[11px] text-muted-foreground">{cat.desc}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </div>
              </button>
            ))}
          </div>

          {/* 4. Daily Branch KI */}
          <DailyBranchKI userId={user?.id} />

          {/* 5. Quick links */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Library', emoji: '📚', path: '/ki-library' },
              { label: 'Simulate', emoji: '🎭', path: '/simulate' },
              { label: 'Coach', emoji: '📋', path: '/coach' },
            ].map(link => (
              <button
                key={link.path}
                onClick={() => navigate(link.path)}
                className="flex flex-col items-center gap-1 p-3 rounded-xl border border-border hover:bg-muted/40 transition-all"
              >
                <span className="text-xl">{link.emoji}</span>
                <span className="text-[11px] font-medium">{link.label}</span>
              </button>
            ))}
          </div>

          {/* Advanced — collapsed by default */}
          <details className="group">
            <summary className="text-[11px] text-muted-foreground cursor-pointer list-none flex items-center gap-1.5 py-2">
              <ChevronRight className="h-3 w-3 group-open:rotate-90 transition-transform" />
              Advanced training &amp; progress
            </summary>
            <div className="pt-3 space-y-3">
              <BranchCountdown />

              {/* Benchmark CTA */}
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

              <DailyProgress />
              <WeeklyCommitmentCard />

              {/* Meeting Mode */}
              <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-3 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-indigo-700 dark:text-indigo-400">📞 Meeting Mode — before any call</p>
                  <p className="text-[11px] text-muted-foreground">90 seconds · Account + KIs + warm-up rep</p>
                </div>
                <button
                  onClick={() => navigate('/meeting')}
                  className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 px-3 py-1.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 shrink-0"
                >
                  Open →
                </button>
              </div>

              {/* Competitive Intel */}
              <button
                onClick={() => navigate('/competitive')}
                className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="flex items-center gap-2">
                  <Swords className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Competitive Intel</p>
                    <p className="text-[11px] text-muted-foreground">Adjust · AppsFlyer · Kochava · Singular</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </div>
              </button>

              {/* Playbooks */}
              <button
                onClick={() => navigate('/playbooks')}
                className="w-full text-left p-2.5 rounded-lg border border-border/60 hover:border-primary/40 hover:bg-primary/5 transition-all"
              >
                <div className="flex items-center gap-2">
                  <BookMarked className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Playbooks</p>
                    <p className="text-[11px] text-muted-foreground">7 encoded situations · Adjust · Champion · Negotiation</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </div>
              </button>

              {/* V3 block system (mature users) */}
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
              {isMature && <ResumeLaneBanner />}

              {(isEarly || isMature) && <KiProficiencyStrip />}

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

              {(isEarly || isMature) && (
                <button
                  onClick={() => navigate('/dojo/session', { state: { skillFocus: 'discovery', sessionType: 'recognition' } })}
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

              {(isEarly || isMature) && (
                <button
                  onClick={() => navigate('/dojo/session', { state: { skillFocus: 'deal_control', sessionType: 'adversarial' } })}
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

              {isMature && dailyAssignment && (
                <DailyAssignmentCard assignment={dailyAssignment} />
              )}

              {isMature && snapshotComparison && activeBlock && (
                <BlockComparisonView comparison={snapshotComparison} blockNumber={activeBlock.blockNumber} />
              )}

              {isMature && weeklySummary && weeklySummary.totalSessions > 0 && (
                <WeeklySummaryCard summary={weeklySummary} />
              )}

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

              {isMature && <MasteryLanes todayAnchor={todayAnchor} />}

              <Card className="p-3 border-primary/30 bg-primary/5">
                <button
                  onClick={() => navigate('/train')}
                  className="w-full flex items-center justify-between text-left"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <BookMarked className="h-4 w-4 text-primary" />
                      <span className="text-sm font-semibold">Open Training Curriculum</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      All 10 spokes · Foundation → Expert · cold band gates
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </button>
              </Card>


              {isMature && (
                <TrainingModes
                  skillStats={skillStats}
                  onStartAutopilot={startAutopilot}
                  highlightMode={lessonContext?.recommendedMode ?? null}
                />
              )}

              {isMature && (
                <PerformanceSignals
                  skillStats={skillStats}
                  coachingInsights={coachingInsights}
                  skillProfiles={skillMemory?.profiles ?? null}
                  progressSignals={skillMemory?.progressSignals ?? null}
                />
              )}

              <div className="flex gap-2 pt-2 pb-2">
                <button
                  onClick={() => navigate('/progress')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border/60 hover:border-primary/30 text-xs text-muted-foreground hover:text-foreground transition-all"
                >
                  <TrendingUp className="h-3.5 w-3.5" />
                  Progress
                </button>
                <button
                  onClick={() => navigate('/review')}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg border border-border/60 hover:border-primary/30 text-xs text-muted-foreground hover:text-foreground transition-all"
                >
                  <Target className="h-3.5 w-3.5" />
                  Weekly Review
                </button>
              </div>
            </div>
          </details>
        </div>
      </div>
    </Layout>
  );
}

function DailyBranchKI({ userId }: { userId?: string }) {
  const navigate = useNavigate();
  const todayKey = new Date().toISOString().split('T')[0];

  const { data: ki } = useQuery({
    queryKey: ['daily-branch-ki', userId, todayKey],
    enabled: !!userId,
    staleTime: 24 * 60 * 60 * 1000,
    queryFn: async () => {
      const offset = new Date().getDate() % 50;
      const { data } = await (supabase as any)
        .from('knowledge_items')
        .select('id, title, tactic_summary, spider_dimension, intelligence_type')
        .eq('chapter', 'branch_io')
        .eq('active', true)
        .eq('intelligence_type', 'product')
        .gt('confidence_score', 0.7)
        .filter('tactic_summary', 'not.is', null)
        .range(offset, offset)
        .limit(1)
        .maybeSingle();
      return data as { id: string; title: string; tactic_summary: string; spider_dimension: string; intelligence_type: string } | null;
    },
  });

  if (!ki) return null;

  return (
    <div className="rounded-xl border border-green-500/20 bg-green-500/5 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 dark:text-green-400">
          🌿 Branch KI of the Day
        </p>
        <span className="text-[10px] text-muted-foreground">
          {ki.intelligence_type ?? ki.spider_dimension}
        </span>
      </div>
      <p className="text-sm font-semibold leading-snug">{ki.title}</p>
      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
        {ki.tactic_summary}
      </p>
      <button
        onClick={() => navigate('/sharpen', {
          state: { branchMode: true, dimension: ki.spider_dimension, specificKIId: ki.id }
        })}
        className="text-xs font-medium text-green-600 dark:text-green-400 hover:text-green-500"
      >
        Drill this KI →
      </button>
    </div>
  );
}
