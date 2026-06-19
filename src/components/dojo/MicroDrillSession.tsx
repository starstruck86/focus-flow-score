import { useState, useCallback, useRef, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, ChevronRight, Flame } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { selectNextKI } from '@/lib/dojo/selectNextKI';
import { writeKIMastery } from '@/lib/dojo/kiMasteryWriter';
import { cn } from '@/lib/utils';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

interface MicroRep {
  scenario: string;
  kiTitle: string;
  score: number | null;
  coaching: string;
}

interface MicroDrillSessionProps {
  userId: string;
  dimension: string;
  onExit: () => void;
}

export function MicroDrillSession({ userId, dimension, onExit }: MicroDrillSessionProps) {
  const [ki, setKI] = useState<any>(null);
  const [response, setResponse] = useState('');
  const [scoring, setScoring] = useState(false);
  const [lastRep, setLastRep] = useState<MicroRep | null>(null);
  const [repCount, setRepCount] = useState(0);
  const [totalScore, setTotalScore] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadNextKI = useCallback(async (excludeId?: string) => {
    const next = await selectNextKI(userId, dimension, excludeId);
    setKI(next);
    setResponse('');
    setLastRep(null);
    setTimeout(() => inputRef.current?.focus(), 100);
  }, [userId, dimension]);

  useEffect(() => { loadNextKI(); }, [loadNextKI]);

  const submit = useCallback(async () => {
    if (!ki || !response.trim() || scoring) return;
    setScoring(true);

    const { data: { session } } = await supabase.auth.getSession();

    let score = 50;
    let coaching = '';

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          userResponse: response,
          scenario: {
            prompt: ki.example_usage || ki.tactic_summary || '',
            skillFocus: dimension,
            title: ki.title || '',
          },
          ki: {
            tactic_summary: ki.tactic_summary,
            why_it_matters: ki.why_it_matters,
            when_to_use: ki.when_to_use,
          },
          microMode: true,
        }),
      });
      const data = await res.json();
      score = data.score ?? 50;
      const rawFeedback = data.feedback || data.coaching || '';
      coaching = rawFeedback.split(/[.!?]/)[0].trim() + (rawFeedback.includes('.') ? '.' : '');
    } catch {
      coaching = 'Submit recorded.';
    }

    await writeKIMastery({
      userId,
      kiId: ki.id,
      chapter: ki.chapter,
      spiderDimension: ki.spider_dimension ?? null,
      score,
    }).catch(() => {});

    setLastRep({
      scenario: ki.example_usage || ki.tactic_summary || '',
      kiTitle: ki.title || '',
      score,
      coaching,
    });
    setRepCount(r => r + 1);
    setTotalScore(t => t + score);
    setScoring(false);

    setTimeout(() => loadNextKI(ki.id), 1800);
  }, [ki, response, scoring, userId, dimension, loadNextKI]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }, [submit]);

  const avgScore = repCount > 0 ? Math.round(totalScore / repCount) : 0;

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 pt-safe pt-4 pb-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Flame className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Quick Drill</span>
          <Badge variant="outline" className="text-[10px]">{dimension.replace('_', ' ')}</Badge>
        </div>
        <div className="flex items-center gap-3">
          {repCount > 0 && (
            <span className="text-xs text-muted-foreground">{repCount} reps · {avgScore} avg</span>
          )}
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onExit}>Done</Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {ki && !lastRep && (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground mb-1 uppercase tracking-wide font-medium">Respond to this</p>
              <p className="text-sm leading-relaxed">{ki.example_usage || ki.tactic_summary}</p>
            </CardContent>
          </Card>
        )}

        {lastRep && (
          <div className="space-y-2">
            <Card className={cn(
              'border',
              (lastRep.score ?? 0) >= 70 ? 'border-green-500/30 bg-green-500/5' :
              (lastRep.score ?? 0) >= 50 ? 'border-amber-500/30 bg-amber-500/5' :
              'border-red-500/30 bg-red-500/5'
            )}>
              <CardContent className="p-3 flex items-start justify-between gap-3">
                <p className="text-xs leading-relaxed text-muted-foreground">{lastRep.coaching}</p>
                <span className={cn(
                  'text-sm font-bold font-mono shrink-0',
                  (lastRep.score ?? 0) >= 70 ? 'text-green-600' :
                  (lastRep.score ?? 0) >= 50 ? 'text-amber-600' : 'text-red-600'
                )}>
                  {lastRep.score}
                </span>
              </CardContent>
            </Card>
            <p className="text-[11px] text-center text-muted-foreground">Loading next rep…</p>
          </div>
        )}

        {scoring && (
          <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Scoring…
          </div>
        )}
      </div>

      <div className="border-t border-border px-4 py-3 pb-safe bg-background">
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder="Your response…"
            value={response}
            onChange={e => setResponse(e.target.value)}
            onKeyDown={handleKey}
            disabled={scoring || !!lastRep || !ki}
            className="text-sm flex-1"
            autoComplete="off"
          />
          <Button
            size="sm"
            disabled={!response.trim() || scoring || !!lastRep || !ki}
            onClick={submit}
            className="shrink-0"
          >
            {scoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </Button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center mt-1.5">Enter to submit · auto-advances after scoring</p>
      </div>
    </div>
  );
}
