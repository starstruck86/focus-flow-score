import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Target, ChevronRight, CheckCircle2, Loader2 } from 'lucide-react';
import { SPIDER_DIMENSIONS } from '@/hooks/useKiProficiency';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

type BenchmarkPhase = 'intro' | 'loading' | 'session' | 'scoring' | 'results';

interface DimResult {
  dimension: string;
  label: string;
  score: number;
  feedback: string;
}

export default function Benchmark() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<BenchmarkPhase>('intro');
  const [benchmarkKIs, setBenchmarkKIs] = useState<Record<string, any>>({});
  const [dimOrder, setDimOrder] = useState<string[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [response, setResponse] = useState('');
  const [results, setResults] = useState<DimResult[]>([]);
  const [saving, setSaving] = useState(false);

  const startBenchmark = useCallback(async () => {
    setPhase('loading');
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setPhase('intro');
      return;
    }

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/get-benchmark-kis`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const { benchmarkKIs: kis } = await res.json();
      const dims = Object.keys(kis).filter((d) => kis[d]);
      setBenchmarkKIs(kis);
      setDimOrder(dims);
      setPhase('session');
    } catch {
      setPhase('intro');
    }
  }, []);

  const submitResponse = useCallback(async () => {
    if (!response.trim() || dimOrder.length === 0) return;
    setPhase('scoring');

    const dim = dimOrder[currentIdx];
    const ki = benchmarkKIs[dim];
    const dimLabel = SPIDER_DIMENSIONS.find((d) => d.key === dim)?.label ?? dim;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setPhase('session');
      return;
    }

    let score = 50;
    let feedback = '';

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/dojo-score`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          userResponse: response,
          scenario: {
            prompt: ki?.example_usage || ki?.tactic_summary || ki?.title || '',
            skillFocus: dim,
            title: ki?.title || '',
          },
          ki: {
            tactic_summary: ki?.tactic_summary,
            why_it_matters: ki?.why_it_matters,
            when_to_use: ki?.when_to_use,
          },
          benchmarkMode: true,
        }),
      });
      const data = await res.json();
      score = data.score ?? 50;
      feedback = data.feedback ?? '';
    } catch {
      // fallback score
    }

    const newResult: DimResult = { dimension: dim, label: dimLabel, score, feedback };
    const updatedResults = [...results, newResult];
    setResults(updatedResults);

    const next = currentIdx + 1;
    if (next < dimOrder.length) {
      setCurrentIdx(next);
      setResponse('');
      setPhase('session');
    } else {
      setSaving(true);
      const scores: Record<string, number> = {};
      updatedResults.forEach((r) => {
        scores[r.dimension] = r.score;
      });
      const overall = Math.round(
        updatedResults.reduce((a, r) => a + r.score, 0) / updatedResults.length
      );

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await (supabase as any).from('skill_benchmarks').insert({
          user_id: user.id,
          scores,
          overall_avg: overall,
          dimension_count: updatedResults.length,
        });
      }
      setSaving(false);
      setPhase('results');
    }
  }, [response, dimOrder, currentIdx, benchmarkKIs, results]);

  const currentKI = dimOrder[currentIdx] ? benchmarkKIs[dimOrder[currentIdx]] : null;
  const currentDimLabel =
    SPIDER_DIMENSIONS.find((d) => d.key === dimOrder[currentIdx])?.label ?? '';
  const overall =
    results.length > 0
      ? Math.round(results.reduce((a, r) => a + r.score, 0) / results.length)
      : 0;

  return (
    <Layout>
      <div className="px-4 pt-4 pb-24 space-y-4 max-w-lg mx-auto">
        <div className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          <h1 className="font-display text-xl font-bold">Skill Benchmark</h1>
        </div>

        {phase === 'intro' && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <p className="text-sm font-medium">Baseline your skills before Branch.io</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                10 scenarios across all spider dimensions. One KI per dimension, randomly selected from the top plays. Takes 15-20 minutes. Your results seed the spider chart and set the benchmark every future session is measured against.
              </p>
              <div className="space-y-1.5 pt-1">
                {SPIDER_DIMENSIONS.map((d) => (
                  <div key={d.key} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <div className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: d.color }} />
                    {d.label}
                  </div>
                ))}
              </div>
              <Button className="w-full mt-2" onClick={startBenchmark}>
                Start Benchmark <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </CardContent>
          </Card>
        )}

        {phase === 'loading' && (
          <Card>
            <CardContent className="p-6 flex items-center justify-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading benchmark scenarios…</p>
            </CardContent>
          </Card>
        )}

        {(phase === 'session' || phase === 'scoring') && currentKI && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Badge variant="outline" className="text-xs">{currentDimLabel}</Badge>
              <span className="text-xs text-muted-foreground">
                {currentIdx + 1} / {dimOrder.length}
              </span>
            </div>

            <div className="h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${(currentIdx / dimOrder.length) * 100}%` }}
              />
            </div>

            <Card>
              <CardContent className="p-4 space-y-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Scenario
                </p>
                <p className="text-sm leading-relaxed">
                  {currentKI.example_usage || currentKI.tactic_summary || currentKI.title}
                </p>
                <p className="text-xs text-muted-foreground">KI: {currentKI.title}</p>
              </CardContent>
            </Card>

            <Textarea
              placeholder="Write your response…"
              className="min-h-[120px] text-sm resize-none"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              disabled={phase === 'scoring'}
            />

            <Button
              className="w-full"
              disabled={!response.trim() || phase === 'scoring'}
              onClick={submitResponse}
            >
              {phase === 'scoring' ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Scoring…
                </>
              ) : (
                <>Submit{currentIdx < dimOrder.length - 1 ? ' & Next' : ' & Finish'}</>
              )}
            </Button>
          </div>
        )}

        {phase === 'results' && (
          <div className="space-y-3">
            {saving && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Saving results…
              </div>
            )}

            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-4 text-center">
                <p className="text-4xl font-bold font-mono text-primary">{overall}</p>
                <p className="text-xs text-muted-foreground mt-1">Overall baseline score</p>
              </CardContent>
            </Card>

            <div className="space-y-2">
              {[...results].sort((a, b) => a.score - b.score).map((r) => (
                <Card key={r.dimension}>
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{r.label}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.feedback ? `${r.feedback.substring(0, 80)}…` : ''}
                      </p>
                    </div>
                    <span
                      className={cn(
                        'text-lg font-bold font-mono shrink-0',
                        r.score >= 70
                          ? 'text-green-600'
                          : r.score >= 50
                          ? 'text-amber-600'
                          : 'text-red-600'
                      )}
                    >
                      {r.score}
                    </span>
                  </CardContent>
                </Card>
              ))}
            </div>

            <Button className="w-full" onClick={() => navigate('/skills')}>
              <CheckCircle2 className="h-4 w-4 mr-2" />
              View Spider Chart
            </Button>
          </div>
        )}
      </div>
    </Layout>
  );
}
