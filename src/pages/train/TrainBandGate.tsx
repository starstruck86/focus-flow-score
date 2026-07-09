import { useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

import { useAuth } from '@/contexts/AuthContext';
import { useBandGate } from '@/hooks/train/useBandGate';
import { scoreRep, writeTrainSession } from '@/lib/train/engine';
import { recordBandGateAttempt, summarizeBandGate } from '@/lib/train/competency';
import { BAND_NAMES, TRAIN_TUNABLES, type Band, type CurriculumKi } from '@/types/train';
import { AlertTriangle, CheckCircle2, Trophy, ArrowRight } from 'lucide-react';

type Phase = 'intro' | 'rep' | 'item_scored' | 'summary';

interface GateItem {
  objection: string;
  sourceKi: CurriculumKi | null;
  sourceKiId: string;
  sourceTitle: string;
  eliteAnswer: string | null;
  eliteLabel: 'ELITE ANSWER' | 'KEY POINTS';
  promptOnly: boolean;
}

interface ItemRecord {
  objection: string;
  userResponse: string;
  score: number;
  feedback: string;
  eliteAnswer: string | null;
  eliteLabel: 'ELITE ANSWER' | 'KEY POINTS';
  sourceTitle: string;
}

function truncate(s: string, n: number) {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

function scoreColor(score: number) {
  if (score >= 85) return 'text-green-500 border-green-500/40 bg-green-500/10';
  if (score >= 70) return 'text-amber-500 border-amber-500/40 bg-amber-500/10';
  return 'text-red-500 border-red-500/40 bg-red-500/10';
}

export default function TrainBandGate() {
  const { spoke = 'product', topic = 'deep_linking', band: bandStr = '1' } = useParams();
  const band = (Math.max(1, Math.min(5, Number(bandStr))) as Band);
  const navigate = useNavigate();
  const location = useLocation();
  const fromGatesHub = location.pathname.startsWith('/gates');
  const backPath = fromGatesHub ? '/gates' : `/train/${spoke}/${topic}`;
  const backLabel = fromGatesHub ? '← Gates' : '← Ladder';
  const { user } = useAuth();
  const { data, isLoading, error } = useBandGate(spoke, topic, band);

  const [phase, setPhase] = useState<Phase>('intro');
  const [idx, setIdx] = useState(0);
  const [records, setRecords] = useState<ItemRecord[]>([]);
  const [current, setCurrent] = useState('');
  const [scoring, setScoring] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [lastResult, setLastResult] = useState<{ score: number; feedback: string } | null>(null);
  const [finalSummary, setFinalSummary] = useState<{
    avgScore: number; passed: boolean; nextRetestDue: string | null;
  } | null>(null);
  const [startedAt] = useState(() => new Date().toISOString());

  const items: GateItem[] = useMemo(() => {
    if (!data) return [];
    return (data.pool ?? []).slice(0, TRAIN_TUNABLES.bandGateItemCount).map((ki) => {
      const promptOnly = !!ki.promptOnly || !ki.ki_id;
      const eliteAnswer = promptOnly
        ? (ki.tactic_summary ?? null)
        : (ki.modelLinePlain ?? ki.tactic_summary ?? null);
      return {
        objection: ki.scenario ?? ki.when_to_use ?? 'Respond to this buyer situation.',
        sourceKi: promptOnly ? null : ki,
        sourceKiId: ki.ki_id,
        sourceTitle: ki.title,
        eliteAnswer,
        eliteLabel: promptOnly ? 'KEY POINTS' : 'ELITE ANSWER',
        promptOnly,
      };
    });
  }, [data]);

  async function submitItem() {
    if (!items[idx] || scoring) return;
    setScoring(true);
    try {
      const it = items[idx];
      // Gate items are band exemplars — pass the concept's model_line_plain as
      // gold so the grader evaluates AGAINST it (not just calibrated priors).
      const modelLine = it.sourceKi?.modelLinePlain ?? it.eliteAnswer ?? null;
      const gold = modelLine && modelLine.trim().length > 0
        ? { model_line: modelLine }
        : null;
      const scored = await scoreRep({
        skillFocus: topic,
        userResponse: current,
        objection: it.objection,
        ki: null, // gate = cold
        gold,
      });
      const rec: ItemRecord = {
        objection: it.objection,
        userResponse: current,
        score: scored.score,
        feedback: scored.feedback,
        eliteAnswer: it.eliteAnswer,
        eliteLabel: it.eliteLabel,
        sourceTitle: it.sourceTitle,
      };
      setRecords((r) => [...r, rec]);
      setLastResult({ score: scored.score, feedback: scored.feedback });
      setPhase('item_scored');
    } catch (e) {
      alert(`Scoring failed: ${(e as Error).message}`);
    } finally {
      setScoring(false);
    }
  }

  async function advance() {
    const isLast = idx + 1 >= items.length;
    if (!isLast) {
      setIdx(idx + 1);
      setCurrent('');
      setLastResult(null);
      setPhase('rep');
      return;
    }
    // Finalize
    if (!user || !data?.gate) return;
    setFinalizing(true);
    try {
      const scores = records.map((r) => r.score);
      const threshold = data.gate.pass_threshold;
      const summary = summarizeBandGate(scores, threshold);
      const persisted = await recordBandGateAttempt({
        userId: user.id,
        spoke, topic, band,
        attempt: { ...summary, band },
        passThreshold: threshold,
        promotesTo: data.gate.promotes_to,
      });
      setFinalSummary({
        avgScore: summary.avgScore,
        passed: summary.passed,
        nextRetestDue: persisted.next_retest_due ?? null,
      });
      setPhase('summary');
      try {
        await writeTrainSession({
          userId: user.id,
          mode: 'band_gate',
          skillFocus: topic,
          band,
          bestScore: summary.avgScore,
          latestScore: summary.avgScore,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      } catch { /* ignore */ }
    } catch (e) {
      alert(`Gate finalize failed: ${(e as Error).message}`);
    } finally {
      setFinalizing(false);
    }
  }

  function retake() {
    setPhase('intro');
    setIdx(0);
    setRecords([]);
    setCurrent('');
    setLastResult(null);
    setFinalSummary(null);
  }

  const threshold = data?.gate?.pass_threshold ?? TRAIN_TUNABLES.bandGatePassThreshold;

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <button
            onClick={() => navigate(backPath)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {backLabel}
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
              No teaching. No hints. {items.length} items. Pass = avg ≥ {threshold}.
            </p>
            <div className="rounded-md bg-muted/40 p-3 text-sm mb-3">{data.gate.gate_prompt}</div>
            <div className="flex justify-end">
              <Button onClick={() => setPhase('rep')}>Start gate</Button>
            </div>
          </Card>
        )}

        {data?.gate && phase === 'rep' && items[idx] && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Item {idx + 1} / {items.length}
              </div>
              <span className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider px-1.5 py-0.5 font-medium">
                <AlertTriangle className="h-3 w-3" /> Gate
              </span>
            </div>
            <p className="text-sm bg-muted/40 rounded p-3 mb-3">{items[idx].objection}</p>
            <Textarea
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              placeholder="Your response…"
              rows={6}
            />
            <div className="flex justify-end mt-3">
              <Button onClick={submitItem} disabled={scoring || current.trim().length < 5}>
                {scoring ? 'Scoring…' : 'Submit answer'}
              </Button>
            </div>
          </Card>
        )}

        {phase === 'item_scored' && lastResult && items[idx] && (
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Item {idx + 1} / {items.length}
                </div>
                <span className="inline-flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] uppercase tracking-wider px-1.5 py-0.5 font-medium">
                  <AlertTriangle className="h-3 w-3" /> Gate
                </span>
              </div>
              <div className={cn('rounded border px-2 py-0.5 text-sm font-semibold', scoreColor(lastResult.score))}>
                {lastResult.score}
              </div>
            </div>
            {lastResult.feedback && (
              <p className="text-sm whitespace-pre-wrap">{lastResult.feedback}</p>
            )}
            {items[idx].eliteAnswer && (
              <div className="rounded-md border border-green-500/30 bg-green-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-green-600 font-semibold mb-1">
                  {items[idx].eliteLabel}
                </div>
                <p className="text-sm whitespace-pre-wrap">{items[idx].eliteAnswer}</p>
              </div>
            )}
            <div className="flex justify-end">
              <Button onClick={advance} disabled={finalizing}>
                {finalizing
                  ? 'Finalizing…'
                  : idx + 1 >= items.length
                    ? 'See results'
                    : <>Next item <ArrowRight className="h-4 w-4" /></>}
              </Button>
            </div>
          </Card>
        )}

        {phase === 'summary' && finalSummary && (
          <Card className="p-4">
            <div className="space-y-3">
              {records.map((r, i) => (
                <div key={i} className="rounded-md border border-border p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                      Item {i + 1} · <span className="font-mono normal-case">{r.sourceTitle}</span>
                    </div>
                    <div className={cn('rounded border px-2 py-0.5 text-xs font-semibold', scoreColor(r.score))}>
                      {r.score}
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">{truncate(r.objection, 80)}</p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">You: </span>
                    {truncate(r.userResponse, 120)}
                  </p>
                  {r.eliteAnswer && (
                    <div className="rounded border border-green-500/30 bg-green-500/5 p-2">
                      <div className="text-[10px] uppercase tracking-wider text-green-600 font-semibold mb-0.5">
                        {r.eliteLabel}
                      </div>
                      <p className="text-xs whitespace-pre-wrap">{r.eliteAnswer}</p>
                    </div>
                  )}
                  {r.feedback && (
                    <p className="text-xs text-muted-foreground whitespace-pre-wrap">{r.feedback}</p>
                  )}
                </div>
              ))}
            </div>


            <div className="mt-4 pt-4 border-t border-border">
              <div className="flex items-center gap-3 mb-3">
                {finalSummary.passed ? (
                  <Trophy className="h-8 w-8 text-green-500" />
                ) : (
                  <AlertTriangle className="h-8 w-8 text-amber-500" />
                )}
                <div>
                  <div className="text-2xl font-bold">
                    {finalSummary.avgScore} <span className="text-sm text-muted-foreground">/ {threshold}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {finalSummary.passed ? 'Passed' : `Score ≥ ${threshold} to advance`}
                  </div>
                </div>
              </div>

              {finalSummary.passed && (
                <div className="rounded-md border border-green-500/40 bg-green-500/5 p-3 mb-3 text-sm">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    {data?.gate?.promotes_to
                      ? `You're now ${BAND_NAMES[data.gate.promotes_to]}`
                      : 'Top band cleared — fully certified'}
                  </div>
                  {finalSummary.nextRetestDue && (
                    <div className="text-xs text-muted-foreground">
                      Retest due {new Date(finalSummary.nextRetestDue).toLocaleDateString()}
                    </div>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => navigate(backPath)}>
                  {fromGatesHub ? 'Back to Gates' : 'Back to ladder'}
                </Button>
                {!finalSummary.passed && <Button onClick={retake}>Retake</Button>}
              </div>
            </div>
          </Card>
        )}
      </main>
    </Layout>
  );
}
