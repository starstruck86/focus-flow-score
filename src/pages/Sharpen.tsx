import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import { useDojoStats } from '@/lib/dojo/useDojoStreak';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { Flame, ChevronRight, Loader2, X } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const TARGET_REPS = 5;

const DIMENSION_CYCLE = [
  'deal_control', 'expansion_strategy', 'stakeholder_navigation',
  'internal_prospecting', 'discovery', 'messaging',
];

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
  const stateDimension = (location.state as any)?.dimension;
  const { user } = useAuth();
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
      const effectiveDimension = interleaved ? getInterleavedDimension(repsDoneRef.current) : dimension;
      const ki = await selectNextKI(user.id, effectiveDimension, excludeId);
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

  useEffect(() => {
    if (phase !== 'end') return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          localStorage.setItem('notifications_enabled', 'true');
        }
      });
    }
  }, [phase]);

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

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          scenario: {
            skillFocus: currentKI.chapter || dimension,
            context: currentKI.when_to_use || 'Enterprise sales scenario',
            objection: currentKI.example_usage || currentKI.tactic_summary || 'Respond to this situation.',
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
      const rawFeedback = data.feedback || '';
      coaching = rawFeedback.split(/[.!?]/)[0].trim() + '.';
    } catch {
      coaching = 'Rep recorded.';
    }

    if (user && currentKI) {
      writeKIMastery({
        userId: user.id,
        kiId: currentKI.id,
        chapter: currentKI.chapter,
        spiderDimension: currentKI.spider_dimension ?? null,
        score,
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
        loadNextKI(currentKI.id);
      }, 3000);
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
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6">
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
            <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-2">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {dimension.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </p>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-primary uppercase tracking-wider">Apply this play:</p>
                <p className="text-sm leading-relaxed">
                  {currentKI.when_to_use || currentKI.tactic_summary || currentKI.example_usage}
                </p>
                {currentKI.example_usage && currentKI.when_to_use && (
                  <p className="text-[11px] text-muted-foreground italic leading-relaxed">
                    e.g. "{currentKI.example_usage.substring(0, 120)}{currentKI.example_usage.length > 120 ? '…' : ''}"
                  </p>
                )}
              </div>
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
              <p className="text-[11px] text-center text-muted-foreground">Next rep in 3s…</p>
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
