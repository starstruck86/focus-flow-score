import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useBandGate } from '@/hooks/train/useBandGate';
import { runBandGate, writeTrainSession, type BandGateRunResult } from '@/lib/train/engine';
import { BAND_NAMES, type Band } from '@/types/train';
import { AlertTriangle, CheckCircle2, Trophy } from 'lucide-react';

type Phase = 'intro' | 'rep' | 'scored';

export default function TrainBandGate() {
  const { spoke = 'product', topic = 'deep_linking', band: bandStr = '1' } = useParams();
  const band = (Math.max(1, Math.min(5, Number(bandStr))) as Band);
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, error } = useBandGate(spoke, topic, band);

  const [phase, setPhase] = useState<Phase>('intro');
  const [idx, setIdx] = useState(0);
  const [responses, setResponses] = useState<string[]>([]);
  const [current, setCurrent] = useState('');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BandGateRunResult | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());

  const items = useMemo(() => {
    if (!data) return [];
    return (data.pool ?? []).slice(0, 5).map((ki) => ({
      objection: ki.scenario ?? ki.when_to_use ?? 'Respond to this buyer situation.',
      sourceKiId: ki.ki_id,
      sourceTitle: ki.title,
    }));
  }, [data]);

  async function finalize(allResponses: string[]) {
    if (!user || !data?.gate) return;
    setRunning(true);
    try {
      const r = await runBandGate({
        userId: user.id,
        spoke, topic, band,
        skillFocus: topic,
        gate: data.gate,
        items: items.map((it, i) => ({
          objection: it.objection,
          userResponse: allResponses[i] ?? '',
          sourceKiId: it.sourceKiId,
          sourceTitle: it.sourceTitle,
        })),
      });
      setResult(r);
      setPhase('scored');
      try {
        await writeTrainSession({
          userId: user.id,
          mode: 'band_gate',
          skillFocus: topic,
          band,
          bestScore: r.avgScore,
          latestScore: r.avgScore,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    } catch (e) {
      alert(`Gate failed: ${(e as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  function submitItem() {
    const next = [...responses, current];
    setResponses(next);
    setCurrent('');
    if (idx + 1 >= items.length) {
      finalize(next);
    } else {
      setIdx(idx + 1);
    }
  }

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <button
            onClick={() => navigate(`/train/${spoke}/${topic}`)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← Ladder
          </button>
          <h1 className="text-xl font-bold mt-2">Band {band} Gate · {BAND_NAMES[band]}</h1>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading gate…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}
        {data && !data.gate && (
          <Card className="p-4 text-sm">No gate configured for this band.</Card>
        )}
        {data?.gate && items.length === 0 && (
          <Card className="p-4 text-sm">No exemplar pool available for this band.</Card>
        )}

        {data?.gate && items.length > 0 && phase === 'intro' && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-amber-500">
              <AlertTriangle className="h-3.5 w-3.5" /> Cold capstone
            </div>
            <p className="text-sm mb-2">
              No teaching. No hints. {items.length} items. Pass = avg ≥ {data.gate.pass_threshold}.
            </p>
            <div className="rounded-md bg-muted/40 p-3 text-sm mb-3">{data.gate.gate_prompt}</div>
            <div className="flex justify-end">
              <Button onClick={() => setPhase('rep')}>Start gate</Button>
            </div>
          </Card>
        )}

        {data?.gate && phase === 'rep' && items[idx] && (
          <Card className="p-4">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">
              Item {idx + 1} / {items.length}
            </div>
            <p className="text-sm bg-muted/40 rounded p-3 mb-3">{items[idx].objection}</p>
            <Textarea
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Your response…"
              rows={6}
            />
            <div className="flex justify-end mt-3">
              <Button onClick={submitItem} disabled={running || current.trim().length < 5}>
                {idx + 1 >= items.length ? (running ? 'Scoring…' : 'Submit gate') : 'Next item'}
              </Button>
            </div>
          </Card>
        )}

        {phase === 'scored' && result && (
          <Card className="p-4">
            <div className="flex items-center gap-3 mb-3">
              {result.passed ? (
                <Trophy className="h-8 w-8 text-green-500" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-amber-500" />
              )}
              <div>
                <div className="text-2xl font-bold">
                  {result.avgScore} <span className="text-sm text-muted-foreground">/ {result.passThreshold}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {result.passed ? 'Passed' : 'Failed — retake available now'}
                </div>
              </div>
            </div>

            {result.passed && (
              <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 mb-3 text-sm">
                <div className="flex items-center gap-2 font-semibold mb-1">
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                  {data?.gate?.promotes_to
                    ? `You're now ${BAND_NAMES[data.gate.promotes_to]}`
                    : 'Top band cleared — fully certified'}
                </div>
                {result.nextRetestDue && (
                  <div className="text-xs text-muted-foreground">
                    Retest due {new Date(result.nextRetestDue).toLocaleDateString()}
                  </div>
                )}
              </div>
            )}

            {result.weakest && (
              <div className="rounded-md border border-border bg-muted/30 p-3 mb-3 text-sm">
                <div className="text-[11px] uppercase text-muted-foreground mb-1">Weakest item ({result.weakest.score})</div>
                <div className="text-xs font-mono text-muted-foreground mb-1">{result.weakest.sourceTitle}</div>
                <div className="whitespace-pre-wrap">{result.weakest.feedback}</div>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => navigate(`/train/${spoke}/${topic}`)}>Back to ladder</Button>
              {!result.passed && (
                <Button onClick={() => {
                  setPhase('intro'); setIdx(0); setResponses([]); setCurrent(''); setResult(null);
                }}>Retake</Button>
              )}
            </div>
          </Card>
        )}
      </main>
    </Layout>
  );
}
