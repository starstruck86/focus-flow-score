/**
 * BatchSelectionPanel — checkbox-based resource selection with batch actions,
 * queue progress, and per-resource status tracking.
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import {
  Play, Square, RefreshCw, Loader2, CheckCircle2, XCircle, Clock,
  ChevronDown, AlertTriangle, Zap, Filter, RotateCcw, BarChart3,
} from 'lucide-react';
import {
  runBatchQueue,
  type BatchProgress,
  type ResourceJobState,
  type ResourceJobStatus,
  type BatchAction,
  type BatchConfig,
  type ExtractionAttempt,
} from '@/lib/batchQueueProcessor';
import { dispatchExtractionMethod, runEnrichmentOnly } from '@/lib/extractionMethodDispatch';
import { normalizeSourceType } from '@/lib/sourceTypeNormalizer';
import {
  createBatchRun, finalizeBatchRun, persistJobRecords,
  persistSingleJobRecord, updateBatchRunProgress,
  hasActiveJobInDB, loadBatchRunHistory, computeBatchMetrics,
  type BatchRunRecord,
} from '@/lib/batchRunPersistence';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// ── Status config ──────────────────────────────────────────

const STATUS_DISPLAY: Record<ResourceJobStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  queued: { label: 'Queued', color: 'text-muted-foreground', icon: Clock },
  extracting: { label: 'Extracting', color: 'text-primary', icon: Loader2 },
  extracting_edge_fetch: { label: 'Edge Fetch', color: 'text-primary', icon: Loader2 },
  extracting_direct_fetch: { label: 'Direct Fetch', color: 'text-primary', icon: Loader2 },
  extracting_source_specific: { label: 'Source Extract', color: 'text-primary', icon: Loader2 },
  awaiting_transcription: { label: 'Transcribing', color: 'text-amber-500', icon: Clock },
  enriching: { label: 'Enriching', color: 'text-blue-500', icon: Loader2 },
  complete: { label: 'Complete', color: 'text-emerald-500', icon: CheckCircle2 },
  failed: { label: 'Failed', color: 'text-destructive', icon: XCircle },
  needs_attention: { label: 'Needs Attention', color: 'text-amber-500', icon: AlertTriangle },
};

// ── Types ──────────────────────────────────────────────────

interface ResourceItem {
  id: string;
  title: string;
  sourceType?: string;
  fileUrl?: string;
  resourceType?: string;
  enrichmentStatus?: string;
  contentLength?: number;
  hasKnowledge?: boolean;
}

interface Props {
  resources: ResourceItem[];
  onComplete?: () => void;
}

type FilterMode = 'all' | 'failed' | 'needs_extraction' | 'awaiting_transcription';

// ── Component ──────────────────────────────────────────────

export function BatchSelectionPanel({ resources, onComplete }: Props) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [showJobs, setShowJobs] = useState(false);
  const [showMetrics, setShowMetrics] = useState(false);
  const [metrics, setMetrics] = useState<Awaited<ReturnType<typeof computeBatchMetrics>> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Load metrics on mount
  useEffect(() => {
    loadBatchRunHistory(20).then(runs => computeBatchMetrics(runs).then(setMetrics));
  }, [progress?.isRunning]);

  // ── Selection helpers ──────────────────────────────────

  const toggle = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectN = useCallback((n: number) => {
    const filtered = getFilteredResources();
    setSelectedIds(new Set(filtered.slice(0, n).map(r => r.id)));
  }, [resources, filterMode]);

  const selectFailed = useCallback(() => {
    if (!progress) return;
    setSelectedIds(new Set(progress.jobs.filter(j => j.status === 'failed').map(j => j.resourceId)));
  }, [progress]);

  const selectAll = useCallback(() => {
    const filtered = getFilteredResources();
    setSelectedIds(new Set(filtered.map(r => r.id)));
  }, [resources, filterMode]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // ── Filtering ──────────────────────────────────────────

  function getFilteredResources(): ResourceItem[] {
    switch (filterMode) {
      case 'failed':
        if (!progress) return resources;
        const failedIds = new Set(progress.jobs.filter(j => j.status === 'failed').map(j => j.resourceId));
        return resources.filter(r => failedIds.has(r.id));
      case 'needs_extraction':
        return resources.filter(r => !r.hasKnowledge);
      case 'awaiting_transcription':
        if (!progress) return [];
        const awaitingIds = new Set(progress.jobs.filter(j => j.status === 'awaiting_transcription').map(j => j.resourceId));
        return resources.filter(r => awaitingIds.has(r.id));
      default:
        return resources;
    }
  }

  const filtered = useMemo(() => getFilteredResources(), [resources, filterMode, progress]);

  // ── Batch execution ────────────────────────────────────

  // Build a source type lookup for resources
  const sourceTypeLookup = useMemo(() => {
    const map = new Map<string, ReturnType<typeof normalizeSourceType>>();
    for (const r of resources) {
      map.set(r.id, normalizeSourceType(r.resourceType, r.fileUrl));
    }
    return map;
  }, [resources]);

  const runAction = useCallback(async (action: BatchAction) => {
    const selected = resources.filter(r => selectedIds.has(r.id));
    if (selected.length === 0) {
      toast.error('No resources selected');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const cfg = { batchSize: 15, maxConcurrency: 3, interBatchDelayMs: 750 };

    // Create persistent batch run record
    const batchRunId = await createBatchRun(action, selected.length, cfg.batchSize, cfg.maxConcurrency);

    try {
      const result = await runBatchQueue(
        selected.map(r => ({
          id: r.id,
          title: r.title,
          sourceType: sourceTypeLookup.get(r.id) ?? 'unknown',
        })),
        action,
        {
          extractResource: async (resourceId, method) => {
            const srcType = sourceTypeLookup.get(resourceId) ?? 'unknown';
            return dispatchExtractionMethod(resourceId, method, srcType);
          },
          enrichResource: async (resourceId) => {
            return runEnrichmentOnly(resourceId);
          },
          hasExtractedContent: async (resourceId) => {
            const { data } = await supabase
              .from('knowledge_items')
              .select('id')
              .eq('source_resource_id', resourceId)
              .limit(1);
            return (data?.length ?? 0) > 0;
          },
          hasActiveJob: async (resourceId) => {
            return hasActiveJobInDB(resourceId);
          },
          onProgress: (p) => setProgress({ ...p }),
        },
        cfg,
        controller.signal,
      );

      // Persist results
      if (batchRunId) {
        await finalizeBatchRun(batchRunId, result);
        await persistJobRecords(batchRunId, result.jobs);
      }

      onComplete?.();
    } catch (err: any) {
      toast.error(`Batch failed: ${err?.message}`);
    } finally {
      abortRef.current = null;
    }
  }, [selectedIds, resources, onComplete, sourceTypeLookup]);

  const cancelBatch = useCallback(() => {
    abortRef.current?.abort();
    toast.info('Batch cancelled');
  }, []);

  const isRunning = progress?.isRunning ?? false;
  const selectedCount = selectedIds.size;
  const progressPct = progress ? Math.round((progress.totalProcessed / progress.totalResources) * 100) : 0;

  // Get job state map for display
  const jobMap = useMemo(() => {
    const map = new Map<string, ResourceJobState>();
    progress?.jobs.forEach(j => map.set(j.resourceId, j));
    return map;
  }, [progress]);

  return (
    <div className="space-y-3">
      {/* ── Selection Controls ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] font-medium text-muted-foreground">Quick Select:</span>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => selectN(10)} disabled={isRunning}>10</Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => selectN(25)} disabled={isRunning}>25</Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={() => selectN(50)} disabled={isRunning}>50</Button>
        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" onClick={selectAll} disabled={isRunning}>All</Button>
        {progress && progress.failed > 0 && (
          <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 text-destructive" onClick={selectFailed} disabled={isRunning}>
            Failed ({progress.failed})
          </Button>
        )}
        <Button variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={clearSelection} disabled={isRunning}>Clear</Button>
      </div>

      {/* ── Filters ── */}
      <div className="flex gap-1 flex-wrap">
        {(['all', 'needs_extraction', 'failed', 'awaiting_transcription'] as FilterMode[]).map(mode => (
          <Button
            key={mode}
            variant={filterMode === mode ? 'default' : 'outline'}
            size="sm"
            className="h-6 text-[10px] px-2"
            onClick={() => setFilterMode(mode)}
          >
            {mode === 'all' ? `All (${resources.length})` :
             mode === 'needs_extraction' ? `Needs Extraction` :
             mode === 'failed' ? `Failed${progress ? ` (${progress.failed})` : ''}` :
             'Awaiting Transcription'}
          </Button>
        ))}
      </div>

      {/* ── Selected count + Actions ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="secondary" className="text-[10px]">{selectedCount} selected</Badge>
        
        {!isRunning && selectedCount > 0 && (
          <>
            <Button size="sm" className="h-7 text-[10px] gap-1" onClick={() => runAction('extraction')}>
              <Zap className="h-3 w-3" /> Extract ({selectedCount})
            </Button>
            <Button size="sm" variant="secondary" className="h-7 text-[10px] gap-1" onClick={() => runAction('enrichment')}>
              <Zap className="h-3 w-3" /> Enrich ({selectedCount})
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => runAction('pipeline')}>
              <Play className="h-3 w-3" /> Full Pipeline ({selectedCount})
            </Button>
          </>
        )}

        {isRunning && (
          <Button size="sm" variant="destructive" className="h-7 text-[10px] gap-1" onClick={cancelBatch}>
            <Square className="h-3 w-3" /> Cancel
          </Button>
        )}

        {!isRunning && progress && progress.failed > 0 && (
          <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 text-destructive"
            onClick={() => { selectFailed(); }}>
            <RotateCcw className="h-3 w-3" /> Retry Failed
          </Button>
        )}
      </div>

      {/* ── Progress ── */}
      {progress && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-medium">
              {isRunning
                ? `Batch ${progress.currentBatch} of ${progress.totalBatches}`
                : progress.isCancelled ? 'Cancelled' : 'Complete'}
            </span>
            <span className="text-muted-foreground">
              {progress.totalProcessed} / {progress.totalResources} processed
            </span>
          </div>
          <Progress value={progressPct} className="h-2" />
          <div className="flex gap-3 text-[10px]">
            <span className="text-emerald-500">✓ {progress.succeeded}</span>
            <span className="text-destructive">✗ {progress.failed}</span>
            <span className="text-muted-foreground">⊘ {progress.skipped}</span>
          </div>
        </div>
      )}

      {/* ── Resource List with Checkboxes ── */}
      <Collapsible open={showJobs} onOpenChange={setShowJobs}>
        <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px] font-medium text-muted-foreground">
          Resources ({filtered.length})
          <ChevronDown className={cn('h-3 w-3 transition-transform', showJobs && 'rotate-180')} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1 pt-1">
              {filtered.map(r => {
                const jobState = jobMap.get(r.id);
                const statusCfg = jobState ? STATUS_DISPLAY[jobState.status] : null;
                const StatusIcon = statusCfg?.icon;

                return (
                  <div key={r.id} className="flex items-center gap-2 p-1.5 rounded border border-border bg-card text-[10px]">
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => toggle(r.id)}
                      disabled={isRunning}
                      className="h-3.5 w-3.5"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-foreground">{r.title}</p>
                      <p className="text-muted-foreground text-[9px]">
                        {r.contentLength?.toLocaleString() ?? 0} chars · {r.enrichmentStatus ?? 'unknown'}
                      </p>
                    </div>
                    {statusCfg && StatusIcon && (
                      <div className="flex items-center gap-1 shrink-0">
                        <StatusIcon className={cn(
                          'h-3 w-3',
                          statusCfg.color,
                          (jobState?.status === 'extracting' || jobState?.status?.startsWith('extracting_') || jobState?.status === 'enriching') && 'animate-spin'
                        )} />
                        <span className={cn('text-[9px]', statusCfg.color)}>{statusCfg.label}</span>
                      </div>
                    )}
                    {jobState?.status === 'failed' && (
                      <FailureDetail job={jobState} />
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </CollapsibleContent>
      </Collapsible>

      {/* ── Post-Run Summary ── */}
      {progress && !isRunning && (
        <PostRunSummary progress={progress} />
      )}

      {/* ── Metrics ── */}
      {metrics && metrics.totalRuns > 0 && (
        <Collapsible open={showMetrics} onOpenChange={setShowMetrics}>
          <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px] font-medium text-muted-foreground">
            <span className="flex items-center gap-1"><BarChart3 className="h-3 w-3" /> Batch Metrics ({metrics.totalRuns} runs)</span>
            <ChevronDown className={cn('h-3 w-3 transition-transform', showMetrics && 'rotate-180')} />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-2 text-[10px]">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <p className="text-muted-foreground">Success Rate</p>
                  <p className="font-semibold text-foreground">{(metrics.overallSuccessRate * 100).toFixed(1)}%</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Resources Processed</p>
                  <p className="font-semibold text-foreground">{metrics.totalResources}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Avg Duration</p>
                  <p className="font-semibold text-foreground">{metrics.avgBatchDurationMs > 0 ? `${(metrics.avgBatchDurationMs / 1000).toFixed(1)}s` : '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Recovered by Fallback</p>
                  <p className="font-semibold text-foreground">{metrics.recoveredByFallback}</p>
                </div>
              </div>
              {metrics.topFailureReasons.length > 0 && (
                <div>
                  <p className="text-muted-foreground font-medium mb-1">Top Failure Reasons</p>
                  {metrics.topFailureReasons.map((f, i) => (
                    <p key={i} className="text-destructive text-[9px]">
                      {f.count}× {f.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── Failure Detail ─────────────────────────────────────────

function FailureDetail({ job }: { job: ResourceJobState }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger>
        <Badge variant="outline" className="text-[8px] text-destructive border-destructive/30 cursor-pointer">
          Details
        </Badge>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 ml-6">
        <div className="text-[9px] text-destructive bg-destructive/5 rounded p-1.5 space-y-0.5">
          <p className="font-medium">{job.failureReason || 'Unknown failure'}</p>
          {job.attempts.length > 0 && (
            <div className="space-y-0.5 mt-1">
              <p className="text-[8px] text-muted-foreground font-medium">Attempts:</p>
              {job.attempts.map((a, i) => (
                <p key={i} className="text-[8px]">
                  {a.method}: {a.success ? '✓' : '✗'} {a.failureReason && `— ${a.failureReason}`}
                  {a.timedOut && ' (timeout)'}
                </p>
              ))}
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── Post-Run Summary ───────────────────────────────────────

function PostRunSummary({ progress }: { progress: BatchProgress }) {
  const failedJobs = progress.jobs.filter(j => j.status === 'failed');
  const awaitingJobs = progress.jobs.filter(j => j.status === 'awaiting_transcription' || j.status === 'needs_attention');

  // Method distribution
  const methodCounts = new Map<string, number>();
  let fallbackCount = 0;
  for (const job of progress.jobs) {
    if (job.status === 'complete' && job.attempts.length > 0) {
      const successAttempt = job.attempts.find(a => a.success);
      const method = successAttempt?.method ?? job.attempts[job.attempts.length - 1]?.method ?? 'unknown';
      methodCounts.set(method, (methodCounts.get(method) ?? 0) + 1);
      if (job.attempts.length > 1) fallbackCount++;
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <p className="text-[11px] font-semibold text-foreground">
        {progress.isCancelled ? 'Run Cancelled' : 'Run Complete'}
      </p>
      
      <div className="text-[10px] space-y-1">
        <p><span className="font-medium">What happened:</span> Processed {progress.totalProcessed} of {progress.totalResources} resources across {progress.totalBatches} batches.</p>
        <p className="text-emerald-600">✓ {progress.succeeded} extracted successfully</p>
        {progress.failed > 0 && <p className="text-destructive">✗ {progress.failed} failed — see details below</p>}
        {progress.skipped > 0 && <p className="text-muted-foreground">⊘ {progress.skipped} skipped (already processed or duplicate)</p>}
        {fallbackCount > 0 && <p className="text-amber-600">↻ {fallbackCount} recovered via fallback method</p>}
      </div>

      {/* Method distribution */}
      {methodCounts.size > 0 && (
        <div className="text-[9px] text-muted-foreground border-t border-border pt-1.5">
          <span className="font-medium">Methods used: </span>
          {Array.from(methodCounts.entries()).map(([m, c]) => `${m} (${c})`).join(', ')}
        </div>
      )}

      {/* Awaiting transcription */}
      {awaitingJobs.length > 0 && (
        <div className="rounded bg-amber-500/10 border border-amber-500/20 p-2 text-[10px]">
          <p className="font-medium text-amber-700">⏳ {awaitingJobs.length} resources awaiting transcription</p>
          <p className="text-muted-foreground mt-0.5">
            Upload a transcript file (.txt, .vtt, .srt) for these resources, or wait for automatic transcription to complete.
          </p>
        </div>
      )}

      {failedJobs.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-destructive font-medium hover:underline">
            <ChevronDown className="h-3 w-3" />
            {failedJobs.length} failures
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-1 mt-1">
              {failedJobs.map(j => (
                <div key={j.resourceId} className="text-[9px] p-1.5 rounded bg-destructive/5 border border-destructive/10">
                  <p className="font-medium truncate">{j.title}</p>
                  <p className="text-destructive">{j.failureReason}</p>
                  {j.attempts.length > 0 && (
                    <p className="text-muted-foreground mt-0.5">
                      Tried: {j.attempts.map(a => `${a.method}${a.timedOut ? ' (timeout)' : ''}`).join(' → ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Next action recommendation */}
      <div className="text-[10px] border-t border-border pt-2">
        <span className="font-medium">Next:</span>{' '}
        {awaitingJobs.length > 0
          ? 'Upload transcripts for awaiting resources, then retry.'
          : progress.failed > 0
            ? 'Select failed resources and retry with a smaller batch.'
            : progress.succeeded === progress.totalResources
              ? 'All resources processed. Review knowledge items for quality.'
              : 'Review skipped resources for manual attention.'}
      </div>
    </div>
  );
}
