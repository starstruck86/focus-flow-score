/**
 * /observability — Internal read-only debug surface for inspecting
 * job lifecycle, enrichment events, and edge function invocation patterns.
 *
 * Phase 1: Observability Only. No destructive controls.
 *
 * IMPORTANT: Telemetry shown here is session-local, in-memory,
 * non-persistent, and best-effort. Data is lost on page refresh.
 *
 * Access: gated to approved users only via useApprovalCheck.
 */
import { useState, useMemo } from 'react';
import { useBackgroundJobs, selectActiveJobs, selectFailedJobs, formatElapsed, getJobPercent } from '@/store/useBackgroundJobs';
import { getRecentEvents, getTelemetrySummary, getEventsByPrefix, clearTelemetryEvents, type TelemetryEvent } from '@/lib/observability/telemetry';
import { findStaleJobs, type StaleJob } from '@/lib/admin/staleJobQuery';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, AlertTriangle, CheckCircle, RefreshCw, Trash2, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { useApprovalCheck } from '@/hooks/useApprovalCheck';

function StatusBadge({ status }: { status: string }) {
  const variant = status === 'running' ? 'default' :
    status === 'completed' ? 'secondary' :
    status === 'failed' ? 'destructive' :
    status === 'queued' ? 'outline' : 'secondary';
  return <Badge variant={variant as any} className="text-xs">{status}</Badge>;
}

function EventRow({ event }: { event: TelemetryEvent }) {
  const time = new Date(event.ts).toLocaleTimeString();
  return (
    <div className="flex items-start gap-2 py-1.5 border-b border-border/50 text-xs font-mono">
      <span className="text-muted-foreground w-20 shrink-0">{time}</span>
      <Badge variant="outline" className="text-[10px] shrink-0">{event.type}</Badge>
      <span className="text-foreground/80 truncate">
        {JSON.stringify(event.data).slice(0, 200)}
      </span>
    </div>
  );
}

function JobsPanel() {
  const allJobs = useBackgroundJobs(s => s.jobs);
  const activeJobs = useBackgroundJobs(selectActiveJobs);
  const failedJobs = useBackgroundJobs(selectFailedJobs);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{allJobs.length}</div>
          <div className="text-xs text-muted-foreground">Total Jobs</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold text-primary">{activeJobs.length}</div>
          <div className="text-xs text-muted-foreground">Active</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold text-destructive">{failedJobs.length}</div>
          <div className="text-xs text-muted-foreground">Failed</div>
        </CardContent></Card>
        <Card><CardContent className="p-3 text-center">
          <div className="text-2xl font-bold text-foreground">{allJobs.filter(j => j.status === 'completed').length}</div>
          <div className="text-xs text-muted-foreground">Completed</div>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">All Jobs (in-memory, session-local)</CardTitle></CardHeader>
        <CardContent className="max-h-96 overflow-y-auto">
          {allJobs.length === 0 && <p className="text-sm text-muted-foreground">No jobs in store</p>}
          {allJobs.map(job => (
            <div key={job.id} className="flex items-center gap-2 py-2 border-b border-border/50 text-xs">
              <StatusBadge status={job.status} />
              <span className="font-mono text-[10px] text-muted-foreground">{job.id.slice(0, 8)}</span>
              <Badge variant="outline" className="text-[10px]">{job.type}</Badge>
              <span className="truncate flex-1">{job.title}</span>
              <span className="text-muted-foreground">{getJobPercent(job) != null ? `${getJobPercent(job)}%` : ''}</span>
              <span className="text-muted-foreground">{formatElapsed(job.createdAt)}</span>
              {job.error && <AlertTriangle className="h-3 w-3 text-destructive" />}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function StaleJobsPanel() {
  const { data: staleJobs, isLoading, refetch } = useQuery({
    queryKey: ['stale-jobs-debug'],
    queryFn: () => findStaleJobs(30),
    refetchInterval: 30_000,
  });

  return (
    <Card>
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <CardTitle className="text-sm flex items-center gap-1">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          Potentially Stuck Jobs (DB query, &gt;30min stale)
        </CardTitle>
        <Button variant="ghost" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3 w-3" />
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-xs text-muted-foreground">Querying…</p>}
        {staleJobs && staleJobs.length === 0 && (
          <div className="flex items-center gap-1 text-xs text-primary">
            <CheckCircle className="h-3 w-3" /> No stale jobs found
          </div>
        )}
        {staleJobs && staleJobs.length > 0 && (
          <div className="space-y-1">
            {staleJobs.map((sj: StaleJob) => (
              <div key={sj.id} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
                <span className="font-mono text-[10px]">{sj.id.slice(0, 8)}</span>
                <Badge variant="outline" className="text-[10px]">{sj.status}</Badge>
                <span className="truncate flex-1">{sj.title}</span>
                <span className="text-destructive">{sj.stale_minutes}m stale</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function TelemetryPanel() {
  const [events, setEvents] = useState<TelemetryEvent[]>(() => getRecentEvents(100));
  const [filter, setFilter] = useState('');
  const summary = useMemo(() => getTelemetrySummary(), [events]);

  const refresh = () => setEvents(getRecentEvents(100));
  const filtered = filter ? events.filter(e => e.type.startsWith(filter)) : events;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="h-3 w-3 mr-1" /> Refresh
        </Button>
        <Button variant="ghost" size="sm" onClick={() => { clearTelemetryEvents(); refresh(); }}>
          <Trash2 className="h-3 w-3 mr-1" /> Clear
        </Button>
        <Button variant="ghost" size="sm" onClick={() => {
          const data = JSON.stringify(getRecentEvents(500), null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url; a.download = `telemetry-${Date.now()}.json`; a.click();
          URL.revokeObjectURL(url);
        }}>
          <Download className="h-3 w-3 mr-1" /> Export
        </Button>
        {['', 'job:', 'enrich:', 'fn:', 'state:'].map(prefix => (
          <Button
            key={prefix || 'all'}
            variant={filter === prefix ? 'default' : 'outline'}
            size="sm"
            className="text-xs h-7"
            onClick={() => { setFilter(prefix); refresh(); }}
          >
            {prefix || 'All'}
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Event Summary (session-local, best-effort)</CardTitle></CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-2">
            {Object.entries(summary).map(([type, count]) => (
              <Badge key={type} variant="outline" className="text-[10px]">{type}: {count}</Badge>
            ))}
            {Object.keys(summary).length === 0 && <span className="text-xs text-muted-foreground">No events yet</span>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Events ({filtered.length})</CardTitle></CardHeader>
        <CardContent className="max-h-96 overflow-y-auto">
          {filtered.length === 0 && <p className="text-xs text-muted-foreground">No events</p>}
          {filtered.slice().reverse().map((event, i) => (
            <EventRow key={`${event.ts}-${i}`} event={event} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function FnInvocationPanel() {
  const [events, setEvents] = useState<TelemetryEvent[]>(() => getEventsByPrefix('fn:'));
  const refresh = () => setEvents(getEventsByPrefix('fn:'));

  const fnSummary = useMemo(() => {
    const map: Record<string, { success: number; error: number; timeout: number }> = {};
    for (const e of events) {
      const name = String(e.data.functionName ?? 'unknown');
      if (!map[name]) map[name] = { success: 0, error: 0, timeout: 0 };
      const outcome = String(e.data.outcome ?? e.type);
      if (outcome.includes('success') || outcome.includes('result')) map[name].success++;
      else if (outcome.includes('timeout')) map[name].timeout++;
      else map[name].error++;
    }
    return map;
  }, [events]);

  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={refresh}>
        <RefreshCw className="h-3 w-3 mr-1" /> Refresh
      </Button>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Function Invocation Summary</CardTitle></CardHeader>
        <CardContent>
          {Object.keys(fnSummary).length === 0 && <p className="text-xs text-muted-foreground">No invocations recorded yet</p>}
          {Object.entries(fnSummary).map(([name, counts]) => (
            <div key={name} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
              <span className="font-mono flex-1">{name}</span>
              <Badge variant="secondary" className="text-[10px]">✓ {counts.success}</Badge>
              {counts.error > 0 && <Badge variant="destructive" className="text-[10px]">✗ {counts.error}</Badge>}
              {counts.timeout > 0 && <Badge variant="outline" className="text-[10px]">⏱ {counts.timeout}</Badge>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Recent Invocations</CardTitle></CardHeader>
        <CardContent className="max-h-64 overflow-y-auto">
          {events.slice(-30).reverse().map((event, i) => (
            <EventRow key={`${event.ts}-${i}`} event={event} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

export default function ObservabilityDashboard() {
  const approvalStatus = useApprovalCheck();

  // Gate: only approved users can access
  if (approvalStatus === 'loading') {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Loading…</p>
        </div>
      </Layout>
    );
  }

  if (approvalStatus === 'denied') {
    return (
      <Layout>
        <div className="min-h-screen flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Access denied.</p>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-5xl mx-auto p-4 space-y-4 pb-24">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold text-foreground">Observability Dashboard</h1>
          <Badge variant="outline" className="text-[10px]">Phase 1 — Read Only</Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Internal debug surface. All data is session-local, in-memory, and best-effort — lost on refresh.
          {import.meta.env.DEV && <> Console: <code className="bg-muted px-1 rounded">window.__telemetry</code></>}
        </p>

        <Tabs defaultValue="jobs" className="w-full">
          <TabsList>
            <TabsTrigger value="jobs">Jobs</TabsTrigger>
            <TabsTrigger value="stale">Stale Detection</TabsTrigger>
            <TabsTrigger value="telemetry">Telemetry Stream</TabsTrigger>
            <TabsTrigger value="functions">Function Audit</TabsTrigger>
          </TabsList>

          <TabsContent value="jobs"><JobsPanel /></TabsContent>
          <TabsContent value="stale"><StaleJobsPanel /></TabsContent>
          <TabsContent value="telemetry"><TelemetryPanel /></TabsContent>
          <TabsContent value="functions"><FnInvocationPanel /></TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}
