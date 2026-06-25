import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import { useConceptAtom } from '@/hooks/train/useConceptAtom';
import { runPracticeRep, writeTrainSession } from '@/lib/train/engine';
import { TRAIN_TUNABLES, type CurriculumKi } from '@/types/train';
import { Sparkles, BookOpen, RotateCcw, CheckCircle2, ArrowLeft } from 'lucide-react';

type Phase = 'teach' | 'try' | 'scored';

export default function TrainAtom() {
  const { spoke = 'product', topic = 'deep_linking', conceptId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, error } = useConceptAtom(conceptId);

  const [phase, setPhase] = useState<Phase>('teach');
  const [drillIdx, setDrillIdx] = useState(0);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ score: number; feedback: string; progress: number; reps: number } | null>(null);
  const [sessionBest, setSessionBest] = useState(0);
  const [sessionLatest, setSessionLatest] = useState(0);
  const [startedAt] = useState(() => new Date().toISOString());

  const drills: CurriculumKi[] = data?.drills ?? [];
  const provisional: CurriculumKi | undefined =
    data?.teach.kind === 'pending' ? data.teach.provisional : undefined;
  // Pending: use provisional drill as the first rep.
  const activeDrills = useMemo<CurriculumKi[]>(() => {
    if (data?.teach.kind === 'pending' && provisional) {
      const rest = drills.filter((d) => d.ki_id !== provisional.ki_id);
      return [provisional, ...rest];
    }
    return drills;
  }, [data, drills, provisional]);
  const currentDrill = activeDrills[drillIdx];

  async function handleSubmit() {
    if (!user || !currentDrill || !data) return;
    setSubmitting(true);
    try {
      const r = await runPracticeRep({
        userId: user.id,
        spoke,
        topic,
        band: data.concept.band,
        subLevel: data.concept.sub_level,
        drillCountInSubLevel: activeDrills.length,
        ki: currentDrill,
        userResponse: response,
        skillFocus: topic,
      });
      setResult({ score: r.score, feedback: r.feedback, progress: r.progress, reps: r.reps });
      setSessionLatest(r.score);
      setSessionBest((b) => Math.max(b, r.score));
      setPhase('scored');
    } catch (e) {
      setResult({ score: 0, feedback: `Scoring failed: ${(e as Error).message}`, progress: 0, reps: 0 });
      setPhase('scored');
    } finally {
      setSubmitting(false);
    }
  }

  function handleRefine() {
    setPhase('try');
    setResult(null);
    // keep response so they can sharpen it
  }

  async function handleAdvance() {
    const next = drillIdx + 1;
    if (next >= activeDrills.length) {
      // Atom complete — write session.
      if (user) {
        try {
          await writeTrainSession({
            userId: user.id,
            mode: 'train_atom',
            skillFocus: topic,
            subLevel: data?.concept.sub_level,
            band: data?.concept.band,
            conceptId: data?.concept.concept_id,
            bestScore: sessionBest,
            latestScore: sessionLatest,
            startedAt,
            completedAt: new Date().toISOString(),
          });
        } catch { /* ignore */ }
      }
      navigate(`/train/${spoke}/${topic}`);
      return;
    }
    setDrillIdx(next);
    setResponse('');
    setResult(null);
    setPhase('try');
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
          {data && (
            <>
              <h1 className="text-xl font-bold mt-2">
                <span className="font-mono text-xs text-muted-foreground mr-2">{data.concept.concept_id}</span>
                {data.concept.title}
              </h1>
              <p className="text-xs text-muted-foreground">
                Band {data.concept.band} · Sub-level {data.concept.sub_level} ·
                Drill {Math.min(drillIdx + 1, activeDrills.length)} / {activeDrills.length}
              </p>
            </>
          )}
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {data && phase === 'teach' && (
          <TeachOpener data={data} onContinue={() => setPhase('try')} hasDrills={activeDrills.length > 0} />
        )}

        {/* Genuinely drill-less (no drills, no exemplar, no drill_prompt) →
            teach + "Got it" finish, never a dead-end Try-it. */}
        {data && phase === 'teach' && activeDrills.length === 0 && (
          <Card className="mt-3 p-4">
            <p className="text-sm text-muted-foreground mb-3">
              No practice drill for this concept yet — mark it learned and continue.
            </p>
            <div className="flex justify-end">
              <Button onClick={() => navigate(`/train/${spoke}/${topic}`)}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Got it
              </Button>
            </div>
          </Card>
        )}

        {data && phase === 'try' && currentDrill && (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Try it
            </div>
            <div className="text-sm font-medium mb-1">Buyer situation</div>
            <p className="text-sm bg-muted/40 rounded p-3 mb-3">
              {currentDrill.scenario || currentDrill.when_to_use || 'Respond to this buyer situation.'}
            </p>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Your response…"
              rows={6}
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={() => setPhase('teach')}>Back to teach</Button>
              <Button onClick={handleSubmit} disabled={submitting || response.trim().length < 5}>
                {submitting ? 'Scoring…' : 'Submit'}
              </Button>
            </div>
          </Card>
        )}

        {data && phase === 'scored' && result && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-3xl font-bold">{result.score}</div>
              <div className="text-xs text-muted-foreground text-right">
                Sub-level progress: {Math.round(result.progress * 100)}% · {result.reps} reps
              </div>
            </div>
            <div className="text-sm whitespace-pre-wrap mb-4">{result.feedback || '—'}</div>
            {(() => {
              const passed = result.score >= TRAIN_TUNABLES.subLevelPassThreshold;
              const advanceLabel = drillIdx + 1 >= activeDrills.length ? 'Owned · finish' : 'Got it · next drill';
              return (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant={passed ? 'ghost' : 'default'}
                    size={passed ? 'sm' : 'default'}
                    onClick={() => setPhase('teach')}
                  >
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to teach
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" onClick={handleRefine}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> Refine
                    </Button>
                    <Button
                      variant={passed ? 'default' : 'ghost'}
                      size={passed ? 'default' : 'sm'}
                      onClick={handleAdvance}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                      {advanceLabel}
                    </Button>
                  </div>
                </div>
              );
            })()}
          </Card>
        )}
      </main>
    </Layout>
  );
}

function TeachOpener({
  data,
  onContinue,
  hasDrills,
}: {
  data: NonNullable<ReturnType<typeof useConceptAtom>['data']>;
  onContinue: () => void;
  hasDrills: boolean;
}) {
  const t = data.teach;
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" /> Teach
      </div>

      {t.kind === 'ki_exemplar' && (
        <div className="space-y-3 text-sm">
          <h3 className="text-base font-semibold">{t.exemplar.title}</h3>
          {(t.modelLine ?? t.exemplar.example_usage ?? t.exemplar.tactic_summary) && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
              <div className="text-[11px] uppercase tracking-wider text-primary mb-2">How an elite AE explains this</div>
              <p className="leading-relaxed">{t.modelLine ?? t.exemplar.example_usage ?? t.exemplar.tactic_summary}</p>
            </div>
          )}
        </div>
      )}

      {t.kind === 'authored_md' && (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{t.markdown}</ReactMarkdown>
        </div>
      )}

      {t.kind === 'authored' && (
        <div className="text-sm text-muted-foreground">
          Authored teach beat: <code>{t.ref}</code>
        </div>
      )}

      {t.kind === 'pending' && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          Teach beat coming soon — we'll start you on a provisional drill.
        </div>
      )}

      {hasDrills && (
        <div className="flex justify-end mt-4">
          <Button onClick={onContinue}>Try it →</Button>
        </div>
      )}
    </Card>
  );
}
