import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Layout } from '@/components/Layout';
import { SHELL } from '@/lib/layout';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useSubLevelLadder } from '@/hooks/train/useSubLevelLadder';
import { BAND_NAMES, type Band, type ConceptRow, type UserBandGateRow } from '@/types/train';
import { Lock, CheckCircle2, Play, AlertTriangle, ChevronRight, Trophy } from 'lucide-react';

function Ring({ progress, label }: { progress: number; label?: string }) {
  const size = 56;
  const stroke = 5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.max(0, Math.min(1, progress)));
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round"
          className="stroke-primary transition-[stroke-dashoffset] duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center text-xs font-semibold">
        {label ?? `${Math.round(progress * 100)}%`}
      </div>
    </div>
  );
}

function isRetestDue(gate: UserBandGateRow | undefined): boolean {
  if (!gate?.next_retest_due) return false;
  return new Date(gate.next_retest_due).getTime() <= Date.now();
}

export default function TrainTopic() {
  const { spoke = 'product', topic = 'deep_linking' } = useParams();
  const navigate = useNavigate();
  const { data, isLoading, error } = useSubLevelLadder(spoke, topic);

  const byBand = useMemo(() => {
    const m = new Map<Band, typeof data extends infer T ? T extends { groups: infer G } ? G : never : never>();
    if (!data) return m;
    for (const g of data.groups) {
      const list = (m.get(g.band) as any) ?? [];
      list.push(g);
      m.set(g.band, list as any);
    }
    return m;
  }, [data]);

  const dueRetests = useMemo(() => {
    if (!data) return [] as Band[];
    return (Object.entries(data.gates) as [string, UserBandGateRow][])
      .filter(([, g]) => isRetestDue(g) && g.status === 'passed')
      .map(([b]) => Number(b) as Band);
  }, [data]);

  return (
    <Layout>
      <main className={cn('mx-auto max-w-2xl px-4 pt-4', SHELL.main.bottomPad)}>
        <header className="mb-4">
          <button onClick={() => navigate('/dojo')} className="text-xs text-muted-foreground hover:text-foreground">
            ← Dojo
          </button>
          <h1 className="text-2xl font-bold mt-2">{topic.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</h1>
          <p className="text-sm text-muted-foreground">Train the curriculum from Foundation to Expert.</p>
        </header>

        {dueRetests.map((b) => (
          <Card key={`retest-${b}`} className="mb-3 p-3 border-amber-500/40 bg-amber-500/5 flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Retest due — {BAND_NAMES[b]}
            </div>
            <Button size="sm" onClick={() => navigate(`/train/${spoke}/${topic}/gate/${b}`)}>Retake</Button>
          </Card>
        ))}

        {isLoading && <p className="text-sm text-muted-foreground">Loading ladder…</p>}
        {error && <p className="text-sm text-destructive">Failed to load: {(error as Error).message}</p>}

        {data && ([1, 2, 3, 4, 5] as Band[]).map((band) => {
          const groups = (byBand.get(band) as any) ?? [];
          if (!groups.length) return null;
          const gate = data.gates[band];
          const prevGate = band > 1 ? data.gates[(band - 1) as Band] : undefined;
          const unlocked = band === 1 || prevGate?.status === 'passed';
          const gateStatus = gate?.status ?? (unlocked ? 'available' : 'locked');

          return (
            <section key={band} className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                  Band {band} · {BAND_NAMES[band]}
                </h2>
                {gate?.best_score != null && (
                  <span className="text-[11px] text-muted-foreground">Best {gate.best_score}</span>
                )}
              </div>

              <div className="space-y-2">
                {groups.map((g: { sub_level: string; concepts: ConceptRow[] }) => {
                  const comp = data.competency[g.sub_level];
                  const progress = Number(comp?.progress ?? 0);
                  const reps = Number(comp?.reps ?? 0);
                  return (
                    <Card key={g.sub_level} className={cn('p-3', !unlocked && 'opacity-50')}>
                      <div className="flex items-center gap-3">
                        <Ring progress={progress} label={`${g.sub_level}`} />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-muted-foreground">{reps} reps</div>
                          <div className="mt-1 space-y-1">
                            {g.concepts.map((c) => (
                              <button
                                key={c.concept_id}
                                disabled={!unlocked}
                                onClick={() => navigate(`/train/${spoke}/${topic}/atom/${c.concept_id}`)}
                                className={cn(
                                  'w-full flex items-center justify-between text-left text-sm',
                                  'px-2 py-1.5 rounded-md hover:bg-accent/50 transition-colors',
                                  !unlocked && 'cursor-not-allowed hover:bg-transparent',
                                )}
                              >
                                <span className="truncate">
                                  <span className="font-mono text-[11px] text-muted-foreground mr-2">{c.concept_id}</span>
                                  {c.title}
                                  {c.teach_beat_status === 'pending' && (
                                    <span className="ml-2 text-[10px] uppercase text-amber-500">pending</span>
                                  )}
                                </span>
                                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}

                {/* Band gate node */}
                <Card
                  className={cn(
                    'p-3 border-2',
                    gateStatus === 'passed' && 'border-green-500/50 bg-green-500/5',
                    gateStatus === 'available' && 'border-primary/40',
                    gateStatus === 'locked' && 'opacity-50',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {gateStatus === 'passed' ? (
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                      ) : gateStatus === 'locked' || !unlocked ? (
                        <Lock className="h-5 w-5 text-muted-foreground" />
                      ) : (
                        <Trophy className="h-5 w-5 text-primary" />
                      )}
                      <div>
                        <div className="text-sm font-semibold">Band {band} Gate</div>
                        <div className="text-[11px] text-muted-foreground">
                          {gateStatus === 'passed' && gate?.best_score != null
                            ? `Passed · best ${gate.best_score}`
                            : !unlocked
                              ? `Pass Band ${band - 1} to unlock`
                              : 'Cold capstone · 5 items'}
                        </div>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant={gateStatus === 'passed' ? 'outline' : 'default'}
                      disabled={!unlocked}
                      onClick={() => navigate(`/train/${spoke}/${topic}/gate/${band}`)}
                    >
                      <Play className="h-3.5 w-3.5 mr-1" />
                      {gateStatus === 'passed' ? 'Retake' : 'Start'}
                    </Button>
                  </div>
                </Card>
              </div>
            </section>
          );
        })}
      </main>
    </Layout>
  );
}
