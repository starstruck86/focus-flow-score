/**
 * /ops — Hidden diagnostics page for debugging failures.
 * Shows recent AppErrors with trace IDs, categories, and metadata.
 * Also shows current environment info and connection status.
 */

import { useState, useEffect, useSyncExternalStore, useMemo } from 'react';
import { Layout } from '@/components/Layout';
import { getRecentErrors, subscribeErrors, clearErrors, type AppError } from '@/lib/appError';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, RefreshCw, Copy, ChevronDown, ChevronUp, Activity, Shield, Wifi, AlertTriangle, Database, Layers, Search, FileText, X, FlaskConical } from 'lucide-react';
import { useAllActiveJobs, useRetryJob } from '@/hooks/useResourceJobs';
import { PIPELINE_STEPS } from '@/lib/resourcePipeline';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { EnrichmentValidator } from '@/components/EnrichmentValidator';

function useErrorStore() {
  return useSyncExternalStore(
    subscribeErrors,
    () => getRecentErrors(),
    () => getRecentErrors(),
  );
}

const CATEGORY_COLORS: Record<string, string> = {
  AUTH_ERROR: 'bg-red-500/20 text-red-400 border-red-500/30',
  NETWORK_ERROR: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  FUNCTION_TIMEOUT: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  FUNCTION_404: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
  FUNCTION_401: 'bg-red-500/20 text-red-400 border-red-500/30',
  DB_WRITE_FAILED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  RATE_LIMITED: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  VALIDATION_ERROR: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  MODEL_RESPONSE_INVALID: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  UNKNOWN: 'bg-muted text-muted-foreground border-border',
};

function formatDebugReport(err: AppError): string {
  return [
    `=== Debug Report ===`,
    `Trace ID: ${err.traceId}`,
    `Category: ${err.category}`,
    `Source: ${err.source}`,
    `Message: ${err.message}`,
    err.rawMessage ? `Raw: ${err.rawMessage}` : null,
    err.code ? `Code: ${err.code}` : null,
    err.functionName ? `Function: ${err.functionName}` : null,
    err.componentName ? `Component: ${err.componentName}` : null,
    err.route ? `Route: ${err.route}` : null,
    `Retryable: ${err.retryable}`,
    `Time: ${new Date(err.timestamp).toISOString()}`,
    Object.keys(err.metadata || {}).length > 0 ? `Metadata: ${JSON.stringify(err.metadata, null, 2)}` : null,
  ].filter(Boolean).join('\n');
}

function ErrorDetailView({ err, onClose }: { err: AppError; onClose: () => void }) {
  return (
    <Card data-testid="diag-error-detail">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Error Detail
          </CardTitle>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => {
              navigator.clipboard.writeText(formatDebugReport(err));
              toast.success('Debug report copied');
            }}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div><span className="text-muted-foreground">Trace ID:</span> <span className="font-mono">{err.traceId}</span></div>
          <div><span className="text-muted-foreground">Category:</span> <Badge variant="outline" className={cn('text-[10px] ml-1', CATEGORY_COLORS[err.category])}>{err.category}</Badge></div>
          <div><span className="text-muted-foreground">Source:</span> {err.source}</div>
          <div><span className="text-muted-foreground">Retryable:</span> {err.retryable ? '✅ Yes' : '❌ No'}</div>
          {err.functionName && <div><span className="text-muted-foreground">Function:</span> {err.functionName}</div>}
          {err.componentName && <div><span className="text-muted-foreground">Component:</span> {err.componentName}</div>}
          {err.route && <div><span className="text-muted-foreground">Route:</span> {err.route}</div>}
          {err.code && <div><span className="text-muted-foreground">Code:</span> {String(err.code)}</div>}
          <div className="col-span-2"><span className="text-muted-foreground">Time:</span> {new Date(err.timestamp).toLocaleString()}</div>
        </div>
        <div>
          <p className="text-xs text-muted-foreground mb-1">Message</p>
          <p className="text-sm bg-muted/50 rounded p-2">{err.message}</p>
        </div>
        {err.rawMessage && err.rawMessage !== err.message && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Raw message</p>
            <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 overflow-auto max-h-24">{err.rawMessage}</pre>
          </div>
        )}
        {Object.keys(err.metadata || {}).length > 0 && (
          <div>
            <p className="text-xs text-muted-foreground mb-1">Metadata</p>
            <pre className="text-[10px] font-mono bg-muted/50 rounded p-2 overflow-auto max-h-40">{JSON.stringify(err.metadata, null, 2)}</pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ErrorRow({ err, onSelect }: { err: AppError; onSelect: () => void }) {
  const age = Date.now() - err.timestamp;
  const ageStr = age < 60_000 ? `${Math.round(age / 1000)}s ago` : age < 3_600_000 ? `${Math.round(age / 60_000)}m ago` : `${Math.round(age / 3_600_000)}h ago`;

  return (
    <button
      className={cn('border rounded-lg p-3 space-y-1.5 w-full text-left transition-colors hover:border-primary/40', age < 30_000 ? 'border-destructive/40 bg-destructive/5' : 'border-border bg-card')}
      onClick={onSelect}
      data-testid="diag-error-row"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className={cn('text-[10px] font-mono', CATEGORY_COLORS[err.category] || CATEGORY_COLORS.UNKNOWN)}>
              {err.category}
            </Badge>
            {err.retryable && <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-400 border-emerald-500/30">retryable</Badge>}
            <span className="text-[10px] text-muted-foreground">{ageStr}</span>
          </div>
          <p className="text-sm text-foreground mt-1 break-words line-clamp-2">{err.message}</p>
          <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground font-mono">
            <span>trace: {err.traceId}</span>
            {err.functionName && <span>fn: {err.functionName}</span>}
          </div>
        </div>
      </div>
    </button>
  );
}

function JobsPanel() {
  const { data: jobs, isLoading } = useAllActiveJobs();
  const retryJob = useRetryJob();

  if (isLoading) return <div className="text-center py-8 text-muted-foreground text-sm">Loading jobs…</div>;
  if (!jobs || jobs.length === 0) return <div className="text-center py-12 text-muted-foreground text-sm" data-testid="diag-jobs-empty">No active or recent resource jobs.</div>;

  return (
    <div className="space-y-2" data-testid="diag-jobs-list">
      {jobs.map((job: any) => {
        const steps = (job.resource_job_steps || []).sort((a: any, b: any) => a.sequence - b.sequence);
        const completedCount = steps.filter((s: any) => s.status === 'completed').length;
        const failedStep = steps.find((s: any) => s.status === 'failed');
        const statusColor = job.status === 'completed' ? 'text-emerald-500' : job.status === 'failed' ? 'text-destructive' : job.status === 'running' ? 'text-primary' : 'text-amber-500';

        return (
          <Card key={job.id} data-testid="diag-job-card">
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={cn('text-[10px]', statusColor)}>{job.status}</Badge>
                  <span className="text-xs text-muted-foreground font-mono">trace: {job.trace_id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-muted-foreground">{completedCount}/{steps.length} steps</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                    const report = `Job: ${job.id}\nTrace: ${job.trace_id}\nStatus: ${job.status}\nSteps:\n${steps.map((s: any) => `  ${s.step_name}: ${s.status}${s.error_message ? ` (${s.error_message})` : ''}`).join('\n')}`;
                    navigator.clipboard.writeText(report);
                    toast.success('Job report copied');
                  }}>
                    <Copy className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Step progress */}
              <div className="flex gap-0.5">
                {steps.map((s: any) => (
                  <div
                    key={s.id}
                    className={cn(
                      'h-1.5 flex-1 rounded-full',
                      s.status === 'completed' ? 'bg-emerald-500' :
                      s.status === 'failed' ? 'bg-destructive' :
                      s.status === 'running' ? 'bg-primary animate-pulse' :
                      'bg-muted'
                    )}
                    title={`${PIPELINE_STEPS.find(p => p.name === s.step_name)?.label || s.step_name}: ${s.status}`}
                  />
                ))}
              </div>

              {/* Step detail list */}
              <div className="space-y-0.5">
                {steps.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      s.status === 'completed' ? 'bg-emerald-500' :
                      s.status === 'failed' ? 'bg-destructive' :
                      s.status === 'running' ? 'bg-primary' : 'bg-muted'
                    )} />
                    <span className="text-muted-foreground w-24 truncate">{PIPELINE_STEPS.find(p => p.name === s.step_name)?.label || s.step_name}</span>
                    <span className={s.status === 'failed' ? 'text-destructive' : 'text-muted-foreground'}>{s.status}</span>
                    {s.payload_size && <span className="text-muted-foreground">({Math.round(s.payload_size / 1024)}KB)</span>}
                    {s.retry_count > 0 && <span className="text-amber-400">retry:{s.retry_count}</span>}
                  </div>
                ))}
              </div>

              {failedStep && (
                <div className="text-xs text-destructive bg-destructive/5 rounded p-2">
                  <span className="font-medium">Failed: {PIPELINE_STEPS.find(p => p.name === failedStep.step_name)?.label || failedStep.step_name}</span>
                  {failedStep.error_category && <Badge variant="outline" className="ml-1.5 text-[9px]">{failedStep.error_category}</Badge>}
                  {failedStep.error_message && <p className="text-[10px] mt-0.5 font-mono break-words">{failedStep.error_message}</p>}
                </div>
              )}

              {(job.status === 'failed' || job.status === 'partial') && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs w-full gap-1.5"
                  data-testid="diag-job-retry-btn"
                  onClick={() => retryJob.mutate({ jobId: job.id, resourceId: job.resource_id })}
                  disabled={retryJob.isPending}
                >
                  <RefreshCw className={cn('h-3 w-3', retryJob.isPending && 'animate-spin')} />
                  Retry from failed step
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function Diagnostics() {
  const errors = useErrorStore();
  const { user, session } = useAuth();
  const [selectedError, setSelectedError] = useState<AppError | null>(null);
  const [, setTick] = useState(0);
  const [persistedErrors, setPersistedErrors] = useState<AppError[]>([]);
  const [loadingPersisted, setLoadingPersisted] = useState(false);
  const [tab, setTab] = useState<string>('session');

  // Filters
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterFunction, setFilterFunction] = useState<string>('all');
  const [filterRetryable, setFilterRetryable] = useState<string>('all');
  const [searchText, setSearchText] = useState('');

  // Refresh timestamps every 10s
  useEffect(() => {
    const iv = setInterval(() => setTick(t => t + 1), 10_000);
    return () => clearInterval(iv);
  }, []);

  const loadPersistedErrors = async () => {
    if (!user) return;
    setLoadingPersisted(true);
    try {
      const { data } = await supabase
        .from('error_logs')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(200);

      if (data) {
        setPersistedErrors(data.map((row: any) => ({
          category: row.category,
          message: row.message,
          rawMessage: row.raw_message || '',
          code: row.code,
          source: row.source || 'frontend',
          functionName: row.function_name,
          componentName: row.component_name,
          route: row.route,
          traceId: row.trace_id,
          timestamp: new Date(row.created_at).getTime(),
          retryable: row.retryable || false,
          metadata: row.metadata || {},
        })));
      }
    } catch {
      toast.error('Failed to load persisted errors');
    } finally {
      setLoadingPersisted(false);
    }
  };

  useEffect(() => {
    if (tab === 'persisted' && persistedErrors.length === 0) {
      loadPersistedErrors();
    }
  }, [tab]);

  const activeErrors = tab === 'session' ? errors : persistedErrors;

  // Derived filter options
  const categories = useMemo(() => ['all', ...new Set(Array.from(activeErrors).map(e => e.category))], [activeErrors]);
  const functions = useMemo(() => ['all', ...new Set(Array.from(activeErrors).map(e => e.functionName).filter(Boolean) as string[])], [activeErrors]);

  // Apply filters
  const filtered = useMemo(() => {
    let list = Array.from(activeErrors);
    if (filterCategory !== 'all') list = list.filter(e => e.category === filterCategory);
    if (filterFunction !== 'all') list = list.filter(e => e.functionName === filterFunction);
    if (filterRetryable === 'retryable') list = list.filter(e => e.retryable);
    if (filterRetryable === 'non-retryable') list = list.filter(e => !e.retryable);
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      list = list.filter(e => e.message.toLowerCase().includes(q) || e.traceId.toLowerCase().includes(q) || (e.functionName?.toLowerCase().includes(q)));
    }
    return [...list].reverse();
  }, [activeErrors, filterCategory, filterFunction, filterRetryable, searchText]);

  const online = typeof navigator !== 'undefined' ? navigator.onLine : true;

  return (
    <Layout>
      <div className="max-w-4xl mx-auto p-4 space-y-4 pb-24" data-testid="diagnostics-page">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-bold text-foreground">Ops Diagnostics</h1>
          </div>
          <div className="flex gap-2">
            {tab === 'persisted' && (
              <Button variant="outline" size="sm" onClick={loadPersistedErrors} disabled={loadingPersisted}>
                <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', loadingPersisted && 'animate-spin')} />
                Refresh
              </Button>
            )}
            {tab === 'session' && (
              <Button variant="outline" size="sm" onClick={() => { clearErrors(); toast.success('Session errors cleared'); }}>
                <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                Clear
              </Button>
            )}
          </div>
        </div>

        {/* Environment card */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="h-4 w-4" />
              Environment
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div><span className="text-muted-foreground">User:</span> {user?.email ?? '—'}</div>
            <div><span className="text-muted-foreground">UID:</span> {user?.id?.slice(0, 8) ?? '—'}</div>
            <div><span className="text-muted-foreground">Route:</span> {window.location.pathname}</div>
            <div className="flex items-center gap-1.5">
              <Wifi className={cn('h-3 w-3', online ? 'text-emerald-400' : 'text-destructive')} />
              <span>{online ? 'Online' : 'Offline'}</span>
            </div>
            <div><span className="text-muted-foreground">Session:</span> {session ? 'Active' : 'None'}</div>
            <div><span className="text-muted-foreground">Env:</span> {import.meta.env.DEV ? 'Development' : 'Production'}</div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <Tabs value={tab} onValueChange={(v) => { setTab(v); setSelectedError(null); }}>
          <TabsList className="w-full">
            <TabsTrigger value="session" className="flex-1 gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Session ({errors.length})
            </TabsTrigger>
            <TabsTrigger value="persisted" className="flex-1 gap-1.5">
              <Database className="h-3.5 w-3.5" />
              History
            </TabsTrigger>
            <TabsTrigger value="jobs" className="flex-1 gap-1.5" data-testid="diag-jobs-tab">
              <Layers className="h-3.5 w-3.5" />
              Jobs
            </TabsTrigger>
            <TabsTrigger value="enrich-test" className="flex-1 gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              Enrich Test
            </TabsTrigger>
          </TabsList>

          <TabsContent value="session" className="mt-3 space-y-3">
            {renderErrorsPanel()}
          </TabsContent>
          <TabsContent value="persisted" className="mt-3 space-y-3">
            {loadingPersisted ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Loading persisted errors…</div>
            ) : renderErrorsPanel()}
          </TabsContent>
          <TabsContent value="jobs" className="mt-3 space-y-3">
            <JobsPanel />
          </TabsContent>
          <TabsContent value="enrich-test" className="mt-3 space-y-3">
            <EnrichmentValidator />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );

  function renderErrorsPanel() {
    return (
      <>
        {/* Detail view */}
        {selectedError && <ErrorDetailView err={selectedError} onClose={() => setSelectedError(null)} />}

        {/* Filters row */}
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[140px]">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              placeholder="Search errors or trace IDs..."
              className="h-8 text-xs pl-8"
              data-testid="diag-search"
            />
          </div>
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[120px]" data-testid="diag-filter-category">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'All Categories' : c}</SelectItem>)}
            </SelectContent>
          </Select>
          {functions.length > 2 && (
            <Select value={filterFunction} onValueChange={setFilterFunction}>
              <SelectTrigger className="h-8 text-xs w-auto min-w-[120px]" data-testid="diag-filter-function">
                <SelectValue placeholder="Function" />
              </SelectTrigger>
              <SelectContent>
                {functions.map(f => <SelectItem key={f} value={f}>{f === 'all' ? 'All Functions' : f}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={filterRetryable} onValueChange={setFilterRetryable}>
            <SelectTrigger className="h-8 text-xs w-auto min-w-[100px]" data-testid="diag-filter-retryable">
              <SelectValue placeholder="Retryable" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="retryable">Retryable</SelectItem>
              <SelectItem value="non-retryable">Non-retryable</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Summary */}
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{filtered.length} error{filtered.length !== 1 ? 's' : ''}</span>
          {filtered.filter(e => e.retryable).length > 0 && (
            <span className="text-primary">{filtered.filter(e => e.retryable).length} retryable</span>
          )}
          {filtered.filter(e => e.category === 'AUTH_ERROR').length > 0 && (
            <span className="text-destructive flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {filtered.filter(e => e.category === 'AUTH_ERROR').length} auth
            </span>
          )}
        </div>

        {/* Error list */}
        <div className="space-y-2" data-testid="diag-error-list">
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground text-sm">
              {tab === 'session'
                ? 'No errors this session. Errors from API calls, component crashes, and edge functions will appear here.'
                : 'No persisted errors found.'}
            </div>
          )}
          {filtered.map((err, i) => (
            <ErrorRow key={`${err.traceId}-${i}`} err={err} onSelect={() => setSelectedError(err)} />
          ))}
        </div>
      </>
    );
  }
}
