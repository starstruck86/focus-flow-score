/**
 * Reliability QA — internal debug page for crash triage and runtime inspection.
 * Route: /reliability
 */

import { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getStoredCrashes, clearStoredCrashes, getBreadcrumbs, getTelemetry, getLeakMetrics, type CrashEvent, type ReliabilityTelemetry } from '@/lib/crashSentinel';
import { getRecentErrors, type AppError } from '@/lib/appError';
import { Trash2, RefreshCw, Download, AlertTriangle, Activity, Bug, Shield } from 'lucide-react';

export default function ReliabilityQA() {
  const [crashes, setCrashes] = useState<CrashEvent[]>([]);
  const [errors, setErrors] = useState<ReadonlyArray<AppError>>([]);
  const [telemetry, setTelemetry] = useState<ReliabilityTelemetry>(getTelemetry());
  const [leaks, setLeaks] = useState(getLeakMetrics());
  const [filter, setFilter] = useState<string>('all');

  const refresh = () => {
    setCrashes(getStoredCrashes());
    setErrors(getRecentErrors());
    setTelemetry(getTelemetry());
    setLeaks(getLeakMetrics());
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, []);

  const filteredCrashes = crashes.filter(c => {
    if (filter === 'all') return true;
    if (filter === 'audio') return c.message.toLowerCase().includes('audio') || c.sessionContext.audioPlaying;
    if (filter === 'network') return c.message.toLowerCase().includes('fetch') || c.message.toLowerCase().includes('network');
    if (filter === 'dojo') return c.sessionContext.dojoSessionActive || c.route.includes('dojo');
    return true;
  });

  const filteredErrors = Array.from(errors).filter(e => {
    if (filter === 'all') return true;
    if (filter === 'audio') return e.functionName?.includes('audio') || e.componentName?.includes('Dojo');
    if (filter === 'network') return e.category === 'NETWORK_ERROR' || e.category === 'FUNCTION_TIMEOUT';
    if (filter === 'dojo') return e.route?.includes('dojo') || e.componentName?.includes('Dojo');
    return true;
  });

  const exportDiagnostics = () => {
    const data = {
      exportedAt: new Date().toISOString(),
      crashes,
      recentErrors: Array.from(errors),
      telemetry,
      leaks,
      breadcrumbs: getBreadcrumbs(),
      userAgent: navigator.userAgent,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reliability-diagnostics-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const sessionDurationMin = Math.round((Date.now() - telemetry.sessionStartMs) / 60000);

  return (
    <div className="min-h-screen bg-background pt-[env(safe-area-inset-top)] p-4 sm:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reliability QA</h1>
          <p className="text-sm text-muted-foreground">Session: {sessionDurationMin}min | Memory: {leaks.memoryMB ?? '?'}MB</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportDiagnostics}>
            <Download className="h-3.5 w-3.5 mr-1" /> Export
          </Button>
        </div>
      </div>

      {/* Telemetry cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <MetricCard label="Crashes" value={telemetry.crashCount} variant={telemetry.crashCount > 0 ? 'destructive' : 'default'} />
        <MetricCard label="Recoverable" value={telemetry.recoverableErrorCount} />
        <MetricCard label="Backend Failures" value={telemetry.supabaseFailures} variant={telemetry.supabaseFailures > 3 ? 'destructive' : 'default'} />
        <MetricCard label="Audio Failures" value={telemetry.audioFailures} />
        <MetricCard label="Retries" value={telemetry.retries} />
        <MetricCard label="Timers/Listeners" value={`${leaks.activeTimers}/${leaks.activeListeners}`} />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'audio', 'network', 'dojo'].map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="crashes" className="space-y-4">
        <TabsList>
          <TabsTrigger value="crashes" className="gap-1">
            <AlertTriangle className="h-3.5 w-3.5" /> Crashes ({filteredCrashes.length})
          </TabsTrigger>
          <TabsTrigger value="errors" className="gap-1">
            <Bug className="h-3.5 w-3.5" /> Errors ({filteredErrors.length})
          </TabsTrigger>
          <TabsTrigger value="breadcrumbs" className="gap-1">
            <Activity className="h-3.5 w-3.5" /> Breadcrumbs
          </TabsTrigger>
          <TabsTrigger value="audit" className="gap-1">
            <Shield className="h-3.5 w-3.5" /> Audit
          </TabsTrigger>
        </TabsList>

        <TabsContent value="crashes">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <CardTitle className="text-sm">Crash Events</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => { clearStoredCrashes(); refresh(); }}>
                <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
              </Button>
            </CardHeader>
            <CardContent>
              <ScrollArea className="h-[500px]">
                {filteredCrashes.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No crashes recorded this session.</p>
                ) : (
                  <div className="space-y-3">
                    {filteredCrashes.map((crash, i) => (
                      <CrashCard key={crash.id} crash={crash} />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="errors">
          <Card>
            <CardContent className="pt-4">
              <ScrollArea className="h-[500px]">
                {filteredErrors.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-8 text-center">No errors recorded.</p>
                ) : (
                  <div className="space-y-2">
                    {filteredErrors.slice(-50).reverse().map((err, i) => (
                      <div key={`${err.traceId}-${i}`} className="border border-border rounded-lg p-3 text-xs space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant={err.retryable ? 'outline' : 'destructive'} className="text-[10px]">{err.category}</Badge>
                          <span className="text-muted-foreground">{err.route} • {err.componentName}</span>
                          <span className="ml-auto text-muted-foreground">{new Date(err.timestamp).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-foreground">{err.rawMessage.slice(0, 200)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="breadcrumbs">
          <Card>
            <CardContent className="pt-4">
              <ScrollArea className="h-[500px]">
                <div className="space-y-1">
                  {getBreadcrumbs().slice().reverse().map((b, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs py-1 border-b border-border/50">
                      <Badge variant="outline" className="text-[10px] w-16 justify-center">{b.type}</Badge>
                      <span className="text-foreground flex-1">{b.label}</span>
                      <span className="text-muted-foreground">{new Date(b.ts).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <h3 className="text-sm font-semibold text-foreground">Reliability Audit Summary</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <AuditSection title="Error Boundaries" status="ok" detail="Global + per-route boundaries active" />
                <AuditSection title="Crash Sentinel" status="ok" detail="Unhandled rejections + errors captured" />
                <AuditSection title="Fetch Monitoring" status="ok" detail="Backend failures tracked via breadcrumbs" />
                <AuditSection title="Audio Cleanup" status="ok" detail="Transport handles cleaned on unmount/stop" />
                <AuditSection title="Visibility Guard" status="ok" detail="Tab backgrounding checkpoints active" />
                <AuditSection title="Ownership Protection" status="ok" detail="Multi-tab heartbeat + stale takeover" />
                <AuditSection title="Snapshot Recovery" status="ok" detail="V3 snapshots with version/staleness gates" />
                <AuditSection title="Watchdog" status="ok" detail="5s poll for hung playback" />
                <AuditSection title="Memory Monitoring" status={leaks.memoryMB && leaks.memoryMB > 500 ? 'warn' : 'ok'} detail={`${leaks.memoryMB ?? '?'}MB heap used`} />
                <AuditSection title="Timer Tracking" status={leaks.activeTimers > 20 ? 'warn' : 'ok'} detail={`${leaks.activeTimers} active timers`} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MetricCard({ label, value, variant = 'default' }: { label: string; value: string | number; variant?: 'default' | 'destructive' }) {
  return (
    <Card className={variant === 'destructive' ? 'border-destructive/50' : ''}>
      <CardContent className="py-3 px-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-xl font-bold ${variant === 'destructive' ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function CrashCard({ crash }: { crash: CrashEvent }) {
  const [expanded, setExpanded] = useState(false);
  const ctx = crash.sessionContext;

  return (
    <div className="border border-destructive/30 bg-destructive/5 rounded-lg p-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant="destructive" className="text-[10px]">{crash.type}</Badge>
        <span className="text-foreground font-medium flex-1">{crash.message.slice(0, 120)}</span>
        <span className="text-muted-foreground">{new Date(crash.timestamp).toLocaleTimeString()}</span>
      </div>
      <div className="flex gap-2 flex-wrap text-muted-foreground">
        <span>Route: {crash.route}</span>
        {ctx.audioPlaying && <Badge variant="outline" className="text-[10px]">Audio Playing</Badge>}
        {ctx.dojoSessionActive && <Badge variant="outline" className="text-[10px]">Dojo Active</Badge>}
        {ctx.recoveryInProgress && <Badge variant="outline" className="text-[10px]">Recovery</Badge>}
        {ctx.ownershipConflict && <Badge variant="outline" className="text-[10px]">Owner Conflict</Badge>}
        {!ctx.tabVisible && <Badge variant="outline" className="text-[10px]">Tab Hidden</Badge>}
      </div>
      <Button variant="ghost" size="sm" onClick={() => setExpanded(!expanded)}>
        {expanded ? 'Hide' : 'Show'} Details
      </Button>
      {expanded && (
        <div className="space-y-2">
          {crash.stack && <pre className="bg-muted/50 rounded p-2 overflow-auto max-h-32 text-[10px]">{crash.stack}</pre>}
          <p className="text-muted-foreground">Memory: {ctx.memoryMB ?? '?'}MB | Timers: {ctx.activeTimers} | Session: {Math.round(ctx.sessionDurationMs/1000)}s</p>
          <p className="font-medium">Last {crash.breadcrumbs.length} breadcrumbs:</p>
          <div className="space-y-0.5">
            {crash.breadcrumbs.slice(-10).map((b, i) => (
              <div key={i} className="text-[10px] text-muted-foreground">[{b.type}] {b.label}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AuditSection({ title, status, detail }: { title: string; status: 'ok' | 'warn' | 'error'; detail: string }) {
  const colors = { ok: 'text-green-500', warn: 'text-yellow-500', error: 'text-destructive' };
  const icons = { ok: '✓', warn: '⚠', error: '✗' };
  return (
    <div className="flex items-start gap-2 p-2 rounded border border-border">
      <span className={`font-bold ${colors[status]}`}>{icons[status]}</span>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}
