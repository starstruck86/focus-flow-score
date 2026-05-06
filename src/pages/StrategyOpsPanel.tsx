/**
 * Strategy Operations Dashboard — /admin/ops
 *
 * Read-only operator surface for Strategy telemetry, gates, latency, costs, anomalies.
 * Owner-gated via existing ProtectedRoute + allowlist.
 */
import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { SafePage } from '@/components/SafePage';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock, Search } from 'lucide-react';
import {
  fetchEvidenceByType, fetchGateAggregates, fetchLatencyData, fetchCostData,
  fetchAnomalyRuns, fetchRunDetail, fetchRecentRuns,
  parseArtifactGate, parseCost, parseAnomalyFlags, parseStageLats, parseTokenUsage,
  type EvidenceRow, type GateAggRow, type TelemetryRow, type CostRow,
  type AnomalyRow, type RunListRow, type TaskRunSectionRow,
} from '@/lib/strategy-ops/queries';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function relTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function isStale(dateStr: string | null | undefined, days = 7): boolean {
  if (!dateStr) return true;
  return Date.now() - new Date(dateStr).getTime() > days * 86_400_000;
}

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtCost(usd: number | null | undefined): string {
  if (usd == null) return '—';
  return `$${usd.toFixed(4)}`;
}

function fmtTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n > 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function StatusBadge({ pass }: { pass: boolean | undefined }) {
  if (pass === true) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">PASS</Badge>;
  if (pass === false) return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">FAIL</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function LoadingSkeleton() {
  return <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}

/* ------------------------------------------------------------------ */
/*  useAsyncData hook                                                  */
/* ------------------------------------------------------------------ */

function useAsyncData<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetcher());
    } catch (e: any) {
      setError(e?.message ?? 'Query failed');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { load(); }, [load]);

  return { data, loading, error, refetch: load };
}

/* ================================================================== */
/*  TAB: Evidence                                                      */
/* ================================================================== */

function EvidenceTab({ userId }: { userId: string }) {
  const { data, loading, error, refetch } = useAsyncData(() => fetchEvidenceByType(userId), [userId]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;
  if (!data?.length) return <p className="text-muted-foreground p-4">No completed runs found.</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Latest successful run per task type</p>
        <Button variant="ghost" size="sm" onClick={refetch}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <div className="overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task Type</TableHead>
              <TableHead>Last Success</TableHead>
              <TableHead>Gate</TableHead>
              <TableHead>Regen</TableHead>
              <TableHead>Latency</TableHead>
              <TableHead>Cost</TableHead>
              <TableHead>Sections</TableHead>
              <TableHead>Draft</TableHead>
              <TableHead>Review</TableHead>
              <TableHead>Anomalies</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map(r => {
              const gate = parseArtifactGate(r.meta);
              const cost = parseCost(r.meta);
              const lats = parseStageLats(r.meta);
              const totalMs = Object.values(lats).reduce((s, v) => s + v, 0);
              const anomalies = parseAnomalyFlags(r.meta);
              const stale = isStale(r.completed_at);
              return (
                <TableRow key={r.id} className={stale ? 'bg-yellow-500/5' : ''}>
                  <TableCell className="font-mono text-xs">{r.task_type}</TableCell>
                  <TableCell className={stale ? 'text-yellow-400' : ''}>{relTime(r.completed_at)}</TableCell>
                  <TableCell><StatusBadge pass={gate.pass} /></TableCell>
                  <TableCell>{gate.regen_attempts ?? 0}</TableCell>
                  <TableCell>{fmtMs(totalMs || null)}</TableCell>
                  <TableCell>{fmtCost(cost)}</TableCell>
                  <TableCell>
                    {gate.sections_passed != null ? (
                      <span>{gate.sections_passed}✓ {gate.sections_failed ?? 0}✗</span>
                    ) : '—'}
                  </TableCell>
                  <TableCell>{r.draft_output ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}</TableCell>
                  <TableCell>{r.review_output ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-muted-foreground" />}</TableCell>
                  <TableCell>
                    {anomalies.length > 0 ? (
                      <div className="flex gap-1 flex-wrap">{anomalies.map(a => <Badge key={a} variant="outline" className="text-xs text-yellow-400 border-yellow-500/30">{a}</Badge>)}</div>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Gates                                                         */
/* ================================================================== */

function GatesTab({ userId }: { userId: string }) {
  const { data, loading, error } = useAsyncData(() => fetchGateAggregates(userId), [userId]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;
  if (!data?.length) return <p className="text-muted-foreground p-4">No gate data found.</p>;

  return (
    <div className="space-y-6">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Task Type</TableHead>
            <TableHead>Total</TableHead>
            <TableHead>Pass Rate</TableHead>
            <TableHead>Regen Rate</TableHead>
            <TableHead>Regen Success</TableHead>
            <TableHead>Readability Norm</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(r => (
            <TableRow key={r.task_type}>
              <TableCell className="font-mono text-xs">{r.task_type}</TableCell>
              <TableCell>{r.total}</TableCell>
              <TableCell>
                <span className={r.passed / r.total >= 0.8 ? 'text-emerald-400' : 'text-yellow-400'}>
                  {r.total > 0 ? `${((r.passed / r.total) * 100).toFixed(0)}%` : '—'}
                </span>
              </TableCell>
              <TableCell>{r.total > 0 ? `${((r.regen_triggered / r.total) * 100).toFixed(0)}%` : '—'}</TableCell>
              <TableCell>{r.regen_triggered > 0 ? `${((r.regen_succeeded / r.regen_triggered) * 100).toFixed(0)}%` : '—'}</TableCell>
              <TableCell>{r.readability_normalized}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Card>
        <CardHeader><CardTitle className="text-base">Failed Dimensions Frequency</CardTitle></CardHeader>
        <CardContent>
          {data.some(r => Object.keys(r.failed_dimensions).length > 0) ? (
            <div className="flex flex-wrap gap-2">
              {data.flatMap(r => Object.entries(r.failed_dimensions).map(([dim, count]) => (
                <Badge key={`${r.task_type}-${dim}`} variant="outline" className="text-red-400 border-red-500/30">
                  {dim}: {count}
                </Badge>
              )))}
            </div>
          ) : <p className="text-muted-foreground text-sm">No failed dimensions recorded.</p>}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Latency                                                       */
/* ================================================================== */

function LatencyTab({ userId }: { userId: string }) {
  const [days, setDays] = useState(7);
  const { data, loading, error, refetch } = useAsyncData(() => fetchLatencyData(userId, days), [userId, days]);

  const aggregated = useMemo(() => {
    if (!data?.length) return [];
    const byStage = new Map<string, number[]>();
    for (const r of data) {
      if (r.duration_ms == null) continue;
      const key = r.stage;
      const arr = byStage.get(key) ?? [];
      arr.push(r.duration_ms);
      byStage.set(key, arr);
    }
    return Array.from(byStage.entries()).map(([stage, vals]) => {
      vals.sort((a, b) => a - b);
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      const p95 = vals[Math.floor(vals.length * 0.95)] ?? vals[vals.length - 1];
      return { stage, count: vals.length, avg, p95, max: vals[vals.length - 1] };
    }).sort((a, b) => b.avg - a.avg);
  }, [data]);

  const byProvider = useMemo(() => {
    if (!data?.length) return [];
    const map = new Map<string, number[]>();
    for (const r of data) {
      if (r.duration_ms == null || !r.provider) continue;
      const key = `${r.provider}/${r.model ?? '?'}`;
      const arr = map.get(key) ?? [];
      arr.push(r.duration_ms);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([key, vals]) => {
      vals.sort((a, b) => a - b);
      return { key, count: vals.length, avg: vals.reduce((s, v) => s + v, 0) / vals.length, p95: vals[Math.floor(vals.length * 0.95)] ?? vals[vals.length - 1] };
    }).sort((a, b) => b.avg - a.avg);
  }, [data]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Select value={String(days)} onValueChange={v => setDays(Number(v))}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1">Last 24h</SelectItem>
            <SelectItem value="7">Last 7d</SelectItem>
            <SelectItem value="30">Last 30d</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{data?.length ?? 0} telemetry rows</span>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Latency by Stage</CardTitle></CardHeader>
        <CardContent>
          {aggregated.length === 0 ? <p className="text-muted-foreground text-sm">No data</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Stage</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Avg</TableHead>
                  <TableHead>P95</TableHead>
                  <TableHead>Max</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {aggregated.map(r => (
                  <TableRow key={r.stage}>
                    <TableCell className="font-mono text-xs">{r.stage}</TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell>{fmtMs(r.avg)}</TableCell>
                    <TableCell>{fmtMs(r.p95)}</TableCell>
                    <TableCell>{fmtMs(r.max)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Latency by Provider/Model</CardTitle></CardHeader>
        <CardContent>
          {byProvider.length === 0 ? <p className="text-muted-foreground text-sm">No provider data</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider/Model</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>Avg</TableHead>
                  <TableHead>P95</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byProvider.map(r => (
                  <TableRow key={r.key}>
                    <TableCell className="font-mono text-xs">{r.key}</TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell>{fmtMs(r.avg)}</TableCell>
                    <TableCell>{fmtMs(r.p95)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Costs                                                         */
/* ================================================================== */

function CostsTab({ userId }: { userId: string }) {
  const { data, loading, error } = useAsyncData(() => fetchCostData(userId), [userId]);

  const aggregated = useMemo(() => {
    if (!data?.length) return { byType: [] as { type: string; total: number; count: number; avgTokensIn: number; avgTokensOut: number }[], totalCost: 0, highest: null as CostRow | null };
    const byType = new Map<string, { total: number; count: number; tokensIn: number; tokensOut: number }>();
    let totalCost = 0;
    let highest: CostRow | null = null;
    for (const r of data) {
      const c = r.cost_estimate_usd ?? 0;
      totalCost += c;
      if (!highest || c > (highest.cost_estimate_usd ?? 0)) highest = r;
      const agg = byType.get(r.task_type) ?? { total: 0, count: 0, tokensIn: 0, tokensOut: 0 };
      agg.total += c;
      agg.count++;
      agg.tokensIn += r.token_input ?? 0;
      agg.tokensOut += r.token_output ?? 0;
      byType.set(r.task_type, agg);
    }
    return {
      byType: Array.from(byType.entries()).map(([type, v]) => ({
        type, total: v.total, count: v.count,
        avgTokensIn: v.count > 0 ? v.tokensIn / v.count : 0,
        avgTokensOut: v.count > 0 ? v.tokensOut / v.count : 0,
      })).sort((a, b) => b.total - a.total),
      totalCost,
      highest,
    };
  }, [data]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;
  if (!data?.length) return <p className="text-muted-foreground p-4">No cost data found.</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Total Spend (est.)</p><p className="text-lg font-semibold">{fmtCost(aggregated.totalCost)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Runs Tracked</p><p className="text-lg font-semibold">{data.length}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Avg/Run</p><p className="text-lg font-semibold">{fmtCost(data.length > 0 ? aggregated.totalCost / data.length : null)}</p></CardContent></Card>
        <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Est. Monthly (×30)</p><p className="text-lg font-semibold text-yellow-400">{fmtCost(aggregated.totalCost * 30 / Math.max(data.length, 1))}</p><p className="text-xs text-muted-foreground">⚠ rough estimate</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Cost by Task Type</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task Type</TableHead>
                <TableHead>Runs</TableHead>
                <TableHead>Total Cost</TableHead>
                <TableHead>Avg In Tokens</TableHead>
                <TableHead>Avg Out Tokens</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {aggregated.byType.map(r => (
                <TableRow key={r.type}>
                  <TableCell className="font-mono text-xs">{r.type}</TableCell>
                  <TableCell>{r.count}</TableCell>
                  <TableCell>{fmtCost(r.total)}</TableCell>
                  <TableCell>{fmtTokens(r.avgTokensIn)}</TableCell>
                  <TableCell>{fmtTokens(r.avgTokensOut)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Anomalies                                                     */
/* ================================================================== */

function AnomaliesTab({ userId, onDrilldown }: { userId: string; onDrilldown: (id: string) => void }) {
  const { data, loading, error } = useAsyncData(() => fetchAnomalyRuns(userId), [userId]);
  const [filter, setFilter] = useState('');

  const allFlags = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.forEach(r => r.flags.forEach(f => set.add(f)));
    return Array.from(set).sort();
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    if (!filter) return data;
    return data.filter(r => r.flags.includes(filter));
  }, [data, filter]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;
  if (!data?.length) return <p className="text-muted-foreground p-4">No anomalies detected. 🎉</p>;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant={!filter ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setFilter('')}>All ({data.length})</Badge>
        {allFlags.map(f => (
          <Badge key={f} variant={filter === f ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setFilter(f)}>{f}</Badge>
        ))}
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Run ID</TableHead>
            <TableHead>Task Type</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Completed</TableHead>
            <TableHead>Flags</TableHead>
            <TableHead></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map(r => (
            <TableRow key={r.id}>
              <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
              <TableCell className="font-mono text-xs">{r.task_type}</TableCell>
              <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
              <TableCell>{relTime(r.completed_at)}</TableCell>
              <TableCell>
                <div className="flex gap-1 flex-wrap">
                  {r.flags.map(f => <Badge key={f} variant="outline" className="text-xs text-yellow-400 border-yellow-500/30">{f}</Badge>)}
                </div>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="sm" onClick={() => onDrilldown(r.id)}>
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Run Drilldown                                                 */
/* ================================================================== */

function RunDrilldownTab({ userId, initialRunId }: { userId: string; initialRunId?: string }) {
  const [runId, setRunId] = useState(initialRunId ?? '');
  const [inputVal, setInputVal] = useState(initialRunId ?? '');
  const { data: runs } = useAsyncData(() => fetchRecentRuns(userId), [userId]);

  // Auto-load when initialRunId changes
  useEffect(() => {
    if (initialRunId) { setRunId(initialRunId); setInputVal(initialRunId); }
  }, [initialRunId]);

  const { data: detail, loading, error } = useAsyncData(
    () => runId ? fetchRunDetail(runId) : Promise.resolve(null),
    [runId]
  );

  const run = detail?.run;
  const telemetry = detail?.telemetry ?? [];
  const sections = detail?.sections ?? [];

  return (
    <div className="space-y-6">
      {/* Selector */}
      <div className="flex items-center gap-2">
        <Input
          placeholder="Paste run ID…"
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          className="font-mono text-xs max-w-[320px]"
        />
        <Button size="sm" onClick={() => setRunId(inputVal.trim())}>Load</Button>
      </div>

      {runs && runs.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Recent:</span>
          {runs.slice(0, 10).map(r => (
            <Badge
              key={r.id}
              variant={r.id === runId ? 'default' : 'outline'}
              className="cursor-pointer text-xs font-mono"
              onClick={() => { setRunId(r.id); setInputVal(r.id); }}
            >
              {r.id.slice(0, 8)} ({r.task_type})
            </Badge>
          ))}
        </div>
      )}

      {loading && <LoadingSkeleton />}
      {error && <p className="text-destructive">{error}</p>}

      {run && !loading && (
        <>
          {/* A. Overview */}
          <Card>
            <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Task Type</span><p className="font-mono">{run.task_type}</p></div>
                <div><span className="text-muted-foreground">Status</span><p><Badge variant="secondary">{run.status}</Badge></p></div>
                <div><span className="text-muted-foreground">Created</span><p>{relTime(run.created_at)}</p></div>
                <div><span className="text-muted-foreground">Completed</span><p>{relTime(run.completed_at)}</p></div>
                <div><span className="text-muted-foreground">Cost</span><p>{fmtCost(parseCost(run.meta))}</p></div>
                <div><span className="text-muted-foreground">Tokens</span><p>{(() => { const t = parseTokenUsage(run.meta); return `${fmtTokens(t.input)} in / ${fmtTokens(t.output)} out`; })()}</p></div>
                <div><span className="text-muted-foreground">Total Latency</span><p>{fmtMs(Object.values(parseStageLats(run.meta)).reduce((s, v) => s + v, 0) || null)}</p></div>
                {run.error && <div className="col-span-2"><span className="text-muted-foreground">Error</span><p className="text-red-400 text-xs">{run.error}</p></div>}
              </div>
            </CardContent>
          </Card>

          {/* B. Stage Timeline */}
          <Card>
            <CardHeader><CardTitle className="text-base">Stage Timeline</CardTitle></CardHeader>
            <CardContent>
              {telemetry.length === 0 ? <p className="text-muted-foreground text-sm">No telemetry rows for this run.</p> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Stage</TableHead>
                      <TableHead>Provider</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>In Tokens</TableHead>
                      <TableHead>Out Tokens</TableHead>
                      <TableHead>Success</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {telemetry.map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.stage}</TableCell>
                        <TableCell>{t.provider ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{t.model ?? '—'}</TableCell>
                        <TableCell>{fmtMs(t.duration_ms)}</TableCell>
                        <TableCell>{fmtTokens(t.input_tokens)}</TableCell>
                        <TableCell>{fmtTokens(t.output_tokens)}</TableCell>
                        <TableCell>{t.success ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* C. Gate Diagnostics */}
          <Card>
            <CardHeader><CardTitle className="text-base">Gate Diagnostics</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(() => {
                const gate = parseArtifactGate(run.meta);
                return (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Pass</span><p><StatusBadge pass={gate.pass} /></p></div>
                    <div><span className="text-muted-foreground">Sections Passed</span><p>{gate.sections_passed ?? '—'}</p></div>
                    <div><span className="text-muted-foreground">Sections Failed</span><p>{gate.sections_failed ?? '—'}</p></div>
                    <div><span className="text-muted-foreground">Regen Attempts</span><p>{gate.regen_attempts ?? 0}</p></div>
                    <div><span className="text-muted-foreground">Gate Latency</span><p>{fmtMs(gate.gate_latency_ms)}</p></div>
                    {gate.failed_dimensions.length > 0 && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Failed Dimensions</span>
                        <div className="flex gap-1 mt-1 flex-wrap">{gate.failed_dimensions.map(d => <Badge key={d} variant="outline" className="text-red-400 border-red-500/30 text-xs">{d}</Badge>)}</div>
                      </div>
                    )}
                  </div>
                );
              })()}
              {(() => {
                const norm = (run.meta as any)?.readability_normalization;
                if (!norm) return null;
                return (
                  <div className="mt-3">
                    <span className="text-muted-foreground text-sm">Readability Normalization</span>
                    <pre className="text-xs bg-muted/50 rounded p-2 mt-1 overflow-auto max-h-32">{JSON.stringify(norm, null, 2)}</pre>
                  </div>
                );
              })()}
            </CardContent>
          </Card>

          {/* D. Batch Details */}
          {sections.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Batch Details</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Batch</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Primary</TableHead>
                      <TableHead>Fallback</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead>Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections.map(s => (
                      <TableRow key={s.id}>
                        <TableCell>{s.batch_index ?? '—'}</TableCell>
                        <TableCell><Badge variant="secondary">{s.status ?? '—'}</Badge></TableCell>
                        <TableCell>{s.primary_status ?? '—'}</TableCell>
                        <TableCell>{s.fallback_status ?? '—'}</TableCell>
                        <TableCell className="font-mono text-xs">{s.model_used ?? '—'}</TableCell>
                        <TableCell>{s.attempts ?? '—'}</TableCell>
                        <TableCell className="text-xs text-red-400 max-w-[200px] truncate">{s.error ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!run && !loading && runId && <p className="text-muted-foreground">No run found for {runId.slice(0, 8)}…</p>}
    </div>
  );
}

/* ================================================================== */
/*  MAIN PAGE                                                          */
/* ================================================================== */

export default function StrategyOpsPanel() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('evidence');
  const [drilldownRunId, setDrilldownRunId] = useState<string | undefined>();

  const handleDrilldown = useCallback((id: string) => {
    setDrilldownRunId(id);
    setActiveTab('drilldown');
  }, []);

  if (!user) return null;

  return (
    <SafePage className="px-4 py-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Strategy Operations</h1>
        <Badge variant="outline" className="text-xs">read-only</Badge>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="gates">Gates</TabsTrigger>
          <TabsTrigger value="latency">Latency</TabsTrigger>
          <TabsTrigger value="costs">Costs</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="drilldown">Run Drilldown</TabsTrigger>
        </TabsList>

        <TabsContent value="evidence"><EvidenceTab userId={user.id} /></TabsContent>
        <TabsContent value="gates"><GatesTab userId={user.id} /></TabsContent>
        <TabsContent value="latency"><LatencyTab userId={user.id} /></TabsContent>
        <TabsContent value="costs"><CostsTab userId={user.id} /></TabsContent>
        <TabsContent value="anomalies"><AnomaliesTab userId={user.id} onDrilldown={handleDrilldown} /></TabsContent>
        <TabsContent value="drilldown"><RunDrilldownTab userId={user.id} initialRunId={drilldownRunId} /></TabsContent>
      </Tabs>
    </SafePage>
  );
}
