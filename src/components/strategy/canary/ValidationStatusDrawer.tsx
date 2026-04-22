// ════════════════════════════════════════════════════════════════
// ValidationStatusDrawer — Cycle 1 live validation readiness panel.
//
// Read-only drawer mounted from the Strategy header overflow menu.
// All data is fetched directly from Supabase (no new edge function).
//
// Sections:
//   1. Readiness Summary  — duplicates / orphans / lane telemetry /
//                            fallback success / 24h deep-work runs /
//                            recommendation
//   2. Latest Evidence    — last 10 task_runs, last 10 routing_decisions,
//                            recent fallback events
//   3. Validation Gaps    — explicit empty-state callouts so the operator
//                            knows what's missing
//
// Empty states are explicit. Partial data renders safely.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface TaskRunRow {
  id: string;
  task_type: string;
  status: string;
  progress_step: string | null;
  error: string | null;
  created_at: string;
  meta: Record<string, any> | null;
}
interface RoutingRow {
  id: string;
  lane: string;
  created_at: string;
  thread_id: string | null;
  override_used: string | null;
  auto_promoted: boolean | null;
}

interface Snapshot {
  loading: boolean;
  duplicates: number | null;
  orphans: number | null;
  laneCount24h: number | null;
  fallbackSeen: boolean | null;
  deepWorkRuns24h: number | null;
  recentRuns: TaskRunRow[];
  recentRouting: RoutingRow[];
  fallbackEvents: TaskRunRow[];
  errors: string[];
}

const EMPTY: Snapshot = {
  loading: true,
  duplicates: null,
  orphans: null,
  laneCount24h: null,
  fallbackSeen: null,
  deepWorkRuns24h: null,
  recentRuns: [],
  recentRouting: [],
  fallbackEvents: [],
  errors: [],
};

const DEEP_TASK_TYPES = ['discovery_prep', 'account_brief', 'ninety_day_plan'];

function StatusBadge({ kind, label }: { kind: 'pass' | 'warn' | 'fail' | 'info'; label: string }) {
  const Icon =
    kind === 'pass' ? CheckCircle2 :
    kind === 'warn' ? AlertCircle :
    kind === 'fail' ? XCircle : Info;
  const color =
    kind === 'pass' ? 'text-emerald-600' :
    kind === 'warn' ? 'text-amber-600' :
    kind === 'fail' ? 'text-destructive' : 'text-muted-foreground';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

export function ValidationStatusDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { user } = useAuth();
  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  const load = useCallback(async () => {
    if (!user) return;
    setSnap((s) => ({ ...s, loading: true, errors: [] }));
    const errors: string[] = [];

    // Run all queries in parallel — partial failure must not blank the panel.
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stallCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const [runsRes, routingRes, dupRes, orphansRes] = await Promise.all([
      supabase
        .from('task_runs')
        .select('id, task_type, status, progress_step, error, created_at, meta')
        .eq('user_id', user.id)
        .in('task_type', DEEP_TASK_TYPES)
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('routing_decisions')
        .select('id, lane, created_at, thread_id, override_used, auto_promoted')
        .eq('user_id', user.id)
        .gte('created_at', since24h)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('task_runs')
        .select('thread_id, task_type')
        .eq('user_id', user.id)
        .in('status', ['pending', 'running'])
        .not('thread_id', 'is', null),
      supabase
        .from('task_runs')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'pending')
        .eq('progress_step', 'document_authoring')
        .lt('updated_at', stallCutoff),
    ]);

    if (runsRes.error) errors.push(`task_runs: ${runsRes.error.message}`);
    if (routingRes.error) errors.push(`routing_decisions: ${routingRes.error.message}`);
    if (dupRes.error) errors.push(`duplicate-check: ${dupRes.error.message}`);
    if (orphansRes.error) errors.push(`orphan-check: ${orphansRes.error.message}`);

    const runs = (runsRes.data ?? []) as TaskRunRow[];
    const routing = (routingRes.data ?? []) as RoutingRow[];

    // Duplicate active rows per (thread_id, task_type)
    let duplicates = 0;
    const seen = new Map<string, number>();
    for (const r of (dupRes.data ?? []) as Array<{ thread_id: string | null; task_type: string }>) {
      if (!r.thread_id) continue;
      const key = `${r.thread_id}::${r.task_type}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const n of seen.values()) if (n > 1) duplicates += 1;

    const orphans = (orphansRes.data ?? []).length;
    const laneCount24h = routing.length;
    const fallbackEvents = runs.filter((r) => r.meta?.authoring_fallback?.triggered === true);
    const fallbackSeen = fallbackEvents.some((r) => r.meta?.authoring_fallback?.success === true);
    const deepWorkRuns24h = runs.filter((r) => r.created_at >= since24h).length;

    setSnap({
      loading: false,
      duplicates,
      orphans,
      laneCount24h,
      fallbackSeen,
      deepWorkRuns24h,
      recentRuns: runs.slice(0, 10),
      recentRouting: routing.slice(0, 10),
      fallbackEvents: fallbackEvents.slice(0, 10),
      errors,
    });
  }, [user]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const recommendation: { kind: 'pass' | 'warn' | 'fail'; label: string } = (() => {
    if (snap.loading) return { kind: 'warn', label: 'Loading…' };
    if ((snap.duplicates ?? 0) > 0 || (snap.orphans ?? 0) > 0) {
      return { kind: 'fail', label: 'Blocked — duplicates or orphans present' };
    }
    if ((snap.laneCount24h ?? 0) === 0) return { kind: 'warn', label: 'Needs traffic — no lane telemetry' };
    if (!snap.fallbackSeen) return { kind: 'warn', label: 'Needs traffic — no fallback success recorded' };
    return { kind: 'pass', label: 'Ready to test' };
  })();

  const gaps: string[] = [];
  if ((snap.laneCount24h ?? 0) === 0) gaps.push('No lane telemetry recorded in last 24h');
  if (!snap.fallbackSeen) gaps.push('No fallback success recorded');
  if ((snap.deepWorkRuns24h ?? 0) === 0) gaps.push('No deep-work runs in last 24h');
  if ((snap.duplicates ?? 0) > 0) gaps.push(`${snap.duplicates} duplicate active run(s) for same (thread_id, task_type)`);
  if ((snap.orphans ?? 0) > 0) gaps.push(`${snap.orphans} orphaned authoring run(s) older than 5min`);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-3 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <SheetTitle>Validation Status</SheetTitle>
              <SheetDescription>Live readiness for Strategy validation.</SheetDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={load} disabled={snap.loading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${snap.loading ? 'animate-spin' : ''}`} />
              Refresh
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1 px-6 pb-6">
          {snap.errors.length > 0 && (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
              <div className="font-medium mb-1">Some checks failed to load:</div>
              <ul className="space-y-0.5">{snap.errors.map((e, i) => <li key={i}>• {e}</li>)}</ul>
            </div>
          )}

          {/* SECTION 1 — Readiness */}
          <h3 className="text-sm font-semibold mb-2">Readiness</h3>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span>Duplicates</span>
              {snap.loading ? <Skeleton className="h-4 w-16" /> :
                <StatusBadge kind={(snap.duplicates ?? 0) === 0 ? 'pass' : 'fail'}
                  label={(snap.duplicates ?? 0) === 0 ? 'Clear' : `${snap.duplicates} blocked`} />}
            </div>
            <div className="flex items-center justify-between">
              <span>Orphans</span>
              {snap.loading ? <Skeleton className="h-4 w-16" /> :
                <StatusBadge kind={(snap.orphans ?? 0) === 0 ? 'pass' : 'fail'}
                  label={(snap.orphans ?? 0) === 0 ? 'Clear' : `${snap.orphans} blocked`} />}
            </div>
            <div className="flex items-center justify-between">
              <span>Lane telemetry (24h)</span>
              {snap.loading ? <Skeleton className="h-4 w-16" /> :
                <StatusBadge kind={(snap.laneCount24h ?? 0) > 0 ? 'pass' : 'warn'}
                  label={(snap.laneCount24h ?? 0) > 0 ? `${snap.laneCount24h} rows` : 'Missing'} />}
            </div>
            <div className="flex items-center justify-between">
              <span>Fallback success</span>
              {snap.loading ? <Skeleton className="h-4 w-16" /> :
                <StatusBadge kind={snap.fallbackSeen ? 'pass' : 'warn'}
                  label={snap.fallbackSeen ? 'Seen' : 'Not seen'} />}
            </div>
            <div className="flex items-center justify-between">
              <span>Deep-work runs (24h)</span>
              {snap.loading ? <Skeleton className="h-4 w-16" /> :
                <StatusBadge kind={(snap.deepWorkRuns24h ?? 0) > 0 ? 'pass' : 'info'}
                  label={`${snap.deepWorkRuns24h ?? 0}`} />}
            </div>
            <Separator className="my-3" />
            <div className="flex items-center justify-between">
              <span className="font-medium">Recommendation</span>
              <StatusBadge kind={recommendation.kind} label={recommendation.label} />
            </div>
          </div>

          <Separator className="my-5" />

          {/* SECTION 2 — Validation Gaps */}
          <h3 className="text-sm font-semibold mb-2">Validation Gaps</h3>
          {snap.loading ? (
            <Skeleton className="h-12 w-full" />
          ) : gaps.length === 0 ? (
            <p className="text-xs text-muted-foreground">No gaps detected.</p>
          ) : (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {gaps.map((g, i) => <li key={i}>• {g}</li>)}
            </ul>
          )}

          <Separator className="my-5" />

          {/* SECTION 3 — Latest task_runs */}
          <h3 className="text-sm font-semibold mb-2">Latest deep-work runs</h3>
          {snap.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : snap.recentRuns.length === 0 ? (
            <p className="text-xs text-muted-foreground">No runs yet.</p>
          ) : (
            <ul className="space-y-1.5 text-xs font-mono">
              {snap.recentRuns.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{r.task_type}</span>
                  <Badge variant={r.status === 'completed' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'} className="text-[10px] h-4">
                    {r.status}
                  </Badge>
                  <span className="text-muted-foreground truncate w-32 text-right">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Separator className="my-5" />

          {/* SECTION 4 — Routing decisions */}
          <h3 className="text-sm font-semibold mb-2">Latest routing decisions</h3>
          {snap.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : snap.recentRouting.length === 0 ? (
            <p className="text-xs text-muted-foreground">No routing telemetry recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-xs font-mono">
              {snap.recentRouting.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <span>{r.lane}{r.auto_promoted ? ' (auto)' : ''}</span>
                  <span className="text-muted-foreground truncate w-32 text-right">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <Separator className="my-5" />

          {/* SECTION 5 — Fallback events */}
          <h3 className="text-sm font-semibold mb-2">Recent fallback events</h3>
          {snap.loading ? (
            <Skeleton className="h-12 w-full" />
          ) : snap.fallbackEvents.length === 0 ? (
            <p className="text-xs text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="space-y-1.5 text-xs">
              {snap.fallbackEvents.map((r) => {
                const fb = r.meta?.authoring_fallback;
                return (
                  <li key={r.id} className="rounded border border-border/40 p-2">
                    <div className="flex items-center justify-between">
                      <span className="font-mono">{r.task_type}</span>
                      <StatusBadge kind={fb?.success ? 'pass' : 'fail'} label={fb?.success ? 'success' : 'failed'} />
                    </div>
                    {fb?.primary_error && (
                      <div className="mt-1 text-[10px] text-muted-foreground truncate">
                        primary: {String(fb.primary_error).slice(0, 120)}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
