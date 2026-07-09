import { useMemo, useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/AuthContext';
import { useConceptAtom } from '@/hooks/train/useConceptAtom';
import { runPracticeRep, writeTrainSession } from '@/lib/train/engine';
import { TRAIN_TUNABLES, type CurriculumKi } from '@/types/train';
import { RubricChecklist, type RubricEvaluation } from '@/components/train/RubricChecklist';
import { LessonPanel } from '@/components/train/LessonPanel';
import { Sparkles, BookOpen, RotateCcw, CheckCircle2, ArrowLeft, AlertTriangle, GraduationCap, Target, Eye } from 'lucide-react';

type Beat = 'concept' | 'elite' | 'situation' | 'respond' | 'feedback';
export type DrillMode = 'practice' | 'gate';



function isNonEmpty(s: string | null | undefined): s is string {
  return !!s && s.trim().length > 0;
}

export default function TrainAtom() {
  const { spoke = 'product', topic = 'deep_linking', conceptId = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data, isLoading, error } = useConceptAtom(conceptId);

  const [beat, setBeat] = useState<Beat>('concept');
  const [drillIdx, setDrillIdx] = useState(0);
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    score: number;
    feedback: string;
    progress: number;
    reps: number;
    goldCriteria: RubricEvaluation[];
  } | null>(null);
  // Per-drill localStorage stats — recomputed when drill changes or after a rep.
  const [drillStats, setDrillStats] = useState<{ attempts: number; passes: number }>({ attempts: 0, passes: 0 });
  const [sessionBest, setSessionBest] = useState(0);
  const [sessionLatest, setSessionLatest] = useState(0);
  const [startedAt] = useState(() => new Date().toISOString());

  const drills: CurriculumKi[] = data?.drills ?? [];
  const provisional: CurriculumKi | undefined =
    data?.teach.kind === 'pending' ? data.teach.provisional : undefined;
  const activeDrills = useMemo<CurriculumKi[]>(() => {
    if (data?.teach.kind === 'pending' && provisional) {
      const rest = drills.filter((d) => d.ki_id !== provisional.ki_id);
      return [provisional, ...rest];
    }
    return drills;
  }, [data, drills, provisional]);
  const currentDrill = activeDrills[drillIdx];

  const teach = data?.teach;
  const exemplar = teach?.kind === 'ki_exemplar' ? teach.exemplar : undefined;
  const modelLine =
    teach?.kind === 'ki_exemplar'
      ? (teach.modelLine ?? exemplar?.example_usage ?? exemplar?.tactic_summary ?? null)
      : null;

  // Which teach beats actually have content?
  const hasConceptBeat =
    teach?.kind === 'authored_md' ||
    teach?.kind === 'pending' ||
    teach?.kind === 'authored' ||
    (teach?.kind === 'ki_exemplar' &&
      (isNonEmpty(exemplar?.why_it_matters) || isNonEmpty(exemplar?.when_to_use) || isNonEmpty(exemplar?.title)));
  const hasEliteBeat = isNonEmpty(modelLine) || isNonEmpty(exemplar?.when_not_to_use);

  // TrainAtom is always PRACTICE. GATE mode is owned by TrainBandGate.
  const drillMode: DrillMode = 'practice';

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
      setResult({
        score: r.score,
        feedback: r.feedback,
        progress: r.progress,
        reps: r.reps,
        goldCriteria: r.goldCriteria ?? [],
      });
      setSessionLatest(r.score);
      setSessionBest((b) => Math.max(b, r.score));
      setBeat('feedback');
    } catch (e) {
      setResult({
        score: 0,
        feedback: `Scoring failed: ${(e as Error).message}`,
        progress: 0,
        reps: 0,
        goldCriteria: [],
      });
      setBeat('feedback');
    } finally {
      setSubmitting(false);
    }
  }

  function handleRefine() {
    setResult(null);
    setBeat('respond');
  }

  function startDrilling() {
    setBeat('situation');
  }

  function backToTeach() {
    setResult(null);
    setBeat(hasConceptBeat ? 'concept' : 'elite');
  }

  async function handleAdvance() {
    const next = drillIdx + 1;
    if (next >= activeDrills.length) {
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
    setBeat('situation');
  }

  // Step dots for teach
  const teachSteps: Beat[] = [];
  if (hasConceptBeat) teachSteps.push('concept');
  if (hasEliteBeat) teachSteps.push('elite');
  const isTeachBeat = beat === 'concept' || beat === 'elite';

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
                Drill {Math.min(drillIdx + 1, Math.max(activeDrills.length, 1))} / {activeDrills.length}
              </p>
            </>
          )}
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {error && <p className="text-sm text-destructive">{(error as Error).message}</p>}

        {/* Teach step dots */}
        {data && isTeachBeat && teachSteps.length > 1 && (
          <div className="flex items-center gap-1.5 mb-3">
            {teachSteps.map((s) => (
              <span
                key={s}
                className={cn(
                  'h-1.5 rounded-full transition-all',
                  s === beat ? 'w-6 bg-primary' : 'w-1.5 bg-muted',
                )}
              />
            ))}
          </div>
        )}

        {/* BEAT 1 — CONCEPT */}
        {data && beat === 'concept' && (
          <ConceptBeat
            data={data}
            authoredScript={activeDrills.find((d) => isNonEmpty(d.drillTeachScript))?.drillTeachScript ?? null}
            onContinue={() => {
              if (hasEliteBeat) setBeat('elite');
              else if (activeDrills.length > 0) startDrilling();
              else navigate(`/train/${spoke}/${topic}`);
            }}
            hasDrills={activeDrills.length > 0}
            hasEliteBeat={!!hasEliteBeat}
            spoke={spoke}
            topic={topic}
          />
        )}

        {/* BEAT 2 — ELITE EXEMPLAR */}
        {data && beat === 'elite' && (
          <EliteBeat
            modelLine={modelLine}
            whenNotToUse={exemplar?.when_not_to_use ?? null}
            onBack={hasConceptBeat ? () => setBeat('concept') : undefined}
            onContinue={activeDrills.length > 0 ? startDrilling : undefined}
            onFinish={activeDrills.length === 0 ? () => navigate(`/train/${spoke}/${topic}`) : undefined}
          />
        )}

        {/* BEAT 3 — SITUATION + TEACH-BEFORE-TEST */}
        {data && beat === 'situation' && currentDrill && (
          <SituationBeat
            drill={currentDrill}
            drillMode={drillMode}
            drillIdx={drillIdx}
            lessonMd={data.concept.lesson_md ?? null}
            conceptId={data.concept.concept_id}
            userId={user?.id ?? null}
            drillStats={drillStats}
            onBackToTeach={backToTeach}
            onRespond={() => setBeat('respond')}
          />
        )}

        {/* BEAT 4 — RESPOND */}
        {data && beat === 'respond' && currentDrill && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-1">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">The situation</div>
              <DrillModeBadge mode={drillMode} attempts={drillStats.attempts} />
            </div>
            <p className="text-xs text-muted-foreground bg-muted/30 rounded p-2 mb-3 line-clamp-3">
              {currentDrill.scenario || currentDrill.when_to_use || 'Respond to this buyer situation.'}
            </p>

            {/* LEARN mode keeps rubric visible while user drafts.
                PRACTICE mode hides behind a "Show the bar" peek. */}
            {Array.isArray(currentDrill.drillRubric) && currentDrill.drillRubric.length > 0 && (
              drillMode === 'learn' ? (
                <div className="mb-3">
                  <RubricChecklist rubric={currentDrill.drillRubric} compact />
                </div>
              ) : (
                <PeekPanel label="Show the bar" icon={Target}>
                  <RubricChecklist rubric={currentDrill.drillRubric} compact />
                </PeekPanel>
              )
            )}

            <div className="flex items-center gap-2 mb-2 text-xs uppercase tracking-wider text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" /> Your response
            </div>
            <Textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              placeholder="Your response…"
              rows={6}
            />
            <div className="flex justify-between gap-2 mt-3">
              <Button variant="ghost" size="sm" onClick={backToTeach}>
                <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to teach
              </Button>
              <Button onClick={handleSubmit} disabled={submitting || response.trim().length < 5}>
                {submitting ? 'Scoring…' : 'Submit'}
              </Button>
            </div>
          </Card>
        )}

        {/* BEAT 5 — FEEDBACK */}
        {data && beat === 'feedback' && result && (
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="text-3xl font-bold">{result.score}</div>
              <div className="text-xs text-muted-foreground text-right">
                Sub-level progress: {Math.round(result.progress * 100)}% · {result.reps} reps
              </div>
            </div>

            {/* Per-criterion pass/fail from the grader — shown BEFORE the prose
                so the rep sees exactly which bar they met or missed. */}
            {currentDrill && Array.isArray(currentDrill.drillRubric) && currentDrill.drillRubric.length > 0 && (
              <div className="mb-4">
                <RubricChecklist
                  rubric={currentDrill.drillRubric}
                  results={result.goldCriteria}
                />
              </div>
            )}

            <div className="text-sm whitespace-pre-wrap mb-4">{result.feedback || '—'}</div>

            {/* Model answer reveal — always after grading in LEARN & PRACTICE. */}
            {currentDrill && isNonEmpty(currentDrill.drillModelAnswer) && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 mb-4">
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary mb-2">
                  <GraduationCap className="h-3.5 w-3.5" /> How elite sounds
                </div>
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{currentDrill.drillModelAnswer}</p>
              </div>
            )}

            {/* Concept-level model line — still shown when no per-drill model answer. */}
            {(!currentDrill || !isNonEmpty(currentDrill.drillModelAnswer)) && isNonEmpty(modelLine) && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-4 mb-4">
                <div className="text-[11px] uppercase tracking-wider text-primary mb-2">
                  How an elite AE handled it
                </div>
                <p className="text-sm leading-relaxed">{modelLine}</p>
              </div>
            )}


            {(() => {
              const passed = result.score >= TRAIN_TUNABLES.subLevelPassThreshold;
              const advanceLabel = drillIdx + 1 >= activeDrills.length ? 'Owned · finish' : 'Got it · next drill';
              return (
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant={passed ? 'ghost' : 'default'}
                    size={passed ? 'sm' : 'default'}
                    onClick={backToTeach}
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

// ── Beat 1: CONCEPT ──────────────────────────────────────────────
function ConceptBeat({
  data,
  authoredScript,
  onContinue,
  hasDrills,
  hasEliteBeat,
  spoke,
  topic,
}: {
  data: NonNullable<ReturnType<typeof useConceptAtom>['data']>;
  authoredScript: string | null;
  onContinue: () => void;
  hasDrills: boolean;
  hasEliteBeat: boolean;
  spoke: string;
  topic: string;
}) {
  const t = data.teach;
  const navigate = useNavigate();
  const continueLabel = hasEliteBeat ? 'Continue →' : hasDrills ? 'Start drilling →' : 'Got it';
  const hasAuthored = isNonEmpty(authoredScript);

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
        <BookOpen className="h-3.5 w-3.5" /> Concept
      </div>

      {t.kind === 'ki_exemplar' && (
        <div className="space-y-4 text-sm">
          <h3 className="text-base font-semibold">{t.exemplar.title}</h3>
          {hasAuthored ? (
            <section>
              <p className="leading-relaxed whitespace-pre-wrap">{authoredScript}</p>
            </section>
          ) : (
            <>
              {isNonEmpty(t.exemplar.why_it_matters) && (
                <section>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">Why this matters</div>
                  <p className="leading-relaxed">{t.exemplar.why_it_matters}</p>
                </section>
              )}
              {isNonEmpty(t.exemplar.when_to_use) && (
                <section>
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">When to use it</div>
                  <p className="leading-relaxed">{t.exemplar.when_to_use}</p>
                </section>
              )}
            </>
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

      <div className="flex justify-end mt-5">
        {hasDrills || hasEliteBeat ? (
          <Button onClick={onContinue}>{continueLabel}</Button>
        ) : (
          <Button onClick={() => navigate(`/train/${spoke}/${topic}`)}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Got it
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Beat 2: ELITE EXEMPLAR ───────────────────────────────────────
function EliteBeat({
  modelLine,
  whenNotToUse,
  onBack,
  onContinue,
  onFinish,
}: {
  modelLine: string | null;
  whenNotToUse: string | null;
  onBack?: () => void;
  onContinue?: () => void;
  onFinish?: () => void;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3 text-xs uppercase tracking-wider text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" /> Elite exemplar
      </div>

      {isNonEmpty(modelLine) && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-4">
          <div className="text-[11px] uppercase tracking-wider text-primary mb-2">How an elite AE says it</div>
          <p className="text-sm leading-relaxed">{modelLine}</p>
        </div>
      )}

      {isNonEmpty(whenNotToUse) && (
        <div className="mt-3 flex gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 text-amber-600 shrink-0" />
          <div>
            <div className="font-medium mb-0.5">When NOT to use</div>
            <p className="leading-relaxed text-muted-foreground">{whenNotToUse}</p>
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 mt-5">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back
          </Button>
        ) : <span />}
        {onContinue && <Button onClick={onContinue}>Start drilling →</Button>}
        {onFinish && (
          <Button onClick={onFinish}>
            <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Got it
          </Button>
        )}
      </div>
    </Card>
  );
}

// ── Beat 3: SITUATION (teach-before-test) ────────────────────────
function SituationBeat({
  drill,
  drillMode,
  drillIdx,
  lessonMd,
  conceptId,
  userId,
  drillStats,
  onBackToTeach,
  onRespond,
}: {
  drill: CurriculumKi;
  drillMode: DrillMode;
  drillIdx: number;
  lessonMd: string | null;
  conceptId: string;
  userId: string | null;
  drillStats: { attempts: number; passes: number };
  onBackToTeach: () => void;
  onRespond: () => void;
}) {
  const hasScript = isNonEmpty(drill.drillTeachScript);
  const hasRubric = Array.isArray(drill.drillRubric) && drill.drillRubric.length > 0;

  return (
    <div>
      {/* Lesson panel — only on the concept's first drill, and only when authored. */}
      {drillIdx === 0 && isNonEmpty(lessonMd) && (
        <LessonPanel conceptId={conceptId} markdown={lessonMd} userId={userId} />
      )}

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5" /> The situation
          </div>
          <DrillModeBadge mode={drillMode} attempts={drillStats.attempts} />
        </div>
        <p className="text-base leading-relaxed bg-muted/40 rounded p-4 mb-4">
          {drill.scenario || drill.when_to_use || 'Respond to this buyer situation.'}
        </p>

        {/* LEARN mode: teach script + rubric fully visible BEFORE recording.
            PRACTICE mode: teach script behind a Refresher toggle; rubric behind "Show the bar". */}
        {hasScript && (
          drillMode === 'learn' ? (
            <div className="mb-3 rounded-md border border-primary/25 bg-primary/5 p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary mb-2">
                <BookOpen className="h-3.5 w-3.5" /> Teach beats
              </div>
              <TeachScriptBeats script={drill.drillTeachScript!} />
            </div>
          ) : (
            <PeekPanel label="Refresher" icon={BookOpen}>
              <TeachScriptBeats script={drill.drillTeachScript!} />
            </PeekPanel>
          )
        )}

        {hasRubric && (
          drillMode === 'learn' ? (
            <div className="mb-3">
              <RubricChecklist rubric={drill.drillRubric!} />
            </div>
          ) : (
            <PeekPanel label="Show the bar" icon={Target}>
              <RubricChecklist rubric={drill.drillRubric!} compact />
            </PeekPanel>
          )
        )}

        <div className="flex items-center justify-between gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onBackToTeach}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Back to teach
          </Button>
          <Button onClick={onRespond}>Respond →</Button>
        </div>
      </Card>
    </div>
  );
}

// Splits a teach script into visible beats. Handles bullet lists, numbered
// lists, and blank-line-separated paragraphs. Falls back to a single block.
function TeachScriptBeats({ script }: { script: string }) {
  const beats = useMemo(() => {
    const trimmed = script.trim();
    // Numbered/bulleted lines
    const listLines = trimmed
      .split('\n')
      .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
      .filter((l) => l.length > 0);
    if (listLines.length >= 2 && trimmed.match(/^\s*(?:[-*•]|\d+[.)])\s+/m)) return listLines;
    // Blank-line paragraphs
    const paras = trimmed.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paras.length >= 2) return paras;
    // Sentence fallback
    const sents = trimmed.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.length > 8);
    if (sents.length >= 2) return sents;
    return [trimmed];
  }, [script]);

  return (
    <ol className="space-y-1.5">
      {beats.map((b, i) => (
        <li key={i} className="flex gap-2 text-sm leading-snug">
          <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full bg-primary/15 text-primary text-[10px] font-semibold flex items-center justify-center tabular-nums">
            {i + 1}
          </span>
          <span>{b}</span>
        </li>
      ))}
    </ol>
  );
}

function DrillModeBadge({ mode, attempts }: { mode: DrillMode; attempts: number }) {
  if (mode === 'learn') {
    return (
      <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
        <GraduationCap className="h-3 w-3 mr-1" /> Learn mode
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-[10px] text-muted-foreground">
      <Target className="h-3 w-3 mr-1" /> Practice · {attempts} prior
    </Badge>
  );
}

function PeekPanel({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: typeof BookOpen;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <Icon className="h-3 w-3" />
        {open ? 'Hide' : label}
        <Eye className="h-3 w-3" />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

