/**
 * Re-Extraction Queue — shows flagged resources with status tracking,
 * lift classification, no-lift diagnosis, and coverage lift summary.
 */
import { useState } from 'react';
import type { DominantBottleneck } from '@/hooks/useDeepReExtraction';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Zap, Loader2, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Trash2, Info, Ban, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReExtractQueueItem, CoverageLiftSummary, LiftStatus, NoLiftReason } from '@/hooks/useDeepReExtraction';

interface Props {
  queue: ReExtractQueueItem[];
  isRunning: boolean;
  liftSummary: CoverageLiftSummary | null;
  onRunDeepExtraction: () => void;
  onRemove: (resourceId: string) => void;
  onClear: () => void;
  onMarkExcluded?: (resourceId: string) => void;
}

function StatusIcon({ status, batchInfo }: { status: string; batchInfo?: { completed?: number; total?: number } }) {
  if (status === 'running_batched') return (
    <div className="flex items-center gap-1">
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
      {batchInfo?.completed != null && batchInfo?.total != null && (
        <span className="text-[10px] font-mono text-primary">{batchInfo.completed}/{batchInfo.total}</span>
      )}
    </div>
  );
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'partial' || status === 'partial_complete_resumable') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30" />;
}

function DeltaCell({ value }: { value?: number }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(
      "font-mono font-bold",
      value > 0 ? "text-emerald-600" : value < 0 ? "text-destructive" : "text-muted-foreground"
    )}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

function LiftBadge({ liftStatus, noLiftReason, qualityLabel }: {
  liftStatus?: LiftStatus;
  noLiftReason?: NoLiftReason;
  qualityLabel?: string;
}) {
  if (!liftStatus) return null;

  const config: Record<LiftStatus, { icon: React.ReactNode; label: string; cls: string }> = {
    meaningful_lift: { icon: <TrendingUp className="h-2.5 w-2.5" />, label: 'Lift', cls: 'border-emerald-500/40 text-emerald-600' },
    minor_lift: { icon: <TrendingUp className="h-2.5 w-2.5" />, label: 'Minor', cls: 'border-blue-500/40 text-blue-600' },
    no_lift: { icon: <Ban className="h-2.5 w-2.5" />, label: 'No Lift', cls: 'border-amber-500/40 text-amber-600' },
    regression: { icon: <TrendingDown className="h-2.5 w-2.5" />, label: 'Regress', cls: 'border-destructive/40 text-destructive' },
  };

  const c = config[liftStatus];
  const tooltip = qualityLabel || (noLiftReason ? formatNoLiftReason(noLiftReason) : undefined);

  if (tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger>
          <Badge variant="outline" className={cn("text-[9px] gap-0.5", c.cls)}>
            {c.icon} {c.label}
          </Badge>
        </TooltipTrigger>
        <TooltipContent className="max-w-[220px] text-xs">{tooltip}</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Badge variant="outline" className={cn("text-[9px] gap-0.5", c.cls)}>
      {c.icon} {c.label}
    </Badge>
  );
}

function formatNoLiftReason(reason: NoLiftReason): string {
  const map: Record<NoLiftReason, string> = {
    already_dense: 'Already dense — resource well-mined',
    duplicate_heavy: 'All new items were duplicates of existing KIs',
    extractor_returned_no_new_items: 'AI extractor returned no new items from this content',
    extractor_weak_output: 'AI extractor produced too few candidates',
    items_generated_but_filtered_out: 'Items generated but failed quality validation',
    items_generated_but_deduped: 'Items generated but all matched existing fingerprints',
    validation_too_strict: 'Validation rejected most candidates — may need threshold tuning',
    resource_not_suitable: 'Content too thin or not suitable for extraction',
    unknown: 'No lift — cause could not be determined',
  };
  return map[reason] || reason;
}

function formatBottleneck(b: DominantBottleneck): string {
  const map: Record<DominantBottleneck, string> = {
    extractor_weak_output: 'Extractor weak',
    validation_too_strict: 'Validation strict',
    dedup_too_aggressive: 'Dedup aggressive',
    already_mined: 'Already mined',
    unsuitable_content: 'Unsuitable content',
    none: 'No bottleneck',
    unknown: 'Unknown',
  };
  return map[b] || b;
}

function BottleneckBadge({ bottleneck }: { bottleneck?: DominantBottleneck }) {
  if (!bottleneck || bottleneck === 'none') return null;
  const cls = bottleneck === 'already_mined' ? 'border-muted-foreground/40 text-muted-foreground'
    : bottleneck === 'extractor_weak_output' ? 'border-destructive/40 text-destructive'
    : bottleneck === 'validation_too_strict' ? 'border-amber-500/40 text-amber-600'
    : bottleneck === 'dedup_too_aggressive' ? 'border-blue-500/40 text-blue-600'
    : 'border-muted-foreground/40 text-muted-foreground';
  return <Badge variant="outline" className={cn("text-[8px]", cls)}>{formatBottleneck(bottleneck)}</Badge>;
}

function PipelineTooltip({ item }: { item: ReExtractQueueItem }) {
  if (item.ef_returned_count == null) return null;
  return (
    <div className="text-[10px] space-y-0.5">
      <div>Raw returned: <strong>{item.ef_returned_count}</strong></div>
      <div>Validated: <strong>{item.ef_validated_count ?? '—'}</strong></div>
      <div>Saved: <strong>{item.ef_saved_count ?? '—'}</strong></div>
      <div>Dupes skipped: <strong>{item.duplicates_skipped ?? 0}</strong></div>
      {item.dominant_bottleneck && item.dominant_bottleneck !== 'none' && (
        <div className="pt-1 font-semibold">Bottleneck: {formatBottleneck(item.dominant_bottleneck)}</div>
      )}
    </div>
  );
}

export function ReExtractionQueue({ queue, isRunning, liftSummary, onRunDeepExtraction, onRemove, onClear, onMarkExcluded }: Props) {
  const [showConfirm, setShowConfirm] = useState(false);

  if (queue.length === 0) return null;

  const queued = queue.filter(i => i.status === 'queued');
  const completed = queue.filter(i => i.status === 'completed' || i.status === 'partial');
  const failed = queue.filter(i => i.status === 'failed');
  const avgContentLength = Math.round(queue.reduce((s, i) => s + i.content_length, 0) / queue.length);
  const totalCurrentKIs = queue.reduce((s, i) => s + i.pre_ki_count, 0);
  const progressPct = queue.length > 0
    ? Math.round(((completed.length + failed.length) / queue.length) * 100)
    : 0;

  const allDone = queued.length === 0 && (completed.length + failed.length) > 0;
  const allNoLift = allDone && liftSummary && liftSummary.totalKiDelta === 0 && liftSummary.resourcesSucceeded > 0;

  return (
    <TooltipProvider>
      <>
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" />
                Re-Extraction Queue ({queue.length})
              </CardTitle>
              <div className="flex gap-1.5">
                {queued.length > 0 && !isRunning && (
                  <Button
                    variant="default"
                    size="sm"
                    className="text-xs gap-1.5"
                    onClick={() => setShowConfirm(true)}
                  >
                    <Zap className="h-3 w-3" />
                    Run Deep Extraction ({queued.length})
                  </Button>
                )}
                {!isRunning && (
                  <Button variant="ghost" size="sm" className="text-xs" onClick={onClear}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {isRunning && (
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>Processing…</span>
                  <span>{progressPct}%</span>
                </div>
                <Progress value={progressPct} className="h-2" />
              </div>
            )}

            <div className="max-h-[400px] overflow-auto border border-border rounded-md">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] w-8"></TableHead>
                    <TableHead className="text-[10px]">Resource</TableHead>
                    <TableHead className="text-[10px] text-right">Before</TableHead>
                    <TableHead className="text-[10px] text-right">After</TableHead>
                    <TableHead className="text-[10px] text-right">Raw Δ</TableHead>
                    <TableHead className="text-[10px] text-right">Net New</TableHead>
                    <TableHead className="text-[10px] text-right">+Active</TableHead>
                    <TableHead className="text-[10px] text-right">Dupes</TableHead>
                    <TableHead className="text-[10px]">Lift</TableHead>
                    <TableHead className="text-[10px] w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map(item => (
                    <TableRow key={item.resource_id}>
                      <TableCell><StatusIcon status={item.status} batchInfo={item.is_batched ? { completed: item.batches_completed, total: item.batch_total } : undefined} /></TableCell>
                      <TableCell>
                        <div className="text-[11px] max-w-[120px] truncate">{item.title}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {(item.content_length / 1000).toFixed(1)}k chars
                          {item.is_batched && <span className="ml-1 text-primary">• batched</span>}
                        </div>
                        {item.batch_status && item.status !== 'completed' && (
                          <div className="text-[9px] font-mono text-primary">{item.batch_status}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-[11px] text-right font-mono">
                        {item.pre_ki_count}
                        <div className="text-[9px] text-muted-foreground">{item.pre_kis_per_1k}/1k</div>
                      </TableCell>
                      <TableCell className="text-[11px] text-right font-mono">
                        {item.post_ki_count != null ? (
                          <>
                            {item.post_ki_count}
                            <div className="text-[9px] text-muted-foreground">{item.post_kis_per_1k}/1k</div>
                          </>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-[11px] text-right">
                        <DeltaCell value={item.ki_delta} />
                      </TableCell>
                      <TableCell className="text-[11px] text-right">
                        <DeltaCell value={item.net_new_unique} />
                      </TableCell>
                      <TableCell className="text-[11px] text-right">
                        <DeltaCell value={item.active_delta} />
                      </TableCell>
                      <TableCell className="text-[11px] text-right font-mono text-muted-foreground">
                        {item.duplicates_skipped != null ? item.duplicates_skipped : '—'}
                      </TableCell>
                      <TableCell className="text-[10px] max-w-[130px]">
                        {item.status === 'queued' ? (
                          <span className="text-muted-foreground truncate text-[9px]">{item.reason}</span>
                        ) : (item.status === 'completed' || item.status === 'partial') ? (
                          <div className="space-y-0.5">
                            <LiftBadge
                              liftStatus={item.lift_status}
                              noLiftReason={item.no_lift_reason}
                              qualityLabel={item.quality_label}
                            />
                            <BottleneckBadge bottleneck={item.dominant_bottleneck} />
                            {item.ef_returned_count != null && (
                              <Tooltip>
                                <TooltipTrigger>
                                  <div className="text-[8px] text-muted-foreground cursor-help">
                                    {item.ef_returned_count}→{item.ef_validated_count ?? '?'}→{item.ef_saved_count ?? '?'}
                                  </div>
                                </TooltipTrigger>
                                <TooltipContent><PipelineTooltip item={item} /></TooltipContent>
                              </Tooltip>
                            )}
                          </div>
                        ) : item.status === 'failed' ? (
                          <span className="text-[9px] text-destructive truncate">{item.error || 'Failed'}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-0.5">
                          {item.status === 'queued' && !isRunning && (
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemove(item.resource_id)}>
                              <XCircle className="h-3 w-3 text-muted-foreground" />
                            </Button>
                          )}
                          {item.lift_status === 'no_lift' && onMarkExcluded && !item.excluded_from_future && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onMarkExcluded(item.resource_id)}>
                                  <Ban className="h-3 w-3 text-muted-foreground" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs">Exclude from future re-extraction</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Coverage Lift Summary */}
        {liftSummary && (
          <Card className={cn(
            "border-emerald-500/20",
            allNoLift && "border-amber-500/30"
          )}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                {allNoLift ? (
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                ) : (
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                )}
                Coverage Lift Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              {/* Warning banner for zero lift */}
              {allNoLift && (
                <div className="mb-3 text-[12px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <div>
                    <div className="font-semibold">Runs completed but produced no measurable coverage lift.</div>
                    {liftSummary.topNoLiftReason && (
                      <div className="mt-1 text-[11px]">
                        Top reason: <strong>{formatNoLiftReason(liftSummary.topNoLiftReason)}</strong>
                      </div>
                    )}
                    {liftSummary.topBottleneck && (
                      <div className="mt-0.5 text-[11px]">
                        Dominant bottleneck: <strong>{formatBottleneck(liftSummary.topBottleneck)}</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="border border-border rounded-md p-2">
                  <div className="text-lg font-bold">{liftSummary.resourcesSucceeded}/{liftSummary.resourcesProcessed}</div>
                  <div className="text-muted-foreground">Succeeded</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalKiDelta > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                    {liftSummary.totalKiDelta > 0 ? '+' : ''}{liftSummary.totalKiDelta}
                  </div>
                  <div className="text-muted-foreground">Raw KI Delta</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalNetNewUnique > 0 ? "text-emerald-600" : "text-amber-500")}>
                    {liftSummary.totalNetNewUnique > 0 ? '+' : ''}{liftSummary.totalNetNewUnique}
                  </div>
                  <div className="text-muted-foreground">Net New Unique</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalNewActive > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                    {liftSummary.totalNewActive > 0 ? '+' : ''}{liftSummary.totalNewActive}
                  </div>
                  <div className="text-muted-foreground">New Active KIs</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalNewWithContext > 0 ? "text-emerald-600" : "text-muted-foreground")}>
                    {liftSummary.totalNewWithContext > 0 ? '+' : ''}{liftSummary.totalNewWithContext}
                  </div>
                  <div className="text-muted-foreground">New w/ Context</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className="text-lg font-bold text-primary">{liftSummary.depthUpgrades}</div>
                  <div className="text-muted-foreground">Depth Upgrades</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.noLiftCount > 0 ? "text-amber-500" : "text-muted-foreground")}>
                    {liftSummary.noLiftCount}
                  </div>
                  <div className="text-muted-foreground">No-Lift Runs</div>
                </div>
                <div className="border border-border rounded-md p-2 col-span-2">
                  <div className="text-muted-foreground text-[10px]">
                    {liftSummary.topNoLiftReason
                      ? `Top reason: ${formatNoLiftReason(liftSummary.topNoLiftReason)}`
                      : 'No no-lift reasons'}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground border-t border-border pt-2">
                <span>Avg KIs/1k before: <strong>{liftSummary.avgKisPer1kBefore}</strong></span>
                <span>→</span>
                <span>Avg KIs/1k after: <strong className={cn(
                  liftSummary.avgKisPer1kAfter > liftSummary.avgKisPer1kBefore ? "text-emerald-600" : "text-muted-foreground"
                )}>{liftSummary.avgKisPer1kAfter}</strong></span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Confirmation Modal */}
        <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-amber-500" />
                Confirm Deep Re-Extraction
              </DialogTitle>
              <DialogDescription className="space-y-2 pt-2">
                <p>This will run <strong>deep multi-pass extraction</strong> on {queued.length} resources:</p>
                <ul className="text-xs space-y-1 list-disc pl-4">
                  <li>Pass 1: Core Tactics</li>
                  <li>Pass 2: Hidden Insights</li>
                  <li>Pass 3: Framework Synthesis</li>
                  <li>Then merge + dedupe + activate</li>
                </ul>
                <div className="grid grid-cols-2 gap-2 pt-2 text-xs">
                  <div className="border border-border rounded p-2">
                    <div className="font-bold">{queued.length}</div>
                    <div className="text-muted-foreground">Resources</div>
                  </div>
                  <div className="border border-border rounded p-2">
                    <div className="font-bold">{(avgContentLength / 1000).toFixed(1)}k</div>
                    <div className="text-muted-foreground">Avg Content Length</div>
                  </div>
                  <div className="border border-border rounded p-2">
                    <div className="font-bold">{totalCurrentKIs}</div>
                    <div className="text-muted-foreground">Current Total KIs</div>
                  </div>
                  <div className="border border-border rounded p-2">
                    <div className="font-bold text-amber-500">~{Math.round(totalCurrentKIs * 0.5)}+</div>
                    <div className="text-muted-foreground">Est. KI Lift Target</div>
                  </div>
                </div>
                <p className="text-amber-600 text-xs pt-1">
                  ⚠️ Deep passes are slower and more expensive. Duplicate KIs will be automatically skipped.
                </p>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowConfirm(false)}>Cancel</Button>
              <Button onClick={() => { setShowConfirm(false); onRunDeepExtraction(); }}>
                <Zap className="h-4 w-4 mr-1" />
                Run Deep Extraction
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    </TooltipProvider>
  );
}
