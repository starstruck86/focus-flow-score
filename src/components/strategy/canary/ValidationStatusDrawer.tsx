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
//   2. Validation Gaps    — explicit empty-state callouts
//   3. Latest deep-work runs (last 10)
//   4. Latest routing decisions (last 10)
//   5. Recent fallback events
//   6. Canary Runs        — recent validation-canary invocations grouped
//                            by validator_run_id, with one-click rerun
//   7. Verdict Rules      — collapsed by default; static deterministic
//                            ENABLE / HOLD / DO NOT ENABLE rules
//
// Empty states are explicit. Partial data renders safely.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback, useMemo } from 'react';
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { RefreshCw, CheckCircle2, AlertCircle, XCircle, Info, ChevronDown, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ensureValidationKey } from '@/lib/strategy/canary/validationKey';

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

interface CanaryRunGroup {
  validator_run_id: string;
  mode: string;
  thread_id: string | null;
  task_type: string;
  created_at: string;
  runs: TaskRunRow[];
  fallback_triggered: boolean;
  fallback_success: boolean | null;
  same_run_id_returned: boolean | null;
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
  canaryGroups: CanaryRunGroup[];
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
  canaryGroups: [],
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

function groupCanaryRuns(runs: TaskRunRow[]): CanaryRunGroup[] {
  const byValidator = new Map<string, CanaryRunGroup>();
  for (const r of runs) {
    const vc = r.meta?.validation_canary;
    if (!vc?.validator_run_id) continue;
    const vid = String(vc.validator_run_id);
    let group = byValidator.get(vid);
    if (!group) {
      group = {
        validator_run_id: vid,
        mode: String(vc.mode ?? 'unknown'),
        thread_id: vc.thread_id ?? null,
        task_type: r.task_type,
        created_at: r.created_at,
        runs: [],
        fallback_triggered: false,
        fallback_success: null,
        same_run_id_returned: null,
      };
      byValidator.set(vid, group);
    }
    group.runs.push(r);
    // Earliest created_at wins for sort
    if (r.created_at < group.created_at) group.created_at = r.created_at;
    const fb = r.meta?.authoring_fallback;
    if (fb?.triggered) {
      group.fallback_triggered = true;
      group.fallback_success = fb.success === true ? true : (group.fallback_success ?? (fb.success === false ? false : null));
    }
  }
  // Compute collision result if mode === collision
  for (const g of byValidator.values()) {
    if (g.mode === 'collision') {
      const ids = new Set(g.runs.map((r) => r.id));
      // If both attempts converged on the same run_id, the group will only
      // contain ONE row (idempotent path returned existing run).
      g.same_run_id_returned = ids.size === 1 && g.runs.length >= 1;
    }
  }
  return Array.from(byValidator.values()).sort((a, b) =>
    b.created_at.localeCompare(a.created_at),
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
  const [rerunningId, setRerunningId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setSnap((s) => ({ ...s, loading: true, errors: [] }));
    const errors: string[] = [];

    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const stallCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    const [runsRes, routingRes, dupRes, orphansRes] = await Promise.all([
      supabase
        .from('task_runs')
        .select('id, task_type, status, progress_step, error, created_at, meta')
        .eq('user_id', user.id)
        .in('task_type', DEEP_TASK_TYPES)
        .order('created_at', { ascending: false })
        .limit(50),
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
    const canaryGroups = groupCanaryRuns(runs).slice(0, 10);

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
      canaryGroups,
      errors,
    });
  }, [user]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const recommendation: { kind: 'pass' | 'warn' | 'fail'; label: string } = useMemo(() => {
    if (snap.loading) return { kind: 'warn', label: 'Loading…' };
    if ((snap.duplicates ?? 0) > 0 || (snap.orphans ?? 0) > 0) {
      return { kind: 'fail', label: 'Blocked — duplicates or orphans present' };
    }
    if ((snap.laneCount24h ?? 0) === 0) return { kind: 'warn', label: 'Needs traffic — no lane telemetry' };
    if (!snap.fallbackSeen) return { kind: 'warn', label: 'Needs traffic — no fallback success recorded' };
    return { kind: 'pass', label: 'Ready to test' };
  }, [snap]);

  const gaps: string[] = [];
  if ((snap.laneCount24h ?? 0) === 0) gaps.push('No lane telemetry recorded in last 24h');
  if (!snap.fallbackSeen) gaps.push('No fallback success recorded');
  if ((snap.deepWorkRuns24h ?? 0) === 0) gaps.push('No deep-work runs in last 24h');
  if ((snap.duplicates ?? 0) > 0) gaps.push(`${snap.duplicates} duplicate active run(s) for same (thread_id, task_type)`);
  if ((snap.orphans ?? 0) > 0) gaps.push(`${snap.orphans} orphaned authoring run(s) older than 5min`);

  const handleRerun = useCallback(async (group: CanaryRunGroup) => {
    if (!group.thread_id) {
      toast.error('Cannot rerun — original thread_id missing');
      return;
    }
    const key = ensureValidationKey();
    if (!key) return;
    setRerunningId(group.validator_run_id);
    toast(`Re-running canary (${group.mode})…`);
    try {
      const { data, error } = await supabase.functions.invoke('run-validation-canary', {
        body: {
          mode: group.mode,
          thread_id: group.thread_id,
          task_type: group.task_type,
          validation_key: key,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Canary started — validator_run_id ${String(data?.validator_run_id || '').slice(0, 8)}…`);
      await load();
    } catch (e: any) {
      toast.error(`Rerun failed: ${e?.message || String(e)}`);
    } finally {
      setRerunningId(null);
    }
  }, [load]);

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

          {/* SECTION 3 — Canary Runs (validator_run_id grouped) */}
          <h3 className="text-sm font-semibold mb-2">Canary runs</h3>
          {snap.loading ? (
            <Skeleton className="h-24 w-full" />
          ) : snap.canaryGroups.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No canary-tagged runs yet. Use <code className="font-mono">run-validation-canary</code> to seed evidence.
            </p>
          ) : (
            <ul className="space-y-2">
              {snap.canaryGroups.map((g) => {
                const isRerunning = rerunningId === g.validator_run_id;
                return (
                  <li key={g.validator_run_id} className="rounded border border-border/60 p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Badge variant="outline" className="h-5 text-[10px] uppercase">{g.mode}</Badge>
                        <span className="font-mono truncate">{g.task_type}</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[10px]"
                        disabled={isRerunning || !g.thread_id}
                        onClick={() => handleRerun(g)}
                      >
                        <RotateCw className={`h-3 w-3 mr-1 ${isRerunning ? 'animate-spin' : ''}`} />
                        Re-run
                      </Button>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                      <span>vrid: <span className="font-mono">{g.validator_run_id.slice(0, 8)}…</span></span>
                      <span>{new Date(g.created_at).toLocaleString()}</span>
                      <span>runs: {g.runs.length}</span>
                      {g.mode === 'fallback' && (
                        <>
                          <StatusBadge
                            kind={g.fallback_triggered ? 'pass' : 'warn'}
                            label={`fb: ${g.fallback_triggered ? 'triggered' : 'not seen'}`}
                          />
                          <StatusBadge
                            kind={g.fallback_success === true ? 'pass' : g.fallback_success === false ? 'fail' : 'info'}
                            label={`success: ${g.fallback_success === null ? 'n/a' : g.fallback_success ? 'yes' : 'no'}`}
                          />
                        </>
                      )}
                      {g.mode === 'collision' && (
                        <StatusBadge
                          kind={g.same_run_id_returned ? 'pass' : 'warn'}
                          label={`same id: ${g.same_run_id_returned === null ? 'n/a' : g.same_run_id_returned ? 'yes' : 'no'}`}
                        />
                      )}
                    </div>
                    <ul className="mt-1.5 space-y-0.5 font-mono text-[10px]">
                      {g.runs.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">{r.id.slice(0, 8)}…</span>
                          <Badge
                            variant={r.status === 'completed' ? 'default' : r.status === 'failed' ? 'destructive' : 'secondary'}
                            className="h-4 text-[9px]"
                          >
                            {r.status}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ul>
          )}

          <Separator className="my-5" />

          {/* SECTION 4 — Latest task_runs */}
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

          {/* SECTION 5 — Routing decisions */}
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

          {/* SECTION 6 — Fallback events */}
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

          <Separator className="my-5" />

          {/* SECTION 7 — Verdict Rules (collapsible) */}
          <Collapsible>
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-semibold hover:text-foreground/80">
              <span>Verdict rules</span>
              <ChevronDown className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 space-y-3 text-xs text-muted-foreground">
              <div>
                <div className="font-medium text-foreground mb-1">ENABLE — only if all true</div>
                <ul className="space-y-0.5 pl-3">
                  <li>• duplicates = 0</li>
                  <li>• orphans = 0</li>
                  <li>• normal run succeeds</li>
                  <li>• fallback run succeeds</li>
                  <li>• collision returns same run_id</li>
                  <li>• no unexplained failures</li>
                  <li>• lane telemetry exists</li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-foreground mb-1">HOLD</div>
                <ul className="space-y-0.5 pl-3">
                  <li>• system looks structurally good but required live evidence is missing</li>
                </ul>
              </div>
              <div>
                <div className="font-medium text-foreground mb-1">DO NOT ENABLE</div>
                <ul className="space-y-0.5 pl-3">
                  <li>• duplicates appear</li>
                  <li>• orphans appear</li>
                  <li>• fallback fails</li>
                  <li>• collision creates multiple active rows</li>
                  <li>• Discovery Prep regresses</li>
                  <li>• lane telemetry remains absent after validation attempts</li>
                </ul>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}
