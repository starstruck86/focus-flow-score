import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import { SPIDER_DIMENSIONS } from '@/hooks/useKiProficiency';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BookOpen, Target, ChevronRight, Loader2, X, CheckCircle2, Brain } from 'lucide-react';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const DRILL_REPS = 5;

type GrindPhase = 'pick' | 'concept' | 'drilling' | 'scoring' | 'rep-feedback' | 'reflect' | 'complete';

interface DrillResult { score: number; coaching: string; ki: any; }

export default function Grind() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const stateDimension = (location.state as any)?.dimension as string | undefined;

  const [phase, setPhase] = useState<GrindPhase>('pick');
  const [selectedDimension, setSelectedDimension] = useState(stateDimension ?? '');
  const [conceptKI, setConceptKI] = useState<any>(null);
  const [drillKIs, setDrillKIs] = useState<any[]>([]);
  const [currentDrillIdx, setCurrentDrillIdx] = useState(0);
  const [response, setResponse] = useState('');
  const [drillResults, setDrillResults] = useState<DrillResult[]>([]);
  const [currentResult, setCurrentResult] = useState<DrillResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reflectionText, setReflectionText] = useState('');

  // Load concept + drills when dimension selected
  const loadSession = useCallback(async (dimension: string) => {
    if (!user) return;
    setLoading(true);

    // Fetch 1 concept KI (highest confidence) + DRILL_REPS drill KIs
    const conceptResult = await selectNextKI(user.id, dimension);
    setConceptKI(conceptResult);

    // Fetch additional KIs for drills (different from concept)
    const drillSet: any[] = [];
    const excludeIds = conceptResult ? [conceptResult.id] : [];
    for (let i = 0; i < DRILL_REPS; i++) {
      const ki = await selectNextKI(user.id, dimension, excludeIds[excludeIds.length - 1]);
      if (ki && !excludeIds.includes(ki.id)) {
        drillSet.push(ki);
        excludeIds.push(ki.id);
      }
    }
    setDrillKIs(drillSet);
    setLoading(false);
    setPhase('concept');
  }, [user]);

  const submitDrill = useCallback(async () => {
    const ki = drillKIs[currentDrillIdx];
    if (!ki || !response.trim() || !user) return;
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
            skillFocus: selectedDimension,
            context: ki.when_to_use || 'Enterprise sales scenario',
            objection: ki.example_usage || ki.tactic_summary || 'Apply this play.',
          },
          userResponse: response,
          ki: {
            title: ki.title ?? '',
            tactic_summary: ki.tactic_summary ?? '',
            example_usage: ki.example_usage ?? '',
            when_to_use: ki.when_to_use ?? '',
            when_not_to_use: ki.when_not_to_use ?? '',
            why_it_matters: ki.why_it_matters ?? '',
          },
        }),
      });
      const data = await res.json();
      score = data.score ?? 50;
      coaching = data.feedback || '';
      recognitionScore = data.recognitionScore ?? null;
      executionScore = data.executionScore ?? null;
      awarenessScore = data.awarenessScore ?? null;
    } catch { coaching = 'Rep recorded.'; }

    writeKIMastery({
      userId: user.id, kiId: ki.id, chapter: ki.chapter,
      spiderDimension: ki.spider_dimension ?? null, score,
      recognitionScore, executionScore, awarenessScore,
    }).catch(() => {});

    const result: DrillResult = { score, coaching, ki };
    setDrillResults(prev => [...prev, result]);
    setCurrentResult(result);
    // Increment daily rep counter (same key as Sharpen DailyRepCounter)
    const repKey = `daily_reps_${new Date().toISOString().split('T')[0]}`;
    const todayReps = parseInt(localStorage.getItem(repKey) ?? '0', 10);
    localStorage.setItem(repKey, String(todayReps + 1));
    setPhase('rep-feedback');
  }, [drillKIs, currentDrillIdx, response, user, selectedDimension]);

  const nextRep = useCallback(() => {
    const next = currentDrillIdx + 1;
    if (next >= drillKIs.length) {
      setPhase('reflect');
    } else {
      setCurrentDrillIdx(next);
      setResponse('');
      setCurrentResult(null);
      setPhase('drilling');
    }
  }, [currentDrillIdx, drillKIs.length]);

  const avgScore = drillResults.length > 0
    ? Math.round(drillResults.reduce((a, r) => a + r.score, 0) / drillResults.length) : 0;

  const dimLabel = SPIDER_DIMENSIONS.find(d => d.key === selectedDimension)?.label ?? selectedDimension;

  // ─── PICK PHASE ────────────────────────────────────────────────────
  if (phase === 'pick') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border/40">
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Grind Session</span>
            </div>
            {selectedDimension && (
              <span className="text-[10px] text-muted-foreground ml-6">Drilling: {dimLabel}</span>
            )}
          </div>
          <button onClick={() => navigate('/dojo')} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          <p className="text-xs text-muted-foreground">Pick a topic. You'll get concept → 5 drills → reflection.</p>
          <div className="grid grid-cols-1 gap-2">
            {SPIDER_DIMENSIONS.map(dim => (
              <button
                key={dim.key}
                onClick={() => { setSelectedDimension(dim.key); loadSession(dim.key); }}
                className="w-full text-left p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-primary/5 transition-all flex items-center gap-3"
              >
                <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dim.color }} />
                <span className="text-sm font-medium">{dim.label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── LOADING ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="fixed inset-0 bg-background flex items-center justify-center gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        <span className="text-sm">Loading your {dimLabel} session…</span>
      </div>
    );
  }

  // ─── CONCEPT PHASE ─────────────────────────────────────────────────
  if (phase === 'concept' && conceptKI) {
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border/40">
          <div>
            <Badge variant="outline" className="text-[10px]">{dimLabel}</Badge>
          </div>
          <button onClick={() => navigate('/dojo')} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">The Play</p>
            <p className="text-lg font-bold leading-snug">{conceptKI.title}</p>
          </div>
          {conceptKI.tactic_summary && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">What It Does</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{conceptKI.tactic_summary}</p>
            </div>
          )}
          {conceptKI.when_to_use && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-green-600 dark:text-green-400 uppercase tracking-wider">When to Use</p>
              <p className="text-sm leading-relaxed">{conceptKI.when_to_use}</p>
            </div>
          )}
          {conceptKI.when_not_to_use && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 uppercase tracking-wider">When NOT to Use</p>
              <p className="text-sm leading-relaxed">{conceptKI.when_not_to_use}</p>
            </div>
          )}
          {conceptKI.example_usage && (
            <Card className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                  <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Real Call Example</p>
                </div>
                <p className="text-sm italic leading-relaxed">"{conceptKI.example_usage}"</p>
              </CardContent>
            </Card>
          )}
          {conceptKI.why_it_matters && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Why It Matters</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{conceptKI.why_it_matters}</p>
            </div>
          )}
        </div>
        <div className="border-t border-border px-4 py-3 pb-safe bg-background">
          <Button className="w-full" onClick={() => { setCurrentDrillIdx(0); setPhase('drilling'); }}>
            Start Drilling <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── DRILLING + SCORING + REP-FEEDBACK ────────────────────────────
  if (phase === 'drilling' || phase === 'scoring' || phase === 'rep-feedback') {
    const currentKI = drillKIs[currentDrillIdx];
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border/40">
          <div className="flex items-center gap-3">
            <div className="flex gap-1">
              {Array.from({ length: drillKIs.length }).map((_, i) => (
                <div key={i} className={cn('h-1.5 w-1.5 rounded-full transition-all',
                  i < currentDrillIdx ? 'bg-primary' :
                  i === currentDrillIdx ? 'bg-primary/50 scale-125' : 'bg-muted'
                )} />
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{currentDrillIdx + 1}/{drillKIs.length} · {dimLabel}</span>
          </div>
          <button onClick={() => navigate('/dojo')} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {(phase === 'drilling' || phase === 'scoring') && currentKI && (
            <Card>
              <CardContent className="p-4 space-y-2">
                <p className="text-xs text-muted-foreground">Apply the play — respond to this:</p>
                <p className="text-sm leading-relaxed">{currentKI.when_to_use || currentKI.tactic_summary}</p>
              </CardContent>
            </Card>
          )}
          {phase === 'scoring' && (
            <div className="flex items-center gap-2 text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Scoring…</span>
            </div>
          )}
          {phase === 'rep-feedback' && currentResult && (
            <div className="space-y-3">
              <div className="text-center py-3">
                <p className={cn('text-5xl font-bold font-mono',
                  currentResult.score >= 70 ? 'text-green-500' :
                  currentResult.score >= 50 ? 'text-amber-500' : 'text-red-500'
                )}>{currentResult.score}</p>
              </div>
              <Card className="border-border/40">
                <CardContent className="p-3">
                  <p className="text-sm leading-relaxed text-muted-foreground">{currentResult.coaching}</p>
                </CardContent>
              </Card>
              {currentResult.ki?.example_usage && (
                <Card className="border-amber-500/20 bg-amber-500/5">
                  <CardContent className="p-3 space-y-1">
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">Real Call Example</p>
                    <p className="text-xs italic leading-relaxed text-muted-foreground">"{currentResult.ki.example_usage}"</p>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
        {phase === 'drilling' && (
          <div className="border-t border-border px-4 py-3 pb-safe bg-background space-y-2">
            <Textarea
              placeholder="Your response…"
              value={response}
              onChange={e => setResponse(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitDrill(); } }}
              className="text-sm min-h-[72px] max-h-[140px] resize-none"
              rows={3}
            />
            <Button className="w-full" disabled={!response.trim()} onClick={submitDrill}>
              Submit
            </Button>
          </div>
        )}
        {phase === 'rep-feedback' && (
          <div className="border-t border-border px-4 py-3 pb-safe bg-background">
            <Button className="w-full" onClick={nextRep}>
              {currentDrillIdx + 1 >= drillKIs.length ? 'Reflect' : 'Next Rep'}
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ─── REFLECT PHASE ─────────────────────────────────────────────────
  if (phase === 'reflect') {
    return (
      <div className="fixed inset-0 bg-background flex flex-col">
        <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border/40">
          <span className="text-sm font-semibold">Reflection</span>
          <button onClick={() => navigate('/dojo')} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          <div className="text-center space-y-1">
            <p className={cn('text-4xl font-bold font-mono', avgScore >= 70 ? 'text-green-500' : avgScore >= 50 ? 'text-amber-500' : 'text-red-500')}>
              {avgScore}
            </p>
            <p className="text-xs text-muted-foreground">{DRILL_REPS} reps · {dimLabel}</p>
          </div>
          <div className="space-y-1.5">
            {drillResults.map((r, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground truncate flex-1 mr-2">Rep {i + 1}: {r.coaching.substring(0, 60)}{r.coaching.length > 60 ? '…' : ''}</span>
                <span className={cn('font-mono font-bold shrink-0', r.score >= 70 ? 'text-green-500' : r.score >= 50 ? 'text-amber-500' : 'text-red-500')}>{r.score}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-medium">What will you do differently on your next call because of this session?</p>
            <Textarea
              placeholder="One specific change…"
              value={reflectionText}
              onChange={e => setReflectionText(e.target.value)}
              className="text-sm min-h-[80px] resize-none"
              rows={3}
            />
          </div>
        </div>
        <div className="border-t border-border px-4 py-3 pb-safe bg-background">
          <Button className="w-full" onClick={() => {
            if (user && drillResults.length > 0) {
              const now = new Date().toISOString();
              const approxStart = new Date(Date.now() - drillResults.length * 55000).toISOString();
              supabase.from('dojo_sessions').insert({
                user_id: user.id,
                mode: 'grind',
                session_type: 'drill',
                skill_focus: selectedDimension,
                difficulty: 'standard',
                status: 'completed',
                best_score: Math.max(...drillResults.map(r => r.score)),
                latest_score: avgScore,
                retry_count: 0,
                started_at: approxStart,
                completed_at: now,
                benchmark_tag: false,
              }).then(() => {
                queryClient.invalidateQueries({ queryKey: ['dojo-stats', user.id] });
              });
            }
            setPhase('complete');
          }}>
            <CheckCircle2 className="h-4 w-4 mr-2" />
            Complete Session
          </Button>
        </div>
      </div>
    );
  }

  // ─── COMPLETE ──────────────────────────────────────────────────────
  if (phase === 'complete') {
    const scoreColor = avgScore >= 85 ? 'text-green-500' : avgScore >= 70 ? 'text-yellow-500' : 'text-orange-500';
    const coachNote = avgScore >= 85
      ? 'Elite execution. Take this exact pattern into your next live call.'
      : avgScore >= 70
        ? 'Solid work. One more pass and this becomes automatic.'
        : 'Reps logged. Run it again — the pattern only sticks with repetition.';
    return (
      <div className="fixed inset-0 bg-background flex flex-col items-center justify-center px-6 gap-5">
        <div className="text-center">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{dimLabel}</p>
          <p className={`text-7xl font-bold tabular-nums ${scoreColor}`}>{avgScore}</p>
          <p className="text-xs text-muted-foreground mt-1">avg across {DRILL_REPS} reps</p>
        </div>
        <Card className="w-full max-w-sm border-border/50">
          <CardContent className="p-3">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Coach</p>
            <p className="text-sm leading-relaxed">{coachNote}</p>
          </CardContent>
        </Card>
        {reflectionText && (
          <Card className="w-full max-w-sm border-primary/20 bg-primary/5">
            <CardContent className="p-3">
              <p className="text-[10px] font-semibold text-primary uppercase tracking-wider mb-1">Your commitment</p>
              <p className="text-sm leading-relaxed">{reflectionText}</p>
            </CardContent>
          </Card>
        )}
        <div className="space-y-2 w-full max-w-sm">
          <Button className="w-full" onClick={() => { setPhase('pick'); setDrillResults([]); setCurrentDrillIdx(0); }}>
            Go Again
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate('/dojo')}>
            Done
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
