import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { selectNextBranchKI } from '@/lib/dojo/selectNextBranchKI';
import { selectNextKIFromCategory } from '@/lib/dojo/selectNextKIFromCategory';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Flame, ChevronRight, Loader2, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TARGET_REPS = 5;

const DIMENSION_CYCLE = [
  'deal_control', 'expansion_strategy', 'stakeholder_navigation',
  'internal_prospecting', 'discovery', 'messaging',
  'product_knowledge', 'competitive',
];

// Branch Mode cycle — rotates through Branch.io-specific dimensions
const BRANCH_DIMENSION_CYCLE = [
  'product_knowledge', 'expansion_strategy', 'deal_control',
  'competitive', 'discovery', 'stakeholder_navigation',
];

const getBranchDimension = (repsDone: number) =>
  BRANCH_DIMENSION_CYCLE[repsDone % BRANCH_DIMENSION_CYCLE.length];

const getInterleavedDimension = (repsDone: number) => {
  return DIMENSION_CYCLE[repsDone % DIMENSION_CYCLE.length];
};

interface Rep {
  ki: any;
  userResponse: string;
  score: number;
  coaching: string;
}

type Phase = 'loading' | 'input' | 'scoring' | 'feedback' | 'end';

function DailyRepCounter({ completedReps }: { completedReps: number }) {
  const DAILY_GOAL = 15;
  const storageKey = `daily_reps_${new Date().toISOString().split('T')[0]}`;

  const [totalToday, setTotalToday] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? parseInt(saved, 10) : 0;
    } catch { return 0; }
  });

  useEffect(() => {
    const newTotal = totalToday + completedReps;
    localStorage.setItem(storageKey, String(newTotal));
    setTotalToday(newTotal);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const display = totalToday + completedReps;
  const pct = Math.min((display / DAILY_GOAL) * 100, 100);

  return (
    <div className="w-full max-w-sm space-y-1.5">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Today's reps</p>
        <p className="text-xs font-mono font-semibold">{display} / {DAILY_GOAL}</p>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all duration-700',
            pct >= 100 ? 'bg-green-500' : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      {display >= DAILY_GOAL && (
        <p className="text-xs text-green-500 font-medium text-center">Daily goal hit ✓</p>
      )}
    </div>
  );
}

export default function Sharpen() {
  const navigate = useNavigate();
  const location = useLocation();
  const interleaved = (location.state as any)?.interleaved ?? false;
  const branchMode = (location.state as any)?.branchMode ?? false;
  const stateDimension = (location.state as any)?.dimension;
  const stateChapters = (location.state as any)?.chapters as string[] | undefined;
  const stateChapter = (location.state as any)?.chapter as string | undefined;
  const stateSpecificKIId = (location.state as any)?.specificKIId as string | undefined;
  const categoryLabel = stateChapters
    ? (location.state as any)?.categoryLabel ?? 'Training'
    : branchMode
    ? 'Branch'
    : null;
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: stats } = useDojoStats();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [phase, setPhase] = useState<Phase>('loading');
  const [currentKI, setCurrentKI] = useState<any>(null);
  const [dimension, setDimension] = useState('discovery');
  const [response, setResponse] = useState('');
  const [repsDone, setRepsDone] = useState(0);
  const repsDoneRef = useRef(0);
  useEffect(() => { repsDoneRef.current = repsDone; }, [repsDone]);
  const [reps, setReps] = useState<Rep[]>([]);
  const [currentScore, setCurrentScore] = useState<number | null>(null);
  const [currentCoaching, setCurrentCoaching] = useState('');
  const [autoAdvanceTimer, setAutoAdvanceTimer] = useState<NodeJS.Timeout | null>(null);
  const [reviewCount, setReviewCount] = useState(0);
  const [showReviewNotice, setShowReviewNotice] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    try { return localStorage.getItem('sharpen_onboarded') === 'true'; } catch { return false; }
  });
  const totalSessions = (stats as any)?.totalSessions ?? 0;
  const [dimScore, setDimScore] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    (supabase as any)
      .from('ki_mastery')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .lte('next_review_at', new Date().toISOString())
      .not('next_review_at', 'is', null)
      .then(({ count }: { count: number | null }) => {
        if ((count ?? 0) > 0) {
          setReviewCount(count ?? 0);
          setShowReviewNotice(true);
        }
      });
  }, [user]);

  useEffect(() => {
    if (!user || !dimension) return;
    (supabase as any)
      .from('dimension_scores')
      .select('avg_score_100')
      .eq('user_id', user.id)
      .eq('spider_dimension', dimension)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (data?.avg_score_100) setDimScore(Math.round(data.avg_score_100));
      });
  }, [user, dimension]);

  useEffect(() => {
    if (stateDimension) {
      setDimension(stateDimension);
      return;
    }
    const skillBreakdown = (stats as any)?.skillBreakdown;
    if (skillBreakdown?.length) {
      const sorted = [...skillBreakdown].sort((a: any, b: any) => a.avgFirstAttempt - b.avgFirstAttempt);
      const weakestSkill = sorted[0]?.skill;
      const skillToDimension: Record<string, string> = {
        discovery: 'discovery',
        objection_handling: 'objection_handling',
        deal_control: 'deal_control',
        executive_response: 'c_suite_engagement',
        qualification: 'qualification',
        cold_calling: 'internal_prospecting',
        product_knowledge: 'product_knowledge',
        competitive: 'competitive',
      };
      setDimension(skillToDimension[weakestSkill] || 'deal_control');
    } else {
      setDimension('deal_control');
    }
  }, [stats, stateDimension]);

  const loadNextKI = useCallback(async (excludeId?: string) => {
    if (!user) return;
    setPhase('loading');
    try {
      const effectiveDimension = branchMode
        ? getBranchDimension(repsDoneRef.current)
        : interleaved
          ? getInterleavedDimension(repsDoneRef.current)
          : dimension;
      let ki: any = null;
      if (stateChapters && stateChapters.length > 0) {
        ki = await selectNextKIFromCategory(user.id, stateChapters, {
          spiderDimension: stateDimension || undefined,
          excludeKiId: excludeId,
        });
      } else if (branchMode) {
        ki = await selectNextBranchKI(user.id, effectiveDimension, excludeId);
      } else if (stateSpecificKIId && repsDoneRef.current === 0) {
        const { data } = await supabase
          .from('knowledge_items')
          .select('id, title, chapter, sub_chapter, spider_dimension, intelligence_type, tactic_summary, when_to_use, when_not_to_use, example_usage, why_it_matters, framework, confidence_score, active')
          .eq('id', stateSpecificKIId)
          .single();
        ki = data ?? null;
        if (!ki) {
          ki = await selectNextKI(user.id, effectiveDimension, excludeId);
        }
      } else if (stateChapter) {
        ki = await selectNextKIFromCategory(user.id, [stateChapter], {
          spiderDimension: stateDimension || undefined,
          excludeKiId: excludeId,
        });
      } else {
        ki = await selectNextKI(user.id, effectiveDimension, excludeId);
      }
      if (ki) {
        setCurrentKI(ki);
        setResponse('');
        setPhase('input');
        setTimeout(() => textareaRef.current?.focus(), 100);
      } else {
        const fallback = await selectNextKI(user.id, 'discovery');
        if (fallback) { setCurrentKI(fallback); setResponse(''); setPhase('input'); }
      }
    } catch {
      setPhase('input');
    }
  }, [user, dimension, interleaved]);

  const loadNextKIRef = useRef(loadNextKI);
  useEffect(() => { loadNextKIRef.current = loadNextKI; }, [loadNextKI]);

  useEffect(() => {
    if (phase !== 'end' || reps.length === 0) return;

    // Write a dojo_sessions row so the streak counter updates
    if (user) {
      const avgScore = Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length);
      const bestScore = Math.max(...reps.map(r => r.score));
      const now = new Date().toISOString();
      const approxStart = new Date(Date.now() - reps.length * 50000).toISOString();
      supabase.from('dojo_sessions').insert({
        user_id: user.id,
        mode: 'sharpen',
        session_type: 'drill',
        skill_focus: dimension,
        difficulty: 'standard',
        status: 'completed',
        best_score: bestScore,
        latest_score: avgScore,
        retry_count: 0,
        started_at: approxStart,
        completed_at: now,
        benchmark_tag: false,
      }).then(() => {
        queryClient.invalidateQueries({ queryKey: ['dojo-stats', user.id] });
      });
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          localStorage.setItem('notifications_enabled', 'true');
        }
      });
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dimension && user) loadNextKI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimension, user]);

  const submitResponse = useCallback(async () => {
    if (!currentKI || !response.trim() || phase !== 'input') return;
    setPhase('scoring');

    const { data: { session } } = await supabase.auth.getSession();
    let score = 50;
    let coaching = '';
    let recognitionScore: number | null = null;
    let executionScore: number | null = null;
    let awarenessScore: number | null = null;

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          scenario: {
            skillFocus: dimension,
            context: currentKI.when_to_use || 'Enterprise sales scenario',
            objection: currentKI.when_to_use || 'Respond to this buyer situation.',
          },
          userResponse: response,
          ki: {
            title: currentKI.title ?? '',
            tactic_summary: currentKI.tactic_summary ?? '',
            example_usage: currentKI.example_usage ?? '',
            when_to_use: currentKI.when_to_use ?? '',
            when_not_to_use: currentKI.when_not_to_use ?? '',
            why_it_matters: currentKI.why_it_matters ?? '',
          },
        }),
      });
      const data = await res.json();
      score = data.score ?? 50;
      coaching = data.feedback || '';
      recognitionScore = data.recognitionScore ?? null;
      executionScore = data.executionScore ?? null;
      awarenessScore = data.awarenessScore ?? null;
    } catch (err: any) {
      const isOffline = !navigator.onLine || err?.message?.includes('fetch');
      if (isOffline) {
        score = 65;
        coaching = '📶 Offline practice rep — scoring unavailable without internet. Keep drilling, this rep is logged.';
      } else {
        coaching = 'Rep recorded.';
      }
    }


    if (user && currentKI) {
      writeKIMastery({
        userId: user.id,
        kiId: currentKI.id,
        chapter: currentKI.chapter,
        spiderDimension: currentKI.spider_dimension ?? null,
        score,
        recognitionScore,
        executionScore,
        awarenessScore,
      }).catch(() => {});
    }

    const newRep: Rep = { ki: currentKI, userResponse: response, score, coaching };
    const newReps = [...reps, newRep];
    setReps(newReps);
    setCurrentScore(score);
    setCurrentCoaching(coaching);
    setRepsDone(prev => prev + 1);
    setPhase('feedback');

    if (newReps.length < TARGET_REPS) {
      const timer = setTimeout(() => {
        loadNextKIRef.current(currentKI.id);
      }, 6000);
      setAutoAdvanceTimer(timer);
    } else {
      setTimeout(() => setPhase('end'), 1500);
    }
  }, [currentKI, response, phase, user, reps, dimension, loadNextKI]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitResponse(); }
  }, [submitResponse]);

  const handleNext = useCallback(() => {
    if (autoAdvanceTimer) { clearTimeout(autoAdvanceTimer); setAutoAdvanceTimer(null); }
    if (repsDone >= TARGET_REPS) { setPhase('end'); return; }
    loadNextKI(currentKI?.id);
  }, [autoAdvanceTimer, repsDone, currentKI, loadNextKI]);

  const avgScore = reps.length > 0 ? Math.round(reps.reduce((a, r) => a + r.score, 0) / reps.length) : 0;
  const worstRep = reps.length > 0 ? reps.reduce((a, r) => r.score < a.score ? r : a) : null;
  const streak = (stats as any)?.streak ?? 0;

  if (phase === 'end') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        {/* Score hero */}
        <div className="flex-1 overflow-y-auto flex flex-col items-center justify-center px-6 gap-6 py-4">
          <div className="text-center space-y-1">
            <p className={cn(
              'text-7xl font-bold font-mono leading-none',
              avgScore >= 70 ? 'text-green-500' :
              avgScore >= 50 ? 'text-amber-500' : 'text-red-500'
            )}>{avgScore}</p>
            <p className="text-base text-muted-foreground">
              {avgScore >= 70 ? 'Strong session' : avgScore >= 50 ? 'Solid work' : 'Keep drilling'}
            </p>
          </div>

          {/* Rep dots recap */}
          <div className="flex items-center gap-2">
            {reps.map((rep, i) => (
              <div
                key={i}
                className={cn(
                  'h-2 w-2 rounded-full',
                  rep.score >= 70 ? 'bg-green-500' :
                  rep.score >= 50 ? 'bg-amber-500' : 'bg-red-500'
                )}
              />
            ))}
          </div>

          {/* Streak */}
          {streak > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-primary/10 border border-primary/20">
              <span className="text-lg">🔥</span>
              <span className="text-sm font-semibold">{streak} day streak</span>
            </div>
          )}

          {/* Daily rep counter — count today's dojo session turns + these reps */}
          <DailyRepCounter completedReps={reps.length} />

          {/* Worst rep coaching note */}
          {worstRep && (
            <div className="w-full max-w-sm rounded-xl border border-border bg-muted/30 p-4 space-y-1.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Coach note</p>
              <p className="text-sm leading-relaxed">{worstRep.coaching}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 pb-safe pb-8 space-y-3">
          <Button
            className="w-full h-12 text-base"
            onClick={() => {
              setReps([]); setRepsDone(0); setCurrentScore(null);
              setCurrentCoaching(''); setPhase('loading'); loadNextKI();
            }}
          >
            Go Again — 5 More Reps
          </Button>
          <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => navigate('/dojo')}>
            Done for now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border/40">
        <div className="flex items-center gap-3">
          {categoryLabel && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              branchMode
                ? 'text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20'
                : 'text-primary bg-primary/10 border border-primary/20'
            }`}>
              {branchMode ? '🌿 Branch' : categoryLabel}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {Array.from({ length: TARGET_REPS }).map((_, i) => (
              <div key={i} className={cn(
                'h-1.5 w-1.5 rounded-full transition-all',
                i < repsDone ? 'bg-primary' : i === repsDone ? 'bg-primary/40 scale-110' : 'bg-muted'
              )} />
            ))}
          </div>
          <span className="text-xs text-muted-foreground">{repsDone}/{TARGET_REPS}</span>
        </div>
        <button onClick={() => navigate('/dojo')} className="text-muted-foreground hover:text-foreground p-1">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {(phase === 'loading' || phase === 'scoring') && (
          <div className="flex items-center justify-center h-32 gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">{phase === 'loading' ? 'Loading rep…' : 'Scoring…'}</span>
          </div>
        )}

        {phase === 'input' && currentKI && (
          <div className="space-y-3">
            {showReviewNotice && repsDone === 0 && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                <span>📞</span>
                <span>{reviewCount} plays flagged from your last call · drilling those first</span>
              </div>
            )}

            {/* First-rep onboarding callout — shows for new users on first rep */}
            {!onboardingDismissed && totalSessions < 5 && repsDone === 0 && (
              <div className="flex items-start justify-between gap-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
                <div className="space-y-0.5 min-w-0">
                  <p className="text-[11px] font-bold text-primary">How this works</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Read the play below. Write exactly what you'd say on a live call. Hit Enter to submit — we'll score you and show you a better version.
                  </p>
                </div>
                <button
                  onClick={() => {
                    setOnboardingDismissed(true);
                    localStorage.setItem('sharpen_onboarded', 'true');
                  }}
                  className="text-[10px] text-muted-foreground/60 hover:text-foreground shrink-0 pt-0.5"
                >
                  Got it
                </button>
              </div>
            )}

            {/* Why this rep */}
            {dimScore !== null && dimScore < 80 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/40 border border-border/40">
                <span className="text-[10px] text-muted-foreground">
                  Your {dimension.replace(/_/g, ' ')} score:{' '}
                  <span className={cn(
                    'font-bold',
                    dimScore < 40 ? 'text-red-500' : dimScore < 65 ? 'text-amber-500' : 'text-yellow-500'
                  )}>{dimScore}/100</span>
                  {' '}on real calls · focus area
                </span>
              </div>
            )}

            <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0">
                  {dimension.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())}
                </p>
                {currentKI.title && (
                  <p className="text-[10px] text-muted-foreground/60 truncate text-right">{currentKI.title}</p>
                )}
              </div>

              {/* The play — what to do */}
              <div className="space-y-1">
                <p className="text-[10px] font-bold text-primary uppercase tracking-wider">The play</p>
                <p className="text-sm leading-relaxed font-medium">
                  {currentKI.tactic_summary || currentKI.when_to_use || currentKI.example_usage}
                </p>
              </div>

              {/* Situation — when to use it */}
              {currentKI.when_to_use && currentKI.tactic_summary && (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">When</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {currentKI.when_to_use.length > 160
                      ? currentKI.when_to_use.substring(0, 160) + '…'
                      : currentKI.when_to_use}
                  </p>
                </div>
              )}

              {/* Example line */}
              {currentKI.example_usage && (
                <div className="pl-3 border-l-2 border-primary/30">
                  <p className="text-[11px] text-muted-foreground italic">
                    "{currentKI.example_usage.length > 130
                      ? currentKI.example_usage.substring(0, 130) + '…'
                      : currentKI.example_usage}"
                  </p>
                </div>
              )}

              <p className="text-[11px] font-semibold text-primary pt-1">
                ↓ Write how you'd say this on a real call
              </p>
            </div>
          </div>
        )}

        {phase === 'feedback' && currentScore !== null && (
          <div className="space-y-3">
            <div className="text-center py-4">
              <p className={cn(
                'text-5xl font-bold font-mono',
                currentScore >= 70 ? 'text-green-500' : currentScore >= 50 ? 'text-amber-500' : 'text-red-500'
              )}>
                {currentScore}
              </p>
            </div>
            {currentCoaching && (
              <div className="p-3 rounded-xl border border-border/60 bg-muted/20">
                <p className="text-sm leading-relaxed text-muted-foreground">{currentCoaching}</p>
              </div>
            )}
            {repsDone < TARGET_REPS && (
              <p className="text-[11px] text-center text-muted-foreground">Next rep in 6s…</p>
            )}
          </div>
        )}
      </div>

      {phase === 'input' && (
        <div className="border-t border-border px-4 py-3 pb-safe bg-background">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              placeholder="Your response… (Enter to submit)"
              value={response}
              onChange={e => setResponse(e.target.value)}
              onKeyDown={handleKeyDown}
              className="text-sm flex-1 min-h-[60px] max-h-[120px] resize-none"
              rows={2}
            />
            <Button
              size="sm"
              disabled={!response.trim()}
              onClick={submitResponse}
              className="self-end shrink-0 h-10"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {phase === 'feedback' && repsDone < TARGET_REPS && (
        <div className="border-t border-border px-4 py-3 pb-safe bg-background">
          <Button className="w-full" onClick={handleNext}>
            Next Rep <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
