/**
 * GatesHub — Skills-tab gate surface (Contract §3).
 *
 * Reads real curriculum_gates + user_band_gate. Groups by spoke/topic/band.
 * Launches the existing gate session at the additive route /gates/:spoke/:topic/:band
 * (same TrainBandGate component; no session-internal refactor).
 */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Trophy, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { BAND_NAMES, TRAIN_TUNABLES, type Band } from '@/types/train';
import { CorpusCoverageCard } from '@/components/train/CorpusCoverageCard';

interface GateRow {
  spoke: string;
  topic: string;
  band: Band;
  pass_threshold: number;
  promotes_to: Band | null;
}
interface UserGate {
  spoke: string;
  topic: string;
  band: Band;
  status: string | null;
  best_score: number | null;
  passed_at: string | null;
  next_retest_due: string | null;
}
type Status = 'passed' | 'ready' | 'locked';
interface GateNode extends GateRow {
  status: Status;
  best: number | null;
  passedAt: string | null;
  unlockLabel?: string;
}

function topicLabel(t: string) {
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
function spokeLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

async function loadGates(userId: string) {
  const [gRes, uRes] = await Promise.all([
    (supabase as any).from('curriculum_gates').select('spoke, topic, band, pass_threshold, promotes_to'),
    (supabase as any)
      .from('user_band_gate')
      .select('spoke, topic, band, status, best_score, passed_at, next_retest_due')
      .eq('user_id', userId),
  ]);
  const gates = ((gRes.data ?? []) as GateRow[]).map((r) => ({
    ...r,
    band: Number(r.band) as Band,
    promotes_to: r.promotes_to == null ? null : (Number(r.promotes_to) as Band),
  }));
  const userRows = ((uRes.data ?? []) as UserGate[]).map((r) => ({ ...r, band: Number(r.band) as Band }));
  const userMap = new Map<string, UserGate>();
  for (const u of userRows) userMap.set(`${u.spoke}|${u.topic}|${u.band}`, u);

  // group per (spoke, topic) to compute unlock chain
  const byTopic = new Map<string, GateRow[]>();
  for (const g of gates) {
    const k = `${g.spoke}|${g.topic}`;
    if (!byTopic.has(k)) byTopic.set(k, []);
    byTopic.get(k)!.push(g);
  }

  const nodes: GateNode[] = [];
  for (const [, list] of byTopic) {
    list.sort((a, b) => a.band - b.band);
    for (let i = 0; i < list.length; i++) {
      const g = list[i];
      const u = userMap.get(`${g.spoke}|${g.topic}|${g.band}`);
      const prev = i > 0 ? list[i - 1] : null;
      const prevU = prev ? userMap.get(`${g.spoke}|${g.topic}|${prev.band}`) : null;
      const passed = u?.status === 'passed' || !!u?.passed_at;
      let status: Status;
      let unlockLabel: string | undefined;
      if (passed) status = 'passed';
      else if (!prev || prevU?.status === 'passed' || !!prevU?.passed_at || u?.status === 'available') {
        status = 'ready';
      } else {
        status = 'locked';
        unlockLabel = `Pass Band ${prev.band} ${BAND_NAMES[prev.band as Band]} first`;
      }
      nodes.push({
        ...g,
        status,
        best: u?.best_score ?? null,
        passedAt: u?.passed_at ?? null,
        unlockLabel,
      });
    }
  }
  return nodes;
}

function gatePath(n: GateNode) {
  return `/gates/${n.spoke}/${n.topic}/${n.band}`;
}

export default function GatesHub() {
  const { user } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['gates-hub', user?.id],
    enabled: !!user?.id,
    queryFn: () => loadGates(user!.id),
  });

  const grouped = useMemo(() => {
    const out = new Map<string, GateNode[]>();
    for (const n of data ?? []) {
      const k = `${n.spoke}|${n.topic}`;
      if (!out.has(k)) out.set(k, []);
      out.get(k)!.push(n);
    }
    for (const [, list] of out) list.sort((a, b) => a.band - b.band);
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);

  const hero = useMemo(() => {
    const ready = (data ?? []).filter((n) => n.status === 'ready');
    // prefer lowest band, then first alphabetical
    ready.sort((a, b) => a.band - b.band || a.spoke.localeCompare(b.spoke) || a.topic.localeCompare(b.topic));
    return ready[0] ?? null;
  }, [data]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading gates…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm text-destructive">{(error as Error).message}</div>;
  }
  if (!data || data.length === 0) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-4">
        <Card className="p-4 text-sm text-muted-foreground">
          No gate exams configured yet. Gates unlock as curriculum is authored.
        </Card>
        <CorpusCoverageCard />
      </div>
    );
  }

  const passedCount = data.filter((n) => n.status === 'passed').length;
  const readyCount = data.filter((n) => n.status === 'ready').length;

  return (
    <section className="max-w-2xl mx-auto px-4 pt-4 pb-2 space-y-4">
      <header className="flex items-baseline justify-between">
        <div>
          <h2 className="text-lg font-bold">Gate exams</h2>
          <p className="text-xs text-muted-foreground">
            {passedCount} passed · {readyCount} ready · {data.length} total · pass ≥ {TRAIN_TUNABLES.bandGatePassThreshold}
          </p>
        </div>
      </header>

      {hero && (
        <Card className="p-4 border-[hsl(var(--brand-work))]/40 bg-[hsl(var(--brand-work))]/5">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[hsl(var(--brand-work))] mb-2">
            <Sparkles className="h-3.5 w-3.5" /> Gate ready
          </div>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-base font-semibold">
                {topicLabel(hero.topic)} · Band {hero.band} {BAND_NAMES[hero.band]}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                {spokeLabel(hero.spoke)} · cold capstone · {TRAIN_TUNABLES.bandGateItemCount} items
              </div>
            </div>
            <Button asChild size="sm">
              <Link to={gatePath(hero)}>
                Start <ArrowRight className="h-4 w-4 ml-1" />
              </Link>
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {grouped.map(([key, list]) => {
          const [spoke, topic] = key.split('|');
          return (
            <Card key={key} className="p-3">
              <div className="flex items-baseline justify-between mb-2">
                <div>
                  <div className="text-sm font-semibold">{topicLabel(topic)}</div>
                  <div className="text-[11px] text-muted-foreground">{spokeLabel(spoke)}</div>
                </div>
              </div>
              <div className="divide-y divide-border">
                {list.map((n) => (
                  <div key={n.band} className="flex items-center justify-between py-2 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        {n.status === 'passed' && <Trophy className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                        {n.status === 'locked' && <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                        <span>Band {n.band} {BAND_NAMES[n.band]}</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {n.status === 'passed' && (
                          <>Passed{n.passedAt ? ` · ${new Date(n.passedAt).toLocaleDateString()}` : ''}{n.best != null ? ` · best ${n.best}` : ''}</>
                        )}
                        {n.status === 'ready' && <>Cold capstone · pass ≥ {n.pass_threshold}</>}
                        {n.status === 'locked' && (n.unlockLabel ?? 'Locked')}
                      </div>
                    </div>
                    {n.status === 'locked' ? (
                      <Button size="sm" variant="ghost" disabled className="text-xs">Locked</Button>
                    ) : (
                      <Button asChild size="sm" variant={n.status === 'passed' ? 'outline' : 'default'}>
                        <Link to={gatePath(n)}>
                          {n.status === 'passed' ? 'Retake' : 'Start'}
                        </Link>
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })}
      </div>
      <CorpusCoverageCard />
    </section>
  );
}
