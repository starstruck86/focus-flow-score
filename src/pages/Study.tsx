/**
 * /study — One Front Door. A MAP, not a recommender.
 *
 * Three levels in one screen flow, driven by URL query params:
 *   ?spoke=…            → topics view
 *   ?spoke=…&topic=…    → mode chooser
 * (no params) → spoke map.
 *
 * Corey picks. Nothing auto-picks.
 */
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { spokeLabel, topicLabel } from '@/lib/train/catalog';
import { useStudyMap, type SpokeStat, type TopicStat } from '@/lib/train/studyMap';
import {
  ArrowLeft, BookMarked, ChevronRight, Car, Zap, Trophy, GraduationCap, Compass,
} from 'lucide-react';

function Pct(n: number, d: number): number {
  if (!d) return 0;
  return Math.round((n / d) * 100);
}

function ProgressLine({ passed, total, label }: { passed: number; total: number; label: string }) {
  const pct = Pct(passed, total);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono">{passed}/{total} · {pct}%</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}

// ── LEVEL 1 ──────────────────────────────────────────────────────────
function MapLevel({ spokes, onPick }: { spokes: SpokeStat[]; onPick: (spoke: string) => void }) {
  const totals = useMemo(() => {
    return spokes.reduce(
      (acc, s) => {
        acc.drill += s.drillReadyConcepts;
        acc.total += s.totalConcepts;
        acc.passed += s.passedConcepts;
        return acc;
      },
      { drill: 0, total: 0, passed: 0 },
    );
  }, [spokes]);

  return (
    <div className="space-y-4">
      <Card className="p-4 bg-primary/5 border-primary/30">
        <div className="flex items-center gap-2 mb-2">
          <Compass className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Your curriculum</span>
        </div>
        <ProgressLine
          passed={totals.passed}
          total={totals.drill}
          label={`Concepts passed (best score ≥ 85)`}
        />
        <p className="text-[11px] text-muted-foreground mt-2">
          {totals.drill} of {totals.total} concepts are drill-ready. Pick a spoke to browse.
        </p>
      </Card>

      <div className="space-y-2">
        {spokes.map((s) => {
          const pct = Pct(s.passedConcepts, s.drillReadyConcepts);
          return (
            <Card
              key={s.spoke}
              className="p-4 hover:bg-accent/40 active:bg-accent/60 transition-colors cursor-pointer border-primary/20"
              onClick={() => onPick(s.spoke)}
            >
              <div className="flex items-center gap-3">
                <div className="relative shrink-0">
                  <div className="h-11 w-11 rounded-full border-2 border-primary/30 flex items-center justify-center text-xs font-bold">
                    {pct}%
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <BookMarked className="h-4 w-4 text-primary shrink-0" />
                    <span className="text-sm font-semibold truncate">{spokeLabel(s.spoke)}</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {s.passedConcepts}/{s.drillReadyConcepts} passed · {s.drillReadyConcepts}/{s.totalConcepts} drill-ready
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── LEVEL 2 ──────────────────────────────────────────────────────────
function TopicsLevel({
  spoke, topics, onBack, onPick,
}: { spoke: SpokeStat; topics: TopicStat[]; onBack: () => void; onPick: (topic: string) => void }) {
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> All spokes
      </button>
      <h2 className="text-xl font-bold">{spokeLabel(spoke.spoke)}</h2>
      <ProgressLine
        passed={spoke.passedConcepts}
        total={spoke.drillReadyConcepts}
        label="Concepts passed"
      />
      <div className="space-y-2 pt-2">
        {topics.map((t) => {
          const pct = Pct(t.passedConcepts, t.drillReadyConcepts);
          return (
            <Card
              key={t.topic}
              className="p-3 hover:bg-accent/40 active:bg-accent/60 transition-colors cursor-pointer"
              onClick={() => onPick(t.topic)}
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 shrink-0 rounded-full border-2 border-primary/30 flex items-center justify-center text-[10px] font-bold">
                  {pct}%
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold">{topicLabel(t.topic)}</span>
                    {t.bands.map((b) => (
                      <span
                        key={b}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground"
                      >
                        B{b}
                      </span>
                    ))}
                    {t.gates.some((g) => g.status) && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
                        gate QA'd
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {t.passedConcepts}/{t.drillReadyConcepts} passed · {t.totalConcepts} concepts
                    {t.hasDeck && <span> · deck ready</span>}
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-2" />
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ── LEVEL 3 ──────────────────────────────────────────────────────────
function ModeLevel({
  topic, onBack,
}: { topic: TopicStat; onBack: () => void }) {
  const navigate = useNavigate();
  const firstConcept = topic.concepts.find((c) => c.drill_ready) ?? topic.concepts[0];
  const qaGates = topic.gates.filter((g) => g.status);
  const firstGate = qaGates[0]?.band ?? topic.gates[0]?.band ?? null;

  const study = () => {
    if (!firstConcept) return;
    navigate(`/train/${topic.spoke}/${topic.topic}/atom/${firstConcept.concept_id}`);
  };
  const carMode = () => {
    navigate(`/car-mode?spoke=${encodeURIComponent(topic.spoke)}&topic=${encodeURIComponent(topic.topic)}`);
  };
  const flash = () => {
    if (topic.deckId) navigate(`/flash/deck/${topic.deckId}`);
    else navigate('/flash');
  };
  const gate = () => {
    if (firstGate != null) navigate(`/train/${topic.spoke}/${topic.topic}/gate/${firstGate}`);
  };

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ArrowLeft className="h-3 w-3" /> {spokeLabel(topic.spoke)}
      </button>
      <div>
        <h2 className="text-xl font-bold">{topicLabel(topic.topic)}</h2>
        <p className="text-[11px] text-muted-foreground mt-1">
          {topic.passedConcepts}/{topic.drillReadyConcepts} passed · {topic.drillReadyConcepts}/{topic.totalConcepts} drill-ready
        </p>
      </div>

      <p className="text-xs uppercase tracking-wider text-muted-foreground pt-2">Pick a mode</p>

      <Card
        className={cn('p-4 cursor-pointer hover:bg-accent/40 border-primary/30', !firstConcept && 'opacity-50 pointer-events-none')}
        onClick={study}
      >
        <div className="flex items-center gap-3">
          <GraduationCap className="h-6 w-6 text-primary shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Study & Drill</div>
            <div className="text-[11px] text-muted-foreground">Read the concept, then drill the exemplar KI.</div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>

      <Card
        className={cn('p-4 cursor-pointer hover:bg-accent/40', topic.drillReadyConcepts === 0 && 'opacity-60')}
        onClick={carMode}
      >
        <div className="flex items-center gap-3">
          <Car className="h-6 w-6 text-primary shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Car Mode</div>
            <div className="text-[11px] text-muted-foreground">
              Hands-free voice drills, scoped to this topic.
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>

      <Card
        className="p-4 cursor-pointer hover:bg-accent/40"
        onClick={flash}
      >
        <div className="flex items-center gap-3">
          <Zap className="h-6 w-6 text-yellow-500 shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-semibold">Flash</div>
            <div className="text-[11px] text-muted-foreground">
              {topic.hasDeck ? 'Open the topic deck (spaced repetition).' : 'No deck yet — Flash home to generate.'}
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </div>
      </Card>

      {firstGate != null && (
        <Card
          className={cn(
            'p-4 cursor-pointer hover:bg-accent/40',
            qaGates.length === 0 && 'opacity-70',
          )}
          onClick={gate}
        >
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-primary shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-semibold">Band {firstGate} Gate</div>
              <div className="text-[11px] text-muted-foreground">
                {qaGates.length > 0 ? `Cold capstone (${qaGates.length} QA'd gate${qaGates.length === 1 ? '' : 's'}).` : 'Cold capstone.'}
              </div>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </div>
        </Card>
      )}
    </div>
  );
}

export default function Study() {
  const [params, setParams] = useSearchParams();
  const spokeParam = params.get('spoke');
  const topicParam = params.get('topic');
  const { data, isLoading, error } = useStudyMap();

  const activeSpoke = useMemo(
    () => (data && spokeParam ? data.spokes.find((s) => s.spoke === spokeParam) ?? null : null),
    [data, spokeParam],
  );
  const activeTopic = useMemo(
    () => (activeSpoke && topicParam ? activeSpoke.topics.find((t) => t.topic === topicParam) ?? null : null),
    [activeSpoke, topicParam],
  );

  const goHome = () => setParams({}, { replace: false });
  const goSpoke = (spoke: string) => setParams({ spoke });
  const goTopic = (topic: string) => setParams({ spoke: activeSpoke!.spoke, topic });

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <h1 className="text-2xl font-bold">Study</h1>
          <p className="text-sm text-muted-foreground">Pick what you want to study — spoke → topic → mode.</p>
        </header>

        {isLoading && <p className="text-sm text-muted-foreground">Loading map…</p>}
        {error && <p className="text-sm text-destructive">Failed to load: {(error as Error).message}</p>}

        {data && !spokeParam && <MapLevel spokes={data.spokes} onPick={goSpoke} />}
        {data && activeSpoke && !topicParam && (
          <TopicsLevel spoke={activeSpoke} topics={activeSpoke.topics} onBack={goHome} onPick={goTopic} />
        )}
        {data && activeSpoke && activeTopic && (
          <ModeLevel topic={activeTopic} onBack={() => setParams({ spoke: activeSpoke.spoke })} />
        )}
        {data && spokeParam && !activeSpoke && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Unknown spoke.</p>
            <Button variant="outline" onClick={goHome}>Back to map</Button>
          </div>
        )}
      </main>
    </Layout>
  );
}
