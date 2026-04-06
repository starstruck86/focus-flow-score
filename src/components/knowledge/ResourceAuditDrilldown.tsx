/**
 * Resource-level audit drilldown sheet.
 * Shows full extraction history, batch ledger, resume status, and re-extract action.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Loader2, Zap, Clock, FileText, CheckCircle2, AlertTriangle, XCircle, Ban, RotateCcw, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ResourceAuditRow } from '@/hooks/useKnowledgeCoverageAudit';

interface Props {
  resource: ResourceAuditRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReExtract: (resource: ResourceAuditRow) => void;
  onMarkExcluded?: (resourceId: string) => void;
  isExcluded?: boolean;
  lastQueueResult?: {
    ki_delta?: number;
    net_new_unique?: number;
    active_delta?: number;
    lift_status?: string;
    no_lift_reason?: string;
    quality_label?: string;
    ef_returned_count?: number;
    ef_validated_count?: number;
    ef_saved_count?: number;
    duplicates_skipped?: number;
    post_ki_count?: number;
    post_kis_per_1k?: number;
    post_active_count?: number;
    dominant_bottleneck?: string;
    ef_dedup_details?: Record<string, number>;
    ef_validation_rejections?: Record<string, number>;
  };
}

function useExtractionRuns(resourceId: string | null) {
  return useQuery({
    queryKey: ['extraction-runs', resourceId],
    queryFn: async () => {
      if (!resourceId) return [];
      const { data, error } = await supabase
        .from('extraction_runs' as any)
        .select('*')
        .eq('resource_id', resourceId)
        .order('started_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return data || [];
    },
    enabled: !!resourceId,
  });
}

function useBatchLedger(resourceId: string | null) {
  return useQuery({
    queryKey: ['extraction-batches', resourceId],
    queryFn: async () => {
      if (!resourceId) return [];
      const { data, error } = await supabase
        .from('extraction_batches' as any)
        .select('*')
        .eq('resource_id', resourceId)
        .order('batch_index', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!resourceId,
    refetchOnMount: 'always',
    refetchInterval: 3000,
  });
}

/** Reconcile resource snapshot from run history */
function useReconciledSnapshot(resourceId: string | null, runs: any[], batches: any[]) {
  const attemptCount = runs.length;
  const deduped = new Map<number, any>();
  for (const batch of batches) {
    const existing = deduped.get(batch.batch_index);
    const rank = { completed: 5, running: 4, failed: 3, pending: 2 } as const;
    if (!existing || (rank[batch.status as keyof typeof rank] ?? 0) >= (rank[existing.status as keyof typeof rank] ?? 0)) {
      deduped.set(batch.batch_index, batch);
    }
  }

  const entries = Array.from(deduped.values()).sort((a, b) => a.batch_index - b.batch_index);
  const completedBatches = entries.filter((b: any) => b.status === 'completed').length;
  const totalBatches = entries.reduce((max, batch: any) => Math.max(max, batch.batch_total ?? 0, batch.batch_index + 1), 0);
  const hasIncompleteBatches = totalBatches > 0 && completedBatches < totalBatches;
  const runningBatch = entries.find((b: any) => b.status === 'running');
  const staleRunning = !!runningBatch?.started_at && (Date.now() - new Date(runningBatch.started_at).getTime() > 10 * 60 * 1000);
  let nextBatchIndex: number | null = null;
  for (let index = 0; index < totalBatches; index++) {
    if (!entries.some((batch: any) => batch.batch_index === index && batch.status === 'completed')) {
      nextBatchIndex = index;
      break;
    }
  }

  return {
    attemptCount,
    completedBatches,
    totalBatches,
    hasIncompleteBatches,
    nextBatchIndex,
    isResumable: hasIncompleteBatches,
    resumeState: !totalBatches
      ? 'not_started'
      : !hasIncompleteBatches
        ? 'completed'
        : runningBatch
          ? (staleRunning ? 'stale' : 'active')
          : 'runnable',
  };
}

function RunStatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'partial') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  return <Clock className="h-3.5 w-3.5 text-muted-foreground" />;
}

function DepthBadge({ bucket }: { bucket: string }) {
  const variant = bucket === 'strong' ? 'default'
    : bucket === 'moderate' ? 'secondary'
    : bucket === 'shallow' ? 'outline'
    : 'destructive';
  return <Badge variant={variant} className="text-[9px]">{bucket}</Badge>;
}

function BatchStatusBadge({ status }: { status: string }) {
  if (status === 'completed') return <Badge variant="default" className="text-[8px] bg-emerald-600">✓</Badge>;
  if (status === 'failed') return <Badge variant="destructive" className="text-[8px]">✗</Badge>;
  if (status === 'running') return <Badge variant="secondary" className="text-[8px]">…</Badge>;
  return <Badge variant="outline" className="text-[8px]">—</Badge>;
}

export function ResourceAuditDrilldown({ resource, open, onOpenChange, onReExtract, onMarkExcluded, isExcluded, lastQueueResult }: Props) {
  const { data: runs = [], isLoading: runsLoading } = useExtractionRuns(resource?.resource_id ?? null);
  const { data: batches = [] } = useBatchLedger(resource?.resource_id ?? null);
  const snapshot = useReconciledSnapshot(resource?.resource_id ?? null, runs, batches);
  const r = resource;

  if (!r) return null;
  const isLargeDoc = r.content_length >= 40000;
  const hasBatches = batches.length > 0;

  // Always show rerun if: not excluded, not reference_only, has content, and either incomplete batches or density < 1.5
  const canManualReExtract = !isExcluded
    && r.resource_type !== 'reference_only'
    && r.content_length >= 1500
    && (snapshot.hasIncompleteBatches || !(r.extraction_depth_bucket === 'strong' && r.kis_per_1k_chars >= 1.5));

  const qr = lastQueueResult;

  // Use reconciled attempt count instead of potentially stale resource field
  const displayAttemptCount = snapshot.attemptCount > 0 ? snapshot.attemptCount : r.extraction_attempt_count;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Resource Audit
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {/* Identity */}
          <div>
            <h3 className="text-sm font-semibold truncate">{r.title}</h3>
            <div className="flex gap-2 mt-1 flex-wrap">
              <Badge variant="outline" className="text-[9px]">{r.resource_type}</Badge>
              <Badge variant="outline" className="text-[9px]">{r.enrichment_status}</Badge>
              <DepthBadge bucket={r.extraction_depth_bucket} />
              {r.under_extracted_flag && <Badge variant="destructive" className="text-[9px]">Under-Extracted</Badge>}
              {isExcluded && <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600">Excluded</Badge>}
              {snapshot.isResumable && <Badge variant="outline" className="text-[9px] border-blue-500/40 text-blue-600">Resumable</Badge>}
            </div>
          </div>

          <Separator />

          {/* Resume Status Card — for large docs with batch progress */}
          {isLargeDoc && hasBatches && (
            <>
              <div className="border border-border rounded-md p-3 bg-muted/30">
                <div className="flex items-center gap-2 text-xs font-medium mb-2">
                  <Layers className="h-3.5 w-3.5" />
                  Batch Extraction Status
                  <Badge variant="outline" className="text-[9px] ml-auto">
                    {snapshot.resumeState === 'active'
                      ? 'active'
                      : snapshot.resumeState === 'stale'
                        ? 'stale-cleared'
                        : snapshot.resumeState === 'runnable'
                          ? 'resumable'
                          : 'complete'}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center">
                    <div className="font-bold text-lg">{snapshot.completedBatches}</div>
                    <div className="text-[10px] text-muted-foreground">Completed</div>
                  </div>
                  <div className="text-center">
                    <div className="font-bold text-lg">{snapshot.totalBatches}</div>
                    <div className="text-[10px] text-muted-foreground">Total Batches</div>
                  </div>
                  <div className="text-center">
                    <div className={cn("font-bold text-lg", snapshot.hasIncompleteBatches ? "text-amber-500" : "text-emerald-600")}>
                      {snapshot.hasIncompleteBatches && snapshot.nextBatchIndex != null ? snapshot.nextBatchIndex + 1 : '✓'}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {snapshot.hasIncompleteBatches ? 'Next Batch' : 'All Done'}
                    </div>
                  </div>
                </div>
                {snapshot.hasIncompleteBatches && (
                  <div className="mt-2 text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1">
                    {snapshot.totalBatches - snapshot.completedBatches} batch(es) remaining. Re-extraction will resume from batch {(snapshot.nextBatchIndex ?? 0) + 1}.
                  </div>
                )}
              </div>
              <Separator />
            </>
          )}

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MetricCard label="Content Length" value={`${(r.content_length / 1000).toFixed(1)}k chars`} />
            <MetricCard label="Total KIs" value={String(r.ki_count_total)} />
            <MetricCard label="Active KIs" value={String(r.ki_count_active)} highlight={r.ki_count_active < r.ki_count_total} />
            <MetricCard label="KIs w/ Context" value={String(r.ki_with_context_count)} highlight={r.ki_with_context_count < r.ki_count_active} />
            <MetricCard label="KIs/1k Chars" value={String(r.kis_per_1k_chars)} />
            <MetricCard label="Extraction Mode" value={r.extraction_mode} />
            <MetricCard label="Method" value={r.extraction_method || 'unknown'} />
            <MetricCard label="Attempts" value={String(displayAttemptCount)} highlight={displayAttemptCount !== r.extraction_attempt_count} />
          </div>

          {/* Batch Ledger Table */}
          {hasBatches && (
            <>
              <Separator />
              <div>
                <div className="text-xs text-muted-foreground font-medium mb-2">Batch Ledger</div>
                <div className="border border-border rounded-md overflow-hidden">
                  <table className="w-full text-[10px]">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-1.5 py-1 text-left">#</th>
                        <th className="px-1.5 py-1 text-left">Range</th>
                        <th className="px-1.5 py-1 text-right">Raw</th>
                        <th className="px-1.5 py-1 text-right">Valid</th>
                        <th className="px-1.5 py-1 text-right">Saved</th>
                        <th className="px-1.5 py-1 text-right">Dupes</th>
                        <th className="px-1.5 py-1 text-right">Cum.</th>
                        <th className="px-1.5 py-1 text-center">St.</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(batches as any[]).map((b: any) => (
                         <tr key={b.batch_index} className="border-t border-border/50 align-top">
                          <td className="px-1.5 py-1 font-mono">{b.batch_index + 1}</td>
                           <td className="px-1.5 py-1 max-w-[120px]" title={`${b.semantic_start_marker || '—'} → ${b.semantic_end_marker || '—'}`}>
                             <div className="font-mono text-[9px] text-muted-foreground">{(b.char_start / 1000).toFixed(1)}k–{(b.char_end / 1000).toFixed(1)}k</div>
                             <div className="truncate">{b.semantic_start_marker || '—'}</div>
                             <div className="truncate text-muted-foreground">→ {b.semantic_end_marker || '—'}</div>
                          </td>
                          <td className="px-1.5 py-1 text-right font-mono">{b.raw_count ?? 0}</td>
                          <td className="px-1.5 py-1 text-right font-mono">{b.validated_count ?? 0}</td>
                          <td className="px-1.5 py-1 text-right font-mono">{b.saved_count ?? 0}</td>
                          <td className="px-1.5 py-1 text-right font-mono">{b.duplicates_skipped ?? 0}</td>
                          <td className="px-1.5 py-1 text-right font-mono">{b.cumulative_resource_ki_count ?? '—'}</td>
                          <td className="px-1.5 py-1 text-center"><BatchStatusBadge status={b.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Last Re-Extraction Result (from queue) */}
          {qr && (
            <>
              <Separator />
              <div className="text-xs">
                <div className="text-muted-foreground font-medium mb-2">Last Re-Extraction Result</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Pre Total KIs:</span><span className="font-mono">{r.ki_count_total}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Post Total KIs:</span><span className="font-mono">{qr.post_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Raw Δ:</span><span className={cn("font-mono font-bold", (qr.ki_delta ?? 0) > 0 ? "text-emerald-600" : "text-muted-foreground")}>{qr.ki_delta != null ? (qr.ki_delta > 0 ? `+${qr.ki_delta}` : qr.ki_delta) : '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Net New Unique:</span><span className="font-mono">{qr.net_new_unique ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">+Active:</span><span className="font-mono">{qr.active_delta ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Dupes Skipped:</span><span className="font-mono">{qr.duplicates_skipped ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">EF Returned:</span><span className="font-mono">{qr.ef_returned_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">EF Validated:</span><span className="font-mono">{qr.ef_validated_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">EF Saved:</span><span className="font-mono">{qr.ef_saved_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Post KIs/1k:</span><span className="font-mono">{qr.post_kis_per_1k ?? '—'}</span></div>
                </div>
                {qr.lift_status && (
                  <div className="mt-2">
                    <Badge variant="outline" className={cn("text-[9px]",
                      qr.lift_status === 'meaningful_lift' ? "border-emerald-500/40 text-emerald-600" :
                      qr.lift_status === 'minor_lift' ? "border-blue-500/40 text-blue-600" :
                      qr.lift_status === 'no_lift' ? "border-amber-500/40 text-amber-600" :
                      "border-destructive/40 text-destructive"
                    )}>
                      {qr.lift_status.replace('_', ' ')}
                    </Badge>
                  </div>
                )}
                {qr.no_lift_reason && (
                  <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1 flex items-start gap-1">
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>{qr.quality_label || qr.no_lift_reason}</span>
                  </div>
                )}
                {qr.dominant_bottleneck && qr.dominant_bottleneck !== 'none' && (
                  <div className="mt-1">
                    <Badge variant="outline" className="text-[8px] border-destructive/30 text-destructive">
                      Bottleneck: {qr.dominant_bottleneck.replace(/_/g, ' ')}
                    </Badge>
                  </div>
                )}
                {qr.ef_validation_rejections && Object.keys(qr.ef_validation_rejections).length > 0 && (
                  <div className="mt-2 text-[10px]">
                    <div className="text-muted-foreground font-medium mb-1">Validation Rejections</div>
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(qr.ef_validation_rejections).map(([reason, count]) => (
                        <Badge key={reason} variant="secondary" className="text-[8px]">{reason}: {count}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {qr.ef_dedup_details && Object.values(qr.ef_dedup_details).some(v => v > 0) && (
                  <div className="mt-2 text-[10px]">
                    <div className="text-muted-foreground font-medium mb-1">Dedup Details</div>
                    <div className="flex gap-1 flex-wrap">
                      {Object.entries(qr.ef_dedup_details).filter(([_, count]) => count > 0).map(([reason, count]) => (
                        <Badge key={reason} variant="secondary" className="text-[8px]">{reason}: {count}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}

          {/* Passes & Pipeline */}
          {r.extraction_passes_run.length > 0 && (
            <div className="text-xs">
              <div className="text-muted-foreground font-medium mb-1">Passes Run</div>
              <div className="flex gap-1 flex-wrap">
                {r.extraction_passes_run.map(p => (
                  <Badge key={p} variant="secondary" className="text-[9px]">{p}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Latest Run Metrics */}
          {r.last_extraction_run_id && (
            <>
              <Separator />
              <div className="text-xs">
                <div className="text-muted-foreground font-medium mb-2">Latest Run Snapshot</div>
                <div className="grid grid-cols-2 gap-1">
                  <div className="flex justify-between"><span className="text-muted-foreground">Status:</span><span className="flex items-center gap-1"><RunStatusIcon status={r.last_extraction_run_status || ''} />{r.last_extraction_run_status}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Model:</span><span>{r.last_extraction_model || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Returned:</span><span className="font-mono">{r.last_extraction_returned_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Deduped:</span><span className="font-mono">{r.last_extraction_deduped_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Validated:</span><span className="font-mono">{r.last_extraction_validated_ki_count ?? '—'}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Saved:</span><span className="font-mono">{r.last_extraction_saved_ki_count ?? '—'}</span></div>
                  {r.last_extraction_duration_ms && (
                    <div className="flex justify-between"><span className="text-muted-foreground">Duration:</span><span>{(r.last_extraction_duration_ms / 1000).toFixed(1)}s</span></div>
                  )}
                </div>
                {r.last_extraction_error && (
                  <div className="mt-2 text-destructive bg-destructive/10 rounded p-2 text-[10px]">{r.last_extraction_error}</div>
                )}
              </div>
            </>
          )}

          {/* Summary */}
          {r.last_extraction_summary && (
            <div className="text-[11px] bg-muted/50 rounded-md p-2">
              <div className="text-muted-foreground font-medium mb-1">Extraction Summary</div>
              {r.last_extraction_summary}
            </div>
          )}

          <Separator />

          {/* Extraction History */}
          <div>
            <div className="text-xs text-muted-foreground font-medium mb-2">Extraction History ({runs.length} runs)</div>
            {runsLoading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading runs…
              </div>
            ) : runs.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">No extraction runs recorded yet.</div>
            ) : (
              <div className="space-y-2">
                {runs.map((run: any) => (
                  <div key={run.id} className="border border-border rounded-md p-2 text-[11px] space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <RunStatusIcon status={run.status} />
                        <span className="font-medium">{run.status}</span>
                        {run.extraction_mode && <Badge variant="outline" className="text-[8px]">{run.extraction_mode}</Badge>}
                      </span>
                      <span className="text-muted-foreground">
                        {run.started_at ? new Date(run.started_at).toLocaleDateString() : '—'}
                      </span>
                    </div>
                    {run.summary && <div className="text-muted-foreground truncate">{run.summary}</div>}
                    <div className="flex gap-3 text-muted-foreground">
                      {run.saved_candidate_count != null && <span>Saved: {run.saved_candidate_count}</span>}
                      {run.kis_per_1k_chars != null && <span>{run.kis_per_1k_chars} KIs/1k</span>}
                      {run.duration_ms && <span>{(run.duration_ms / 1000).toFixed(1)}s</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="pt-2 space-y-2">
            {canManualReExtract && (
              <>
                <Button
                  className="w-full gap-2"
                  onClick={() => { onReExtract(r); onOpenChange(false); }}
                >
                  {snapshot.hasIncompleteBatches ? (
                    <><RotateCcw className="h-4 w-4" /> Resume Re-Extraction (Batch {(snapshot.nextBatchIndex ?? 0) + 1} of {snapshot.totalBatches})</>
                  ) : (
                    <><Zap className="h-4 w-4" /> {isLargeDoc ? 'Re-Extract (Semantic Batched, Deep Mode)' : 'Re-Extract This Resource (Deep Mode)'}</>
                  )}
                </Button>
                <p className="text-[10px] text-muted-foreground text-center">
                  {snapshot.hasIncompleteBatches
                    ? `${snapshot.completedBatches} of ${snapshot.totalBatches} batches already completed. Will resume from next unfinished batch using the durable batch ledger.`
                    : isLargeDoc
                    ? 'Splits content at semantic boundaries (headings, sections). Each batch persists independently.'
                    : 'Runs 3-pass deep extraction: Core → Hidden → Framework'}
                </p>
              </>
            )}
            {onMarkExcluded && !isExcluded && (
              <Button
                variant="outline"
                className="w-full gap-2 text-xs"
                onClick={() => { onMarkExcluded(r.resource_id); }}
              >
                <Ban className="h-3.5 w-3.5" />
                Mark as Not Worth Re-Extracting
              </Button>
            )}
            {isExcluded && (
              <div className="text-center text-[11px] text-amber-600">
                This resource is excluded from future re-extraction queues.
              </div>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function MetricCard({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="border border-border rounded p-2">
      <div className={cn("font-bold text-sm", highlight && "text-amber-500")}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}
