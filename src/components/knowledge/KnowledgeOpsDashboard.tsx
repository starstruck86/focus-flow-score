/**
 * Knowledge Ops Dashboard — automated extraction pipeline control center.
 *
 * Replaces guided 1-by-1 extraction with batch pipeline controls,
 * blocked resource diagnostics, priority queues, and job history.
 */

import { useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Zap, Play, RotateCcw, Sparkles, Filter, Tag, RefreshCw,
  ChevronDown, XCircle, CheckCircle2, AlertTriangle, Clock,
  TrendingUp, Loader2, Ban, Search, ArrowUpRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useExtractionPipeline } from '@/hooks/useExtractionPipeline';
import {
  BLOCK_REASONS, QUEUE_LABELS, JOB_SCOPE_LABELS,
  type BlockReasonCode, type PipelineQueue, type JobScope,
} from '@/lib/extractionPipeline';

export function KnowledgeOpsDashboard() {
  const {
    runBatch, cancel, scoreAll, loadStats,
    isRunning, progress, lastResult, stats, isLoadingStats,
  } = useExtractionPipeline();

  const [jobHistoryOpen, setJobHistoryOpen] = useState(false);
  const [blockedDetailOpen, setBlockedDetailOpen] = useState(false);

  useEffect(() => { loadStats(); }, [loadStats]);

  const progressPct = progress ? Math.round((progress.current / progress.total) * 100) : 0;

  // Compute estimated knowledge gain
  const estimatedGain = useMemo(() => {
    if (!stats) return 0;
    return (stats.queueBreakdown['high_value_ready'] ?? 0) +
      Math.round((stats.queueBreakdown['high_value_recoverable'] ?? 0) * 0.5);
  }, [stats]);

  return (
    <div className="space-y-4">
      {/* Header Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Resources" value={stats?.total ?? '—'} />
        <StatCard label="Extracted" value={stats?.completed ?? '—'} color="green" />
        <StatCard label="Ready to Process" value={stats?.ready ?? '—'} color="blue" />
        <StatCard label="Blocked" value={stats?.blocked ?? '—'} color="red" />
      </div>

      {/* Pipeline Actions */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Extraction Pipeline
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={loadStats} disabled={isLoadingStats}>
              <RefreshCw className={cn("h-3.5 w-3.5", isLoadingStats && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Progress bar when running */}
          {isRunning && progress && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Processing: {progress.title?.slice(0, 40)}</span>
                <span>{progress.current}/{progress.total}</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <Button variant="outline" size="sm" onClick={cancel} className="text-xs">
                <XCircle className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          )}

          {/* Batch action buttons */}
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              icon={<Play className="h-3.5 w-3.5" />}
              label="Extract All Ready"
              description={`~${stats?.ready ?? 0} resources`}
              onClick={() => runBatch('all_ready')}
              disabled={isRunning}
            />
            <ActionButton
              icon={<TrendingUp className="h-3.5 w-3.5" />}
              label="Top Priority"
              description="Highest value first"
              onClick={() => runBatch('top_priority', { max: 50 })}
              disabled={isRunning}
            />
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Retry Recoverable"
              description={`${stats?.recoverableBlocked ?? 0} items`}
              onClick={() => runBatch('retry_recoverable')}
              disabled={isRunning}
            />
            <ActionButton
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label="Auto-Extract New"
              description="Unscored resources"
              onClick={() => runBatch('new_resources')}
              disabled={isRunning}
            />
          </div>

          {/* Score all button */}
          <Button
            variant="outline"
            size="sm"
            onClick={scoreAll}
            disabled={isRunning}
            className="w-full text-xs"
          >
            <Search className="h-3 w-3 mr-1.5" />
            Score & Classify All Resources
          </Button>

          {/* Estimated gain */}
          {estimatedGain > 0 && (
            <div className="flex items-center gap-2 text-xs bg-primary/10 text-primary rounded-md px-3 py-2">
              <ArrowUpRight className="h-3.5 w-3.5" />
              <span>~{estimatedGain} resources can be auto-extracted for knowledge gain</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Blocked Breakdown */}
      {stats && stats.pipelineBlocked > 0 && (
        <Collapsible open={blockedDetailOpen} onOpenChange={setBlockedDetailOpen}>
          <Card>
            <CollapsibleTrigger className="w-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--status-red))]" />
                    Pipeline Blockers ({stats.pipelineBlocked})
                    <Badge variant="outline" className="text-[10px]">
                      {stats.recoverableBlocked} recoverable · {stats.terminalBlocked} terminal
                    </Badge>
                  </CardTitle>
                  <ChevronDown className={cn("h-4 w-4 transition-transform", blockedDetailOpen && "rotate-180")} />
                </div>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="pt-0 space-y-2">
                {Object.entries(stats.blockedBreakdown).map(([reason, count]) => {
                  const meta = BLOCK_REASONS[reason as BlockReasonCode];
                  if (!meta || count === 0) return null;
                  return (
                    <div key={reason} className="flex items-center justify-between text-xs border border-border rounded-md px-3 py-2">
                      <div className="flex items-center gap-2">
                        {meta.terminal
                          ? <Ban className="h-3.5 w-3.5 text-[hsl(var(--status-red))]" />
                          : <RotateCcw className="h-3.5 w-3.5 text-[hsl(var(--status-yellow))]" />
                        }
                        <span className="font-medium">{meta.label}</span>
                        <span className="text-muted-foreground">— {meta.nextAction}</span>
                      </div>
                      <Badge variant={meta.terminal ? "destructive" : "outline"}>{count as number}</Badge>
                    </div>
                  );
                })}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* Queue Breakdown */}
      {stats && Object.keys(stats.queueBreakdown).length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              Pipeline Queues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(stats.queueBreakdown).map(([queue, count]) => (
                <div key={queue} className="flex items-center justify-between text-xs border border-border rounded-md px-3 py-2">
                  <span className="text-muted-foreground">{QUEUE_LABELS[queue as PipelineQueue] ?? queue}</span>
                  <Badge variant="outline">{count as number}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Last Batch Result */}
      {lastResult && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-green))]" />
              Last Batch Result
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-4 gap-2 text-center text-xs mb-3">
              <div><div className="text-lg font-bold">{lastResult.total}</div><div className="text-muted-foreground">Total</div></div>
              <div><div className="text-lg font-bold text-[hsl(var(--status-green))]">{lastResult.succeeded}</div><div className="text-muted-foreground">Extracted</div></div>
              <div><div className="text-lg font-bold text-[hsl(var(--status-red))]">{lastResult.failed}</div><div className="text-muted-foreground">Failed</div></div>
              <div><div className="text-lg font-bold text-[hsl(var(--status-yellow))]">{lastResult.skipped}</div><div className="text-muted-foreground">Skipped</div></div>
            </div>
            {lastResult.results.filter(r => r.outcome === 'failed').length > 0 && (
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {lastResult.results.filter(r => r.outcome === 'failed').slice(0, 10).map(r => (
                  <div key={r.resourceId} className="text-[11px] text-muted-foreground flex gap-1">
                    <XCircle className="h-3 w-3 text-[hsl(var(--status-red))] shrink-0 mt-0.5" />
                    <span className="truncate">{r.title}: {r.reason}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job History */}
      {stats && stats.recentJobs.length > 0 && (
        <Collapsible open={jobHistoryOpen} onOpenChange={setJobHistoryOpen}>
          <CollapsibleTrigger className="w-full">
            <div className="flex items-center justify-between text-xs text-muted-foreground border border-border rounded-md px-3 py-2">
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                Job History ({stats.recentJobs.length})
              </span>
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", jobHistoryOpen && "rotate-180")} />
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2 space-y-1">
            {stats.recentJobs.map((job: any) => (
              <div key={job.id} className="flex items-center justify-between text-[11px] border border-border rounded-md px-3 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant={job.status === 'completed' ? 'default' : job.status === 'running' ? 'secondary' : 'destructive'} className="text-[9px]">
                    {job.status}
                  </Badge>
                  <span className="text-muted-foreground">{JOB_SCOPE_LABELS[job.job_scope as JobScope] ?? job.job_scope}</span>
                </div>
                <span className="text-muted-foreground">
                  {job.success_count}/{job.total_resources} · {new Date(job.created_at).toLocaleDateString()}
                </span>
              </div>
            ))}
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: string | number; color?: 'green' | 'red' | 'blue' }) {
  const colorClass = color === 'green' ? 'text-[hsl(var(--status-green))]'
    : color === 'red' ? 'text-[hsl(var(--status-red))]'
    : color === 'blue' ? 'text-primary'
    : 'text-foreground';

  return (
    <Card>
      <CardContent className="p-3 text-center">
        <div className={cn("text-2xl font-bold", colorClass)}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function ActionButton({ icon, label, description, onClick, disabled }: {
  icon: React.ReactNode; label: string; description: string;
  onClick: () => void; disabled: boolean;
}) {
  return (
    <Button
      variant="outline"
      className="h-auto flex-col items-start gap-0.5 px-3 py-2.5 text-left"
      onClick={onClick}
      disabled={disabled}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        {disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
        {label}
      </div>
      <div className="text-[10px] text-muted-foreground">{description}</div>
    </Button>
  );
}
