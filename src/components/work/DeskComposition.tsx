/**
 * Desk composition — /work?tab=desk
 *
 * §2.1 contract: Quota strip · Needs My Move · Today's Tasks · Renewal Radar.
 * All data derived from real tables (quota_targets, opportunities, tasks,
 * renewals). Honest zero states. No AI calls.
 */
import { useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO } from 'date-fns';
import {
  Target,
  AlertCircle,
  CheckCircle2,
  Circle,
  Calendar,
  ChevronRight,
  ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { SwipeCompleteRow } from '@/components/gestures/SwipeCompleteRow';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { todayET } from '@/lib/timeFormat';
import { useDbOpportunities, useDbRenewals } from '@/hooks/useAccountsData';

const AMBER = 'hsl(var(--brand-work))';

function fmt$(n: number): string {
  if (!n) return '$0';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

// ─────────────────────────────────────────────────────────────────
// D1. Quota strip
// ─────────────────────────────────────────────────────────────────
function useQuotaStrip() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['desk-quota-strip', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from('quota_targets')
        .select('new_arr_quota, renewal_arr_quota, fiscal_year_start, fiscal_year_end')
        .eq('user_id', user!.id)
        .maybeSingle();
      return data;
    },
  });
}

function QuotaStrip() {
  const nav = useNavigate();
  const { data: quota, isLoading } = useQuotaStrip();
  const { data: opps = [] } = useDbOpportunities();

  const stats = useMemo(() => {
    if (!quota) return null;
    const fyStart = quota.fiscal_year_start;
    const fyEnd = quota.fiscal_year_end;
    const totalQuota = Number(quota.new_arr_quota || 0) + Number(quota.renewal_arr_quota || 0);

    let attained = 0;
    let openPipeline = 0;
    for (const o of opps) {
      const arr = Number(o.arr || 0);
      const isClosedWon =
        o.status === 'closed-won' ||
        (typeof o.stage === 'string' && o.stage.includes('Closed Won'));
      const isClosedLost =
        o.status === 'closed-lost' ||
        (typeof o.stage === 'string' && o.stage.includes('Closed Lost'));
      if (isClosedWon) {
        if (o.close_date && o.close_date >= fyStart && o.close_date <= fyEnd) {
          attained += arr;
        }
      } else if (!isClosedLost && o.status !== 'stalled') {
        openPipeline += arr;
      }
    }
    const remaining = Math.max(0, totalQuota - attained);
    const attainment = totalQuota > 0 ? attained / totalQuota : 0;
    const coverage = remaining > 0 ? openPipeline / remaining : null;
    return { totalQuota, attained, remaining, attainment, coverage, openPipeline };
  }, [quota, opps]);

  if (isLoading) {
    return <div className="h-24 rounded-lg bg-muted/30 animate-pulse" />;
  }

  if (!quota) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Quota not set</div>
            <div className="text-xs text-muted-foreground">Set your number in Territory setup.</div>
          </div>
          <Button size="sm" variant="outline" onClick={() => nav('/settings/territory')}>
            Territory setup <ArrowRight className="ml-1 h-3 w-3" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!stats) return null;
  const pct = Math.round(stats.attainment * 100);

  return (
    <button
      onClick={() => nav('/quota')}
      className="w-full text-left rounded-lg border bg-card p-4 hover:border-border transition-colors"
      style={{ borderColor: `${AMBER}33` }}
    >
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="flex items-baseline gap-2">
          <Target className="h-4 w-4 self-center" style={{ color: AMBER }} />
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Attainment</span>
        </div>
        <div className="flex items-baseline gap-1">
          <span className="font-display text-4xl font-bold tabular-nums" style={{ color: AMBER }}>
            {pct}
          </span>
          <span className="text-lg text-muted-foreground">%</span>
        </div>
      </div>
      <Progress value={Math.min(100, pct)} className="h-1.5 mb-2" />
      <div className="flex items-baseline justify-between text-xs">
        <span className="tabular-nums">
          <span className="font-semibold">{fmt$(stats.attained)}</span>
          <span className="text-muted-foreground"> / {fmt$(stats.totalQuota)}</span>
        </span>
        {stats.coverage !== null && stats.remaining > 0 && (
          <span className="text-muted-foreground tabular-nums">
            {stats.coverage.toFixed(1)}× coverage · {fmt$(stats.openPipeline)} open
          </span>
        )}
        {stats.remaining === 0 && stats.totalQuota > 0 && (
          <span className="text-status-green font-medium">Number hit</span>
        )}
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────
// D2. Needs My Move — derived triage
// ─────────────────────────────────────────────────────────────────
type MoveItem = {
  key: string;
  entityType: 'opportunity' | 'renewal';
  entityId: string;
  accountLabel: string;
  why: string;
  arrAtRisk: number;
  href: string;
};

function useNeedsMove(): MoveItem[] {
  const { data: opps = [] } = useDbOpportunities();
  const { data: renewals = [] } = useDbRenewals();

  return useMemo(() => {
    const now = new Date();
    const today = todayET();
    const items: MoveItem[] = [];

    for (const o of opps) {
      const isClosed =
        o.status === 'closed-won' ||
        o.status === 'closed-lost' ||
        (typeof o.stage === 'string' && (o.stage.includes('Closed Won') || o.stage.includes('Closed Lost')));
      if (isClosed) continue;
      const arr = Number(o.arr || 0);
      const acct = o.name || 'Opportunity';

      const nextStepMissing = !o.next_step || o.next_step.trim().length < 3;
      const nextStepPast = o.next_step_date && o.next_step_date < today;
      if (nextStepMissing || nextStepPast) {
        items.push({
          key: `opp-ns-${o.id}`,
          entityType: 'opportunity',
          entityId: o.id,
          accountLabel: acct,
          why: nextStepMissing
            ? `no next step on a ${fmt$(arr)} opp`
            : `next step overdue (${o.next_step_date})`,
          arrAtRisk: arr,
          href: `/opportunity/${o.id}`,
        });
        continue;
      }

      // Quiet opp: not touched > 10d
      const touch = o.last_touch_date || o.updated_at;
      if (touch) {
        try {
          const days = differenceInDays(now, parseISO(touch));
          if (days > 10) {
            items.push({
              key: `opp-quiet-${o.id}`,
              entityType: 'opportunity',
              entityId: o.id,
              accountLabel: acct,
              why: `quiet ${days}d`,
              arrAtRisk: arr,
              href: `/opportunity/${o.id}`,
            });
          }
        } catch { /* skip */ }
      }
    }

    for (const r of renewals) {
      try {
        const days = differenceInDays(parseISO(r.renewal_due), now);
        if (days > 60 || days < -30) continue;
        const noStep = !r.next_step || r.next_step.trim().length < 3;
        if (!noStep) continue;
        items.push({
          key: `ren-${r.id}`,
          entityType: 'renewal',
          entityId: r.id,
          accountLabel: r.account_name,
          why: days >= 0 ? `renews in ${days}d, nothing booked` : `renewed ${Math.abs(days)}d ago, no step`,
          arrAtRisk: Number(r.arr || 0),
          href: r.account_id ? `/account/${r.account_id}` : '/renewals',
        });
      } catch { /* skip */ }
    }

    return items.sort((a, b) => b.arrAtRisk - a.arrAtRisk);
  }, [opps, renewals]);
}

function NeedsMyMove() {
  const nav = useNavigate();
  const items = useNeedsMove();
  const top = items.slice(0, 3);
  const more = items.length - top.length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertCircle className="h-4 w-4" style={{ color: AMBER }} />
          Needs my move
          {items.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-auto">{items.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {top.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            Queue's clear — nothing needs a move right now.
          </p>
        )}
        {top.map((it, i) => (
          <button
            key={it.key}
            onClick={() => nav(it.href)}
            className={cn(
              'w-full text-left p-3 rounded-lg border transition-colors group',
              i === 0
                ? 'border-2 bg-card hover:bg-muted/30'
                : 'border-border/40 hover:border-border/70 hover:bg-muted/20',
            )}
            style={i === 0 ? { borderColor: `${AMBER}66` } : undefined}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className={cn('font-medium truncate', i === 0 ? 'text-base' : 'text-sm')}>
                {it.accountLabel}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
                  {fmt$(it.arrAtRisk)}
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              ← {it.why}
            </div>
          </button>
        ))}
        {more > 0 && (
          <button
            onClick={() => nav('/work?tab=pipeline')}
            className="w-full text-xs text-muted-foreground hover:text-foreground py-1"
          >
            {more} more →
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// D3. Today's Tasks
// ─────────────────────────────────────────────────────────────────
function useDeskTasks() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['desk-tasks', user?.id, todayET()],
    enabled: !!user?.id,
    queryFn: async () => {
      const today = todayET();
      const { data } = await supabase
        .from('tasks')
        .select('id, title, priority, due_date, status')
        .eq('user_id', user!.id)
        .neq('status', 'done')
        .neq('status', 'dropped')
        .lte('due_date', today)
        .order('due_date', { ascending: true })
        .order('priority', { ascending: true })
        .limit(8);
      return data ?? [];
    },
  });
}

function TodaysTasks() {
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: tasks = [], isLoading } = useDeskTasks();

  const complete = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      const key = ['desk-tasks', user?.id, todayET()];
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData(key);
      qc.setQueryData(key, (old: any) => (old || []).filter((t: any) => t.id !== id));
      return { prev, key };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(ctx.key, ctx.prev);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['desk-tasks'] });
      qc.invalidateQueries({ queryKey: ['today-tasks'] });
    },
  });

  const today = todayET();

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" style={{ color: AMBER }} />
          Today's tasks
          {tasks.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-auto">{tasks.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        {isLoading && <div className="text-xs text-muted-foreground py-2">Loading…</div>}
        {!isLoading && tasks.length === 0 && (
          <p className="text-xs text-muted-foreground py-2">
            Nothing due today. Add one from <button onClick={() => nav('/tasks')} className="underline">Tasks</button>.
          </p>
        )}
        {tasks.map((t: any) => {
          const overdue = t.due_date && t.due_date < today;
          return (
            <SwipeCompleteRow key={t.id} onComplete={() => complete.mutate(t.id)}>
              <div
                className="flex items-center gap-2 py-2 px-1 min-h-[44px] rounded hover:bg-muted/30 transition-colors"
              >
                <button
                  onClick={() => complete.mutate(t.id)}
                  className="shrink-0 p-1 -m-1"
                  aria-label={`Complete ${t.title}`}
                >
                  <Circle className="h-4 w-4 text-muted-foreground hover:text-status-green transition-colors" />
                </button>
                <button
                  onClick={() => nav('/tasks')}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="text-sm truncate">{t.title}</div>
                </button>
                {overdue && (
                  <span className="text-[10px] text-status-red font-medium shrink-0">Overdue</span>
                )}
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">{t.priority}</span>
              </div>
            </SwipeCompleteRow>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// D4. Renewal Radar
// ─────────────────────────────────────────────────────────────────
function RenewalRadar() {
  const nav = useNavigate();
  const { data: renewals = [], isLoading } = useDbRenewals();

  const soonest = useMemo(() => {
    const now = new Date();
    const eligible = renewals
      .filter((r) => !r.next_step || r.next_step.trim().length < 3)
      .map((r) => {
        try {
          const days = differenceInDays(parseISO(r.renewal_due), now);
          return { r, days };
        } catch {
          return null;
        }
      })
      .filter((x): x is { r: typeof renewals[number]; days: number } => !!x && x.days >= -30)
      .sort((a, b) => a.days - b.days);
    return eligible[0] ?? null;
  }, [renewals]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Calendar className="h-4 w-4" style={{ color: AMBER }} />
          Renewal radar
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {!isLoading && !soonest && (
          <p className="text-xs text-muted-foreground">
            No renewals need a next step. Nice.
          </p>
        )}
        {soonest && (
          <button
            onClick={() =>
              nav(soonest.r.account_id ? `/account/${soonest.r.account_id}` : '/renewals')
            }
            className="w-full text-left group"
          >
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <span className="text-sm font-medium truncate">{soonest.r.account_name}</span>
              {soonest.r.arr > 0 && (
                <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
                  {fmt$(Number(soonest.r.arr))}
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <span>
                {soonest.days >= 0
                  ? `Renews in ${soonest.days}d · no next step`
                  : `Renewed ${Math.abs(soonest.days)}d ago · no next step`}
              </span>
              <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </button>
        )}
      </CardContent>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────
// Composition
// ─────────────────────────────────────────────────────────────────
export function DeskComposition() {
  return (
    <div className="p-4 max-w-2xl mx-auto space-y-4">
      <QuotaStrip />
      <NeedsMyMove />
      <TodaysTasks />
      <RenewalRadar />
    </div>
  );
}
