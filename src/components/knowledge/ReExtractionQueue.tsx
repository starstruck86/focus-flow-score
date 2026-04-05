/**
 * Re-Extraction Queue — shows flagged resources with status tracking,
 * confirmation modal, coverage lift summary, and verification layer.
 */
import { useState } from 'react';
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
  Zap, Loader2, CheckCircle2, XCircle, AlertTriangle, TrendingUp, Trash2, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReExtractQueueItem, CoverageLiftSummary } from '@/hooks/useDeepReExtraction';

interface Props {
  queue: ReExtractQueueItem[];
  isRunning: boolean;
  liftSummary: CoverageLiftSummary | null;
  onRunDeepExtraction: () => void;
  onRemove: (resourceId: string) => void;
  onClear: () => void;
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  if (status === 'partial') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  if (status === 'failed') return <XCircle className="h-3.5 w-3.5 text-destructive" />;
  return <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30" />;
}

function DeltaCell({ value, label }: { value?: number; label?: string }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn(
      "font-mono font-bold",
      value > 0 ? "text-emerald-600" : value < 0 ? "text-destructive" : "text-muted-foreground"
    )}>
      {value > 0 ? `+${value}` : value}
      {label && <span className="font-normal text-muted-foreground ml-0.5">{label}</span>}
    </span>
  );
}

export function ReExtractionQueue({ queue, isRunning, liftSummary, onRunDeepExtraction, onRemove, onClear }: Props) {
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
                    <TableHead className="text-[10px]">Quality</TableHead>
                    <TableHead className="text-[10px] w-8"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queue.map(item => (
                    <TableRow key={item.resource_id}>
                      <TableCell><StatusIcon status={item.status} /></TableCell>
                      <TableCell>
                        <div className="text-[11px] max-w-[120px] truncate">{item.title}</div>
                        <div className="text-[9px] text-muted-foreground">
                          {(item.content_length / 1000).toFixed(1)}k chars
                        </div>
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
                      <TableCell className="text-[10px] max-w-[100px]">
                        {item.quality_label ? (
                          <Tooltip>
                            <TooltipTrigger>
                              <Badge variant="outline" className="text-[9px] border-amber-500/40 text-amber-600 gap-0.5">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Low
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-[200px] text-xs">
                              {item.quality_label}
                            </TooltipContent>
                          </Tooltip>
                        ) : item.status === 'completed' && (item.net_new_unique ?? 0) > 0 ? (
                          <Badge variant="outline" className="text-[9px] border-emerald-500/40 text-emerald-600">
                            ✓ Lift
                          </Badge>
                        ) : item.status === 'queued' ? (
                          <span className="text-muted-foreground truncate">{item.reason}</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {item.status === 'queued' && !isRunning && (
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => onRemove(item.resource_id)}>
                            <XCircle className="h-3 w-3 text-muted-foreground" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Coverage Lift Summary — with verification metrics */}
        {liftSummary && (
          <Card className="border-emerald-500/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-emerald-600" />
                Coverage Lift Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-2 text-center text-xs">
                <div className="border border-border rounded-md p-2">
                  <div className="text-lg font-bold">{liftSummary.resourcesSucceeded}/{liftSummary.resourcesProcessed}</div>
                  <div className="text-muted-foreground">Succeeded</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalKiDelta > 0 ? "text-emerald-600" : "")}>
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
                  <div className={cn("text-lg font-bold", liftSummary.totalNewActive > 0 ? "text-emerald-600" : "")}>
                    {liftSummary.totalNewActive > 0 ? '+' : ''}{liftSummary.totalNewActive}
                  </div>
                  <div className="text-muted-foreground">New Active KIs</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className={cn("text-lg font-bold", liftSummary.totalNewWithContext > 0 ? "text-emerald-600" : "")}>
                    {liftSummary.totalNewWithContext > 0 ? '+' : ''}{liftSummary.totalNewWithContext}
                  </div>
                  <div className="text-muted-foreground">New w/ Context</div>
                </div>
                <div className="border border-border rounded-md p-2">
                  <div className="text-lg font-bold text-primary">{liftSummary.depthUpgrades}</div>
                  <div className="text-muted-foreground">Depth Upgrades</div>
                </div>
              </div>
              <div className="mt-2 flex justify-between text-[11px] text-muted-foreground border-t border-border pt-2">
                <span>Avg KIs/1k before: <strong>{liftSummary.avgKisPer1kBefore}</strong></span>
                <span>→</span>
                <span>Avg KIs/1k after: <strong className="text-emerald-600">{liftSummary.avgKisPer1kAfter}</strong></span>
              </div>
              {liftSummary.totalKiDelta > 0 && liftSummary.totalNetNewUnique === 0 && (
                <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1 flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" />
                  No true lift — all delta was duplicates / overlap
                </div>
              )}
              {liftSummary.totalNetNewUnique > 0 && liftSummary.totalNewActive === 0 && (
                <div className="mt-2 text-[11px] text-amber-600 bg-amber-50 dark:bg-amber-950/20 rounded px-2 py-1 flex items-center gap-1">
                  <Info className="h-3 w-3" />
                  Low operational value — new KIs exist but none activated
                </div>
              )}
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
