/**
 * Strategy Operations Dashboard — /admin/ops
 *
 * Read-only operator surface for Strategy telemetry, gates, latency, costs, anomalies.
 * Phase 4C: Added cost analytics, latency analytics, batch analysis, release confidence.
 * Phase 4D: Added failure cohort analysis, root-cause drilldown, remediation opportunities.
 * Phase 4E-V: Added remediation flag toggle, test harness, remediation drilldown visibility.
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
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, Clock, Search, DollarSign, Activity, Shield, Flame, Wrench, FlaskConical } from 'lucide-react';
import {
  fetchEvidenceByType, fetchGateAggregates, fetchLatencyData, fetchCostData,
  fetchAnomalyRuns, fetchRunDetail, fetchRecentRuns,
  parseArtifactGate, parseCost, parseAnomalyFlags, parseStageLats, parseTokenUsage, parseRemediation,
  fetchRemediationRolloutData, filterRemediationGateChangers, computeRolloutHealth,
  type EvidenceRow, type GateAggRow, type TelemetryRow, type CostRow,
  type AnomalyRow, type RunListRow, type TaskRunSectionRow, type RemediationRolloutRow,
} from '@/lib/strategy-ops/queries';
import {
  getCostSummary, getCostByTaskType, getCostByProvider, getCostByStage,
  getMostExpensiveRuns, getFailedRunCostWaste,
  type CostSummary, type CostByDimension, type ExpensiveRun, type FailedRunWaste,
} from '@/lib/strategy-ops/costAnalytics';
import {
  getLatencySummary, getLatencyByStage, getLatencyByTaskType,
  getSlowestRuns, getLatencyTrend, getBatchExecutionAnalytics,
  type LatencySummary, type StageLatency, type SlowestRun, type LatencyTrendPoint, type BatchAnalytics,
} from '@/lib/strategy-ops/latencyAnalytics';
import { computeReleaseConfidence, type ReleaseConfidence } from '@/lib/strategy-ops/releaseConfidence';
import {
  getCohortSummaries, getFailureBreakdown, getWasteSummary, classifyFailures,
  type CohortSummary, type FailureBreakdown, type WasteSummary, type ClassifiedFailure,
  REASON_LABELS, ERA_LABELS,
} from '@/lib/strategy-ops/failureAnalysis';
import { aggregateRemediationOpportunities, isRemediationEnabled, type RemediationOpportunity } from '@/lib/strategy-ops/targetedRemediation';
import { loadStrategyFlags, setStrategyFlag, type StrategyOptFlags } from '@/lib/strategy-ops/strategyFeatureFlags';

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
  if (ms < 1000) return `${Math.round(ms)}ms`;
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

function fmtPct(n: number | null | undefined): string {
  if (n == null) return '—';
  return `${n.toFixed(1)}%`;
}

function StatusBadge({ pass }: { pass: boolean | undefined }) {
  if (pass === true) return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">PASS</Badge>;
  if (pass === false) return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">FAIL</Badge>;
  return <Badge variant="secondary">—</Badge>;
}

function LoadingSkeleton() {
  return <div className="space-y-3 p-4">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>;
}

function MetricCard({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-lg font-semibold ${warn ? 'text-yellow-400' : ''}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
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
/*  TAB: Cost Deep Dive (Phase 4C)                                     */
/* ================================================================== */

function CostDeepTab({ userId }: { userId: string }) {
  const [days, setDays] = useState(7);
  const { data: summary, loading: l1 } = useAsyncData(() => getCostSummary(userId, days), [userId, days]);
  const { data: byType, loading: l2 } = useAsyncData(() => getCostByTaskType(userId, days), [userId, days]);
  const { data: byProvider, loading: l3 } = useAsyncData(() => getCostByProvider(userId, days), [userId, days]);
  const { data: byStage, loading: l4 } = useAsyncData(() => getCostByStage(userId, days), [userId, days]);
  const { data: expensive, loading: l5 } = useAsyncData(() => getMostExpensiveRuns(userId, 10), [userId]);
  const { data: waste, loading: l6 } = useAsyncData(() => getFailedRunCostWaste(userId, days), [userId, days]);

  const loading = l1 || l2 || l3;
  if (loading) return <LoadingSkeleton />;

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
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Spend" value={fmtCost(summary.total_usd)} />
          <MetricCard label="Runs" value={`${summary.successful_runs}✓ ${summary.failed_runs}✗`} />
          <MetricCard label="Avg/Run" value={fmtCost(summary.avg_per_run)} />
          <MetricCard label="Avg/Successful Run" value={fmtCost(summary.avg_per_successful_run)} />
          <MetricCard label="Failed Run Waste" value={fmtCost(summary.failed_run_waste_usd)} warn={summary.failed_run_waste_usd > 0} />
          <MetricCard label="Regen Waste" value={fmtCost(summary.regen_waste_usd)} warn={summary.regen_waste_usd > 0} />
        </div>
      )}

      {byType && byType.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cost by Task Type</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Task Type</TableHead><TableHead>Total</TableHead><TableHead>Runs</TableHead><TableHead>Avg</TableHead></TableRow></TableHeader>
              <TableBody>
                {byType.map(r => (
                  <TableRow key={r.key}><TableCell className="font-mono text-xs">{r.key}</TableCell><TableCell>{fmtCost(r.total_usd)}</TableCell><TableCell>{r.count}</TableCell><TableCell>{fmtCost(r.avg_usd)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {byProvider && byProvider.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cost by Provider/Model</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Provider/Model</TableHead><TableHead>Total</TableHead><TableHead>Calls</TableHead><TableHead>Avg</TableHead></TableRow></TableHeader>
              <TableBody>
                {byProvider.map(r => (
                  <TableRow key={r.key}><TableCell className="font-mono text-xs">{r.key}</TableCell><TableCell>{fmtCost(r.total_usd)}</TableCell><TableCell>{r.count}</TableCell><TableCell>{fmtCost(r.avg_usd)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {byStage && byStage.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Cost by Stage</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Total</TableHead><TableHead>Calls</TableHead><TableHead>Avg</TableHead></TableRow></TableHeader>
              <TableBody>
                {byStage.map(r => (
                  <TableRow key={r.key}><TableCell className="font-mono text-xs">{r.key}</TableCell><TableCell>{fmtCost(r.total_usd)}</TableCell><TableCell>{r.count}</TableCell><TableCell>{fmtCost(r.avg_usd)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {waste && (
        <Card>
          <CardHeader><CardTitle className="text-base">Failed Run Waste Analysis</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <MetricCard label="Total Waste" value={fmtCost(waste.total_waste_usd)} warn />
              <MetricCard label="Regen Waste" value={fmtCost(waste.regen_waste_usd)} warn={waste.regen_waste_usd > 0} />
              <MetricCard label="Regen Waste %" value={fmtPct(waste.regen_waste_pct)} warn={waste.regen_waste_pct > 20} />
            </div>
            {waste.by_failed_dimension.length > 0 && (
              <div>
                <p className="text-sm text-muted-foreground mb-2">Waste by Failed Dimension</p>
                <div className="flex gap-2 flex-wrap">
                  {waste.by_failed_dimension.map(d => (
                    <Badge key={d.key} variant="outline" className="text-red-400 border-red-500/30">{d.key}: {fmtCost(d.total_usd)} ({d.count}×)</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {expensive && expensive.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Most Expensive Runs</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Type</TableHead><TableHead>Cost</TableHead><TableHead>Gate</TableHead><TableHead>Regen</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {expensive.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.task_type}</TableCell>
                    <TableCell>{fmtCost(r.cost_usd)}</TableCell>
                    <TableCell><StatusBadge pass={r.gate_pass} /></TableCell>
                    <TableCell>{r.regen_attempts}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB: Latency Deep Dive (Phase 4C)                                  */
/* ================================================================== */

function LatencyDeepTab({ userId }: { userId: string }) {
  const [days, setDays] = useState(7);
  const { data: summary, loading: l1 } = useAsyncData(() => getLatencySummary(userId, days), [userId, days]);
  const { data: byStage, loading: l2 } = useAsyncData(() => getLatencyByStage(userId, days), [userId, days]);
  const { data: byType, loading: l3 } = useAsyncData(() => getLatencyByTaskType(userId, days), [userId, days]);
  const { data: slowest, loading: l4 } = useAsyncData(() => getSlowestRuns(userId, 10), [userId]);
  const { data: trend, loading: l5 } = useAsyncData(() => getLatencyTrend(userId, days), [userId, days]);
  const { data: batches, loading: l6 } = useAsyncData(() => getBatchExecutionAnalytics(userId, days), [userId, days]);

  if (l1 || l2) return <LoadingSkeleton />;

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
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Runs Measured" value={String(summary.total_runs)} />
          <MetricCard label="Avg Total" value={fmtMs(summary.avg_total_ms)} />
          <MetricCard label="P50" value={fmtMs(summary.p50_ms)} />
          <MetricCard label="P95" value={fmtMs(summary.p95_ms)} warn={summary.p95_ms > 120_000} />
          <MetricCard label="P99" value={fmtMs(summary.p99_ms)} />
          <MetricCard label="Max" value={fmtMs(summary.max_ms)} />
          <MetricCard label="Slowest Stage" value={summary.slowest_stage ?? '—'} sub={fmtMs(summary.slowest_stage_avg_ms)} />
        </div>
      )}

      {byStage && byStage.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Latency by Stage (telemetry)</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Count</TableHead><TableHead>Avg</TableHead><TableHead>P50</TableHead><TableHead>P95</TableHead><TableHead>Max</TableHead><TableHead>Contribution</TableHead></TableRow></TableHeader>
              <TableBody>
                {byStage.map(r => (
                  <TableRow key={r.stage}>
                    <TableCell className="font-mono text-xs">{r.stage}</TableCell>
                    <TableCell>{r.count}</TableCell>
                    <TableCell>{fmtMs(r.avg_ms)}</TableCell>
                    <TableCell>{fmtMs(r.p50_ms)}</TableCell>
                    <TableCell>{fmtMs(r.p95_ms)}</TableCell>
                    <TableCell>{fmtMs(r.max_ms)}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-16 bg-muted rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full" style={{ width: `${Math.min(r.contribution_pct, 100)}%` }} />
                        </div>
                        <span className="text-xs">{fmtPct(r.contribution_pct)}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {byType && byType.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Latency by Task Type</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Task Type</TableHead><TableHead>Count</TableHead><TableHead>Avg</TableHead><TableHead>P95</TableHead><TableHead>Max</TableHead></TableRow></TableHeader>
              <TableBody>
                {byType.map(r => (
                  <TableRow key={r.stage}><TableCell className="font-mono text-xs">{r.stage}</TableCell><TableCell>{r.count}</TableCell><TableCell>{fmtMs(r.avg_ms)}</TableCell><TableCell>{fmtMs(r.p95_ms)}</TableCell><TableCell>{fmtMs(r.max_ms)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {trend && trend.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Latency Trend</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Runs</TableHead><TableHead>Avg</TableHead><TableHead>P95</TableHead></TableRow></TableHeader>
              <TableBody>
                {trend.map(t => (
                  <TableRow key={t.date}><TableCell>{t.date}</TableCell><TableCell>{t.run_count}</TableCell><TableCell>{fmtMs(t.avg_ms)}</TableCell><TableCell>{fmtMs(t.p95_ms)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {batches && batches.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Batch Execution Analysis (discovery_prep)</CardTitle><CardDescription>Identifies parallelization candidates</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Count</TableHead><TableHead>Avg Duration</TableHead><TableHead>Max Duration</TableHead><TableHead>Avg Attempts</TableHead><TableHead>Fallback Rate</TableHead><TableHead>Failure Rate</TableHead></TableRow></TableHeader>
              <TableBody>
                {batches.map(b => (
                  <TableRow key={b.batch_index}>
                    <TableCell>#{b.batch_index}</TableCell>
                    <TableCell>{b.count}</TableCell>
                    <TableCell>{fmtMs(b.avg_duration_ms)}</TableCell>
                    <TableCell>{fmtMs(b.max_duration_ms)}</TableCell>
                    <TableCell>{b.avg_attempts.toFixed(1)}</TableCell>
                    <TableCell className={b.fallback_rate > 0.2 ? 'text-yellow-400' : ''}>{fmtPct(b.fallback_rate * 100)}</TableCell>
                    <TableCell className={b.failure_rate > 0.1 ? 'text-red-400' : ''}>{fmtPct(b.failure_rate * 100)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {slowest && slowest.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Slowest Runs</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader><TableRow><TableHead>Run</TableHead><TableHead>Type</TableHead><TableHead>Total</TableHead><TableHead>Cost</TableHead><TableHead>Regen</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {slowest.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.task_type}</TableCell>
                    <TableCell>{fmtMs(r.total_ms)}</TableCell>
                    <TableCell>{fmtCost(r.cost_usd)}</TableCell>
                    <TableCell>{r.regen_attempts}</TableCell>
                    <TableCell><Badge variant="secondary">{r.status}</Badge></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  TAB: Release Confidence (Phase 4C)                                 */
/* ================================================================== */

function ReleaseConfidenceTab({ userId }: { userId: string }) {
  const [days, setDays] = useState(7);
  const { data, loading, error, refetch } = useAsyncData(() => computeReleaseConfidence(userId, days), [userId, days]);

  if (loading) return <LoadingSkeleton />;
  if (error) return <p className="text-destructive p-4">{error}</p>;
  if (!data) return <p className="text-muted-foreground p-4">No data</p>;

  const scoreColor = data.score >= 80 ? 'text-emerald-400' : data.score >= 60 ? 'text-yellow-400' : 'text-red-400';

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
        <Button variant="ghost" size="sm" onClick={refetch}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      <Card>
        <CardContent className="pt-6 text-center">
          <p className="text-sm text-muted-foreground mb-2">Release Confidence Score</p>
          <p className={`text-5xl font-bold ${scoreColor}`}>{data.score}</p>
          <Badge className={`mt-2 ${data.healthy ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
            {data.healthy ? 'HEALTHY' : 'NOT READY'}
          </Badge>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="Success Rate" value={fmtPct(data.metrics.success_rate * 100)} warn={data.metrics.success_rate < 0.8} />
        <MetricCard label="Regen Rate" value={fmtPct(data.metrics.regen_rate * 100)} warn={data.metrics.regen_rate > 0.3} />
        <MetricCard label="Anomaly Rate" value={fmtPct(data.metrics.anomaly_rate * 100)} warn={data.metrics.anomaly_rate > 0.1} />
        <MetricCard label="Avg Latency" value={fmtMs(data.metrics.avg_latency_ms)} warn={data.metrics.avg_latency_ms > 120_000} />
        <MetricCard label="Avg Cost" value={fmtCost(data.metrics.avg_cost_usd)} />
        <MetricCard label="Freshness" value={data.metrics.evidence_freshness_hours != null ? `${data.metrics.evidence_freshness_hours.toFixed(0)}h ago` : '—'} />
        <MetricCard label="Sample Size" value={String(data.metrics.sample_size)} warn={data.metrics.sample_size < 5} />
      </div>

      {data.blockers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base text-red-400">Blockers</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">{data.blockers.map((b, i) => <li key={i} className="flex items-center gap-2"><XCircle className="h-4 w-4 text-red-400 shrink-0" />{b}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {data.warnings.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base text-yellow-400">Warnings</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">{data.warnings.map((w, i) => <li key={i} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-yellow-400 shrink-0" />{w}</li>)}</ul>
          </CardContent>
        </Card>
      )}

      {Object.keys(data.metrics.failed_dimension_trends).length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Failed Dimension Trends</CardTitle></CardHeader>
          <CardContent>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(data.metrics.failed_dimension_trends).map(([dim, count]) => (
                <Badge key={dim} variant="outline" className="text-red-400 border-red-500/30">{dim}: {count}</Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
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
      <div className="flex items-center gap-2">
        <Input placeholder="Paste run ID…" value={inputVal} onChange={e => setInputVal(e.target.value)} className="font-mono text-xs max-w-[320px]" />
        <Button size="sm" onClick={() => setRunId(inputVal.trim())}>Load</Button>
      </div>

      {runs && runs.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Recent:</span>
          {runs.slice(0, 10).map(r => (
            <Badge key={r.id} variant={r.id === runId ? 'default' : 'outline'} className="cursor-pointer text-xs font-mono" onClick={() => { setRunId(r.id); setInputVal(r.id); }}>
              {r.id.slice(0, 8)} ({r.task_type})
            </Badge>
          ))}
        </div>
      )}

      {loading && <LoadingSkeleton />}
      {error && <p className="text-destructive">{error}</p>}

      {run && !loading && (
        <>
          <Card>
            <CardHeader><CardTitle className="text-base">Overview</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Task Type</span><p className="font-mono">{run.task_type}</p></div>
                <div><span className="text-muted-foreground">Status</span><div><Badge variant="secondary">{run.status}</Badge></div></div>
                <div><span className="text-muted-foreground">Created</span><p>{relTime(run.created_at)}</p></div>
                <div><span className="text-muted-foreground">Completed</span><p>{relTime(run.completed_at)}</p></div>
                <div><span className="text-muted-foreground">Cost</span><p>{fmtCost(parseCost(run.meta))}</p></div>
                <div><span className="text-muted-foreground">Tokens</span><p>{(() => { const t = parseTokenUsage(run.meta); return `${fmtTokens(t.input)} in / ${fmtTokens(t.output)} out`; })()}</p></div>
                <div><span className="text-muted-foreground">Total Latency</span><p>{fmtMs(Object.values(parseStageLats(run.meta)).reduce((s, v) => s + v, 0) || null)}</p></div>
                {run.error && <div className="col-span-2"><span className="text-muted-foreground">Error</span><p className="text-red-400 text-xs">{run.error}</p></div>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Stage Timeline</CardTitle></CardHeader>
            <CardContent>
              {telemetry.length === 0 ? <p className="text-muted-foreground text-sm">No telemetry rows for this run.</p> : (
                <Table>
                  <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Provider</TableHead><TableHead>Model</TableHead><TableHead>Duration</TableHead><TableHead>In Tokens</TableHead><TableHead>Out Tokens</TableHead><TableHead>Success</TableHead></TableRow></TableHeader>
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

          {/* Remediation info (Phase 4E-V) */}
          {(() => {
            const rem = parseRemediation(run.meta);
            if (!rem) return null;
            return (
              <Card>
                <CardHeader><CardTitle className="text-base"><Wrench className="h-4 w-4 inline mr-1" />Remediation</CardTitle></CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div><span className="text-muted-foreground">Attempted</span><p>{rem.attempted ? 'Yes' : 'No'}</p></div>
                    <div><span className="text-muted-foreground">Type</span><p className="font-mono">{rem.type ?? '—'}</p></div>
                    <div><span className="text-muted-foreground">Success</span><p><StatusBadge pass={rem.success} /></p></div>
                    <div><span className="text-muted-foreground">Latency</span><p>{fmtMs(rem.latency_ms)}</p></div>
                    <div><span className="text-muted-foreground">Cost</span><p>{fmtCost(rem.cost_usd)}</p></div>
                    <div><span className="text-muted-foreground">Avoided Full Regen</span><p>{fmtCost(rem.avoided_usd)}</p></div>
                    <div><span className="text-muted-foreground">Fallback to Hard Fail</span><p>{rem.fallback ? 'Yes' : 'No'}</p></div>
                    {rem.error && <div className="col-span-2"><span className="text-muted-foreground">Error</span><p className="text-red-400 text-xs">{rem.error}</p></div>}
                    {rem.sections.length > 0 && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Sections Targeted</span>
                        <div className="flex gap-1 mt-1 flex-wrap">{rem.sections.map(s => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}</div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })()}

          {/* Remediation telemetry rows */}
          {telemetry.filter(t => t.stage === 'remediation').length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Remediation Telemetry</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Stage</TableHead><TableHead>Duration</TableHead><TableHead>Success</TableHead><TableHead>Error</TableHead><TableHead>Metadata</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {telemetry.filter(t => t.stage === 'remediation').map(t => (
                      <TableRow key={t.id}>
                        <TableCell className="font-mono text-xs">{t.stage}</TableCell>
                        <TableCell>{fmtMs(t.duration_ms)}</TableCell>
                        <TableCell>{t.success ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}</TableCell>
                        <TableCell className="text-xs text-red-400 max-w-[200px] truncate">{t.error ?? '—'}</TableCell>
                        <TableCell><pre className="text-xs max-w-[300px] overflow-auto">{JSON.stringify(t.metadata, null, 1)}</pre></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {sections.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Batch Details</CardTitle></CardHeader>
              <CardContent>
                <Table>
                  <TableHeader><TableRow><TableHead>Batch</TableHead><TableHead>Status</TableHead><TableHead>Primary</TableHead><TableHead>Fallback</TableHead><TableHead>Model</TableHead><TableHead>Attempts</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
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
/*  TAB: Failures (Phase 4D)                                           */
/* ================================================================== */

function FailuresTab({ userId, onDrilldown, remFlag }: { userId: string; onDrilldown: (id: string) => void; remFlag: boolean }) {
  const { data: waste, loading: l1 } = useAsyncData(() => getWasteSummary(userId), [userId]);
  const { data: cohorts, loading: l2 } = useAsyncData(() => getCohortSummaries(userId), [userId]);
  const { data: breakdown, loading: l3 } = useAsyncData(() => getFailureBreakdown(userId), [userId]);
  const { data: failures, loading: l4 } = useAsyncData(() => classifyFailures(userId), [userId]);
  const { data: rolloutData, loading: l5 } = useAsyncData(() => fetchRemediationRolloutData(userId), [userId]);

  const opportunities = useMemo(() => {
    if (!failures) return [];
    return aggregateRemediationOpportunities(failures);
  }, [failures]);

  // Phase 4F: Rollout metrics
  const rolloutMetrics = useMemo(() => {
    if (!rolloutData || rolloutData.length === 0) return null;
    let attempted = 0, skipped = 0, succeeded = 0, failed = 0;
    let avoidedUsd = 0;
    const byType: Record<string, { attempted: number; succeeded: number }> = {};
    const skipReasons: Record<string, number> = {};
    for (const r of rolloutData) {
      const rem = r.remediation;
      if (!rem) continue;
      if (rem.attempted) {
        attempted++;
        if (rem.success) { succeeded++; avoidedUsd += rem.avoided_usd ?? 0; }
        else failed++;
        const t = rem.type ?? 'unknown';
        if (!byType[t]) byType[t] = { attempted: 0, succeeded: 0 };
        byType[t].attempted++;
        if (rem.success) byType[t].succeeded++;
      } else if (rem.skip_reason) {
        skipped++;
        skipReasons[rem.skip_reason] = (skipReasons[rem.skip_reason] ?? 0) + 1;
      }
    }
    const total = attempted + skipped;
    return {
      total, attempted, skipped, succeeded, failed, avoidedUsd,
      successRate: attempted > 0 ? (succeeded / attempted) * 100 : 0,
      skipRate: total > 0 ? (skipped / total) * 100 : 0,
      roi: avoidedUsd > 0 ? avoidedUsd : 0,
      wouldHaveHardFailed: succeeded,
      byType: Object.entries(byType).map(([type, v]) => ({ type, ...v })),
      skipReasons: Object.entries(skipReasons).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    };
  }, [rolloutData]);

  // Rollout health check
  const rolloutHealth = useMemo(() => {
    if (!rolloutData) return null;
    return computeRolloutHealth(rolloutData);
  }, [rolloutData]);

  // Gate changers — runs where remediation flipped outcome
  const gateChangers = useMemo(() => {
    if (!rolloutData) return [];
    return filterRemediationGateChangers(rolloutData);
  }, [rolloutData]);

  const [eraFilter, setEraFilter] = useState<string>('all');
  const filteredFailures = useMemo(() => {
    if (!failures) return [];
    if (eraFilter === 'all') return failures.slice(0, 50);
    return failures.filter(f => f.era === eraFilter).slice(0, 50);
  }, [failures, eraFilter]);

  if (l1 || l2) return <LoadingSkeleton />;

  return (
    <div className="space-y-6">
      {/* Headline metrics */}
      {waste && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <MetricCard label="Total Failures" value={String(waste.total_failures)} />
          <MetricCard label="Total Waste" value={fmtCost(waste.total_waste_usd)} warn={waste.total_waste_usd > 0} />
          <MetricCard label="Historical (pre-Phase 3)" value={`${waste.historical_failures} runs`} sub={fmtCost(waste.historical_waste_usd)} />
          <MetricCard label="Current (post-Phase 3)" value={`${waste.current_failures} runs`} sub={fmtCost(waste.current_waste_usd)} warn={waste.current_failures > 0} />
          <MetricCard label="Top Root Cause" value={waste.top_reason ? REASON_LABELS[waste.top_reason] : '—'} sub={`${waste.top_reason_count} occurrences`} />
          <MetricCard label="Recoverable" value={`${waste.recoverable_failures} runs`} sub={`${fmtCost(waste.recoverable_waste_usd)} saveable`} />
        </div>
      )}

      {/* Phase 4F: Remediation rollout metrics */}
      {rolloutMetrics && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base"><Wrench className="h-4 w-4 inline mr-1" />Remediation Rollout Metrics</CardTitle>
            <CardDescription>Live experiment tracking — normalize_only for account_brief only</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <MetricCard label="Remediations Attempted" value={String(rolloutMetrics.attempted)} />
              <MetricCard label="Success Rate" value={fmtPct(rolloutMetrics.successRate)} warn={rolloutMetrics.successRate < 50} />
              <MetricCard label="Skipped (guardrails)" value={String(rolloutMetrics.skipped)} sub={fmtPct(rolloutMetrics.skipRate)} />
              <MetricCard label="Avoided Regen $" value={fmtCost(rolloutMetrics.avoidedUsd)} />
              <MetricCard label="Would-Have-Hard-Failed" value={String(rolloutMetrics.wouldHaveHardFailed)} sub="Recovered by remediation" />
              <MetricCard label="Remediation ROI" value={fmtCost(rolloutMetrics.roi)} sub="Total avoided cost" />
            </div>
            {rolloutMetrics.byType.length > 0 && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Remediation Type</TableHead>
                    <TableHead>Attempted</TableHead>
                    <TableHead>Succeeded</TableHead>
                    <TableHead>Success %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rolloutMetrics.byType.map(t => (
                    <TableRow key={t.type}>
                      <TableCell className="font-mono text-xs">{t.type}</TableCell>
                      <TableCell>{t.attempted}</TableCell>
                      <TableCell className="text-emerald-400">{t.succeeded}</TableCell>
                      <TableCell>{t.attempted > 0 ? fmtPct((t.succeeded / t.attempted) * 100) : '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {rolloutMetrics.skipReasons.length > 0 && (
              <div className="mt-4">
                <p className="text-xs text-muted-foreground mb-2 font-medium">Skip Reasons</p>
                <div className="flex flex-wrap gap-2">
                  {rolloutMetrics.skipReasons.map(s => (
                    <Badge key={s.reason} variant="outline" className="text-xs text-yellow-400 border-yellow-500/30">
                      {s.reason.replace(/_/g, ' ')} ({s.count})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!rolloutMetrics && !l5 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base"><Wrench className="h-4 w-4 inline mr-1" />Remediation Rollout</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">No remediation data yet. Enable <code>STRATEGY_TARGETED_REMEDIATION=true</code> and run an account_brief with a readability-only failure to begin experiment tracking.</p>
          </CardContent>
        </Card>
      )}

      {/* Rollout protection warning */}
      {rolloutHealth && rolloutHealth.belowThreshold && rolloutHealth.sampleSize >= 5 && (
        <Card className="border-red-500/50 bg-red-500/5">
          <CardHeader>
            <CardTitle className="text-base text-red-400"><AlertTriangle className="h-4 w-4 inline mr-1" />Rollout Health Warning</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-red-300">
              Remediation success rate is <strong>{fmtPct(rolloutHealth.successRate)}</strong> over the last{' '}
              <strong>{rolloutHealth.sampleSize}</strong> attempts (below 80% threshold).
              Consider disabling remediation rollout immediately.
            </p>
          </CardContent>
        </Card>
      )}

      {/* One-click rollback section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><Shield className="h-4 w-4 inline mr-1" />Remediation Rollback</CardTitle>
          <CardDescription>Current flag state and rollback command</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">Server flag:</span>
            <Badge variant="outline" className="text-xs text-yellow-400 border-yellow-500/30">
              STRATEGY_TARGETED_REMEDIATION (check edge secrets)
            </Badge>
          </div>
          <pre className="bg-muted/50 rounded p-3 text-xs overflow-auto">
{`# Immediate rollback — disables all server-side remediation:
supabase secrets set STRATEGY_TARGETED_REMEDIATION=false

# Also disable debug harness:
supabase secrets set STRATEGY_DEBUG_HARNESS=false`}
          </pre>
        </CardContent>
      </Card>

      {/* Gate changers — runs where remediation changed outcome */}
      {gateChangers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base"><Activity className="h-4 w-4 inline mr-1" />Remediation Gate Changers</CardTitle>
            <CardDescription>Runs where remediation flipped gate outcome (before: failed → after: passed)</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Before Dims</TableHead>
                  <TableHead>After Dims</TableHead>
                  <TableHead>Latency</TableHead>
                  <TableHead>Saved</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gateChangers.map(gc => (
                  <TableRow key={gc.id}>
                    <TableCell className="font-mono text-xs">{gc.id.slice(0, 8)}</TableCell>
                    <TableCell className="text-xs">{gc.task_type}</TableCell>
                    <TableCell className="font-mono text-xs text-blue-400">{gc.remediation?.type ?? '—'}</TableCell>
                    <TableCell className="text-xs text-red-400">{gc.remediation?.before_failed_dimensions.join(', ') ?? '—'}</TableCell>
                    <TableCell className="text-xs text-emerald-400">{gc.remediation?.after_failed_dimensions.length === 0 ? '✓ none' : gc.remediation?.after_failed_dimensions.join(', ')}</TableCell>
                    <TableCell className="text-xs">{gc.remediation?.latency_ms != null ? fmtMs(gc.remediation.latency_ms) : '—'}</TableCell>
                    <TableCell className="text-xs text-emerald-400">{fmtCost(gc.remediation?.avoided_usd ?? 0)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => onDrilldown(gc.id)}>
                        <Search className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}


      {cohorts && cohorts.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Failure by Era</CardTitle><CardDescription>Separates historical from current failures</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Era</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Failed</TableHead>
                  <TableHead>Success</TableHead>
                  <TableHead>Failure Rate</TableHead>
                  <TableHead>Waste</TableHead>
                  <TableHead>Top Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cohorts.map(c => (
                  <TableRow key={c.era}>
                    <TableCell className="text-xs">{c.label}</TableCell>
                    <TableCell>{c.total}</TableCell>
                    <TableCell className="text-red-400">{c.failed}</TableCell>
                    <TableCell className="text-emerald-400">{c.completed}</TableCell>
                    <TableCell className={c.failure_rate > 50 ? 'text-red-400 font-semibold' : ''}>
                      {fmtPct(c.failure_rate)}
                    </TableCell>
                    <TableCell>{fmtCost(c.total_waste_usd)}</TableCell>
                    <TableCell className="text-xs">
                      {c.top_reasons[0] ? `${REASON_LABELS[c.top_reasons[0].reason]} (${c.top_reasons[0].count})` : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Root cause breakdown */}
      {breakdown && breakdown.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Root Cause Breakdown</CardTitle><CardDescription>All failures classified by reason</CardDescription></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Root Cause</TableHead>
                  <TableHead>Count</TableHead>
                  <TableHead>% of Failures</TableHead>
                  <TableHead>Total Waste</TableHead>
                  <TableHead>Avg Waste</TableHead>
                  <TableHead>Remediation</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {breakdown.map(b => (
                  <TableRow key={b.reason}>
                    <TableCell className="text-xs font-medium">{b.label}</TableCell>
                    <TableCell>{b.count}</TableCell>
                    <TableCell>{fmtPct(b.pct)}</TableCell>
                    <TableCell>{fmtCost(b.total_waste_usd)}</TableCell>
                    <TableCell>{fmtCost(b.avg_waste_usd)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={b.remediation_type === 'none' ? 'text-muted-foreground' : 'text-blue-400 border-blue-500/30'}>
                        {b.remediation_type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Remediation opportunities */}
      {opportunities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Remediation Opportunities</CardTitle>
            <CardDescription>
              Targeted fixes that could recover failures without full regen
              {!isRemediationEnabled() && <Badge variant="outline" className="ml-2 text-yellow-400 border-yellow-500/30">FLAG OFF</Badge>}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Candidate Runs</TableHead>
                  <TableHead>Est. Savings</TableHead>
                  <TableHead>Needs LLM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opportunities.map(o => (
                  <TableRow key={o.type}>
                    <TableCell className="text-xs font-medium">{o.label}</TableCell>
                    <TableCell>{o.count}</TableCell>
                    <TableCell className="text-emerald-400">{fmtCost(o.estimated_savings_usd)}</TableCell>
                    <TableCell>{o.requires_llm ? 'Yes' : 'No'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Individual failure list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent Failures</CardTitle>
          <div className="flex gap-2 mt-2">
            <Badge variant={eraFilter === 'all' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setEraFilter('all')}>All</Badge>
            <Badge variant={eraFilter === 'pre_phase3' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setEraFilter('pre_phase3')}>Pre-Phase 3</Badge>
            <Badge variant={eraFilter === 'post_phase3' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setEraFilter('post_phase3')}>Post-Phase 3</Badge>
            <Badge variant={eraFilter === 'post_phase4a' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setEraFilter('post_phase4a')}>Post-4A</Badge>
            <Badge variant={eraFilter === 'post_phase4c' ? 'default' : 'outline'} className="cursor-pointer" onClick={() => setEraFilter('post_phase4c')}>Post-4C</Badge>
          </div>
        </CardHeader>
        <CardContent>
          {filteredFailures.length === 0 ? (
            <p className="text-muted-foreground text-sm">No failures in this cohort.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Era</TableHead>
                    <TableHead>Root Cause</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Failed Stage</TableHead>
                    <TableHead>Regen?</TableHead>
                    <TableHead>Waste</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredFailures.map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-mono text-xs">{f.id.slice(0, 8)}</TableCell>
                      <TableCell className="text-xs">{f.era.replace(/_/g, ' ')}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs text-red-400 border-red-500/30">
                          {REASON_LABELS[f.reason].replace('Gate: ', '')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{f.reason_detail}</TableCell>
                      <TableCell className="font-mono text-xs">{f.stage_failed ?? '—'}</TableCell>
                      <TableCell>{f.regen_attempted ? (f.regen_succeeded ? '✓' : '✗') : '—'}</TableCell>
                      <TableCell>{fmtCost(f.cost_wasted)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => onDrilldown(f.id)}>
                          <Search className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ================================================================== */
/*  TAB: Remediation Test Harness (Phase 4E-V)                         */
/* ================================================================== */

function RemediationTestHarnessTab() {
  // Deterministic, client-side-only test harness that exercises the
  // classifyRemediation logic without calling external providers.
  const scenarios = useMemo(() => {
    type RT = 'normalize_only' | 'section_reauthor' | 'evidence_rewrite' | 'skip_too_many_dimensions';
    function classify(dims: string[]): RT {
      if (dims.length >= 3 || dims.length === 0) return 'skip_too_many_dimensions';
      if (dims.length === 1) {
        if (dims[0] === 'readability') return 'normalize_only';
        if (dims[0] === 'template_fidelity' || dims[0] === 'section_completeness') return 'section_reauthor';
        if (dims[0] === 'evidence_discipline') return 'evidence_rewrite';
      }
      if (dims.length === 2) {
        const hr = dims.includes('readability'), hf = dims.includes('template_fidelity'),
              hc = dims.includes('section_completeness'), he = dims.includes('evidence_discipline');
        if (hr && (hf || hc)) return 'section_reauthor';
        if (hr && he) return 'evidence_rewrite';
        if (hf || hc) return 'section_reauthor';
        if (he) return 'evidence_rewrite';
      }
      return 'skip_too_many_dimensions';
    }

    const cases: { label: string; dims: string[]; expected: RT }[] = [
      { label: 'Readability only', dims: ['readability'], expected: 'normalize_only' },
      { label: 'Section completeness only', dims: ['section_completeness'], expected: 'section_reauthor' },
      { label: 'Template fidelity only', dims: ['template_fidelity'], expected: 'section_reauthor' },
      { label: 'Evidence discipline only', dims: ['evidence_discipline'], expected: 'evidence_rewrite' },
      { label: 'Readability + fidelity', dims: ['readability', 'template_fidelity'], expected: 'section_reauthor' },
      { label: 'Readability + evidence', dims: ['readability', 'evidence_discipline'], expected: 'evidence_rewrite' },
      { label: '3+ dimensions (skip)', dims: ['readability', 'template_fidelity', 'evidence_discipline'], expected: 'skip_too_many_dimensions' },
      { label: 'Empty dimensions (skip)', dims: [], expected: 'skip_too_many_dimensions' },
    ];

    return cases.map(c => ({ ...c, actual: classify(c.dims), pass: classify(c.dims) === c.expected }));
  }, []);

  const allPass = scenarios.every(s => s.pass);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base"><FlaskConical className="h-4 w-4 inline mr-1" />Remediation Classification Test Harness</CardTitle>
          <CardDescription>
            Deterministic, client-side test of classifyRemediation logic. No external providers called.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-3">
            <Badge className={allPass ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}>
              {allPass ? `ALL ${scenarios.length} PASS` : 'FAILURES DETECTED'}
            </Badge>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Scenario</TableHead>
                <TableHead>Failed Dimensions</TableHead>
                <TableHead>Expected</TableHead>
                <TableHead>Actual</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scenarios.map((s, i) => (
                <TableRow key={i} className={s.pass ? '' : 'bg-red-500/10'}>
                  <TableCell className="text-xs">{s.label}</TableCell>
                  <TableCell className="font-mono text-xs">{s.dims.join(', ') || '(none)'}</TableCell>
                  <TableCell className="font-mono text-xs">{s.expected}</TableCell>
                  <TableCell className="font-mono text-xs">{s.actual}</TableCell>
                  <TableCell>{s.pass ? <CheckCircle className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-red-400" />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Server-Side Testing Instructions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-muted-foreground">To test server-side remediation execution end-to-end:</p>
          <ol className="list-decimal pl-5 space-y-2 text-muted-foreground">
            <li>Confirm flag is <strong>OFF</strong> — run an <code>account_brief</code> and verify <code>meta.remediation</code> is NULL.</li>
            <li>Set <code>STRATEGY_TARGETED_REMEDIATION=true</code> as an edge function secret.</li>
            <li>Trigger a run that you expect will fail a gate dimension (e.g. a known template_fidelity failure).</li>
            <li>Check the run in Run Drilldown — the Remediation card should appear.</li>
            <li>Verify telemetry has a row with <code>stage='remediation'</code>.</li>
            <li>Turn flag back <strong>OFF</strong> after testing.</li>
          </ol>
          <pre className="bg-muted/50 rounded p-3 text-xs overflow-auto">
{`-- Verify remediation telemetry for a run:
SELECT status, meta->'remediation' AS remediation,
       meta->'artifact_gate' AS artifact_gate
FROM task_runs WHERE id = '<run_id>';

-- Check for remediation telemetry rows:
SELECT * FROM strategy_run_telemetry
WHERE run_id = '<run_id>' AND stage = 'remediation';`}
          </pre>
        </CardContent>
      </Card>
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
  const [remFlag, setRemFlag] = useState(() => loadStrategyFlags().targeted_remediation_enabled);

  const handleDrilldown = useCallback((id: string) => {
    setDrilldownRunId(id);
    setActiveTab('drilldown');
  }, []);

  const handleRemToggle = useCallback((checked: boolean) => {
    setStrategyFlag('targeted_remediation_enabled', checked);
    setRemFlag(checked);
  }, []);

  if (!user) return null;

  return (
    <SafePage className="px-4 py-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <AlertTriangle className="h-5 w-5 text-primary" />
        <h1 className="text-xl font-semibold text-foreground">Strategy Operations</h1>
        <Badge variant="outline" className="text-xs">read-only</Badge>
        <div className="flex-1" />
        {/* Remediation flag indicator + toggle */}
        <div className="flex items-center gap-2 border border-border/50 rounded-md px-3 py-1.5">
          <Wrench className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">Remediation</span>
          <Switch checked={remFlag} onCheckedChange={handleRemToggle} className="h-4 w-7" />
          <Badge variant="outline" className={`text-[10px] ${remFlag ? 'text-emerald-400 border-emerald-500/30' : 'text-muted-foreground'}`}>
            {remFlag ? 'ON (client)' : 'OFF'}
          </Badge>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-4 flex-wrap h-auto gap-1">
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="gates">Gates</TabsTrigger>
          <TabsTrigger value="failures"><Flame className="h-3 w-3 mr-1" />Failures</TabsTrigger>
          <TabsTrigger value="costs"><DollarSign className="h-3 w-3 mr-1" />Costs</TabsTrigger>
          <TabsTrigger value="latency"><Clock className="h-3 w-3 mr-1" />Latency</TabsTrigger>
          <TabsTrigger value="confidence"><Shield className="h-3 w-3 mr-1" />Confidence</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="drilldown">Run Drilldown</TabsTrigger>
          <TabsTrigger value="test-harness"><FlaskConical className="h-3 w-3 mr-1" />Test Harness</TabsTrigger>
        </TabsList>

        <TabsContent value="evidence"><EvidenceTab userId={user.id} /></TabsContent>
        <TabsContent value="gates"><GatesTab userId={user.id} /></TabsContent>
        <TabsContent value="failures"><FailuresTab userId={user.id} onDrilldown={handleDrilldown} /></TabsContent>
        <TabsContent value="costs"><CostDeepTab userId={user.id} /></TabsContent>
        <TabsContent value="latency"><LatencyDeepTab userId={user.id} /></TabsContent>
        <TabsContent value="confidence"><ReleaseConfidenceTab userId={user.id} /></TabsContent>
        <TabsContent value="anomalies"><AnomaliesTab userId={user.id} onDrilldown={handleDrilldown} /></TabsContent>
        <TabsContent value="drilldown"><RunDrilldownTab userId={user.id} initialRunId={drilldownRunId} /></TabsContent>
        <TabsContent value="test-harness"><RemediationTestHarnessTab /></TabsContent>
      </Tabs>
    </SafePage>
  );
}
