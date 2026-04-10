/**
 * ProcessingQueuePanel — Real queue visualization panel.
 * Shows Running/Queued/Stalled jobs grouped with step labels, elapsed time, and type breakdown.
 */
import { useMemo } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Clock, AlertTriangle, RefreshCw, Activity,
  ChevronRight, Timer, Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { QueueJob, QueueSummary } from '@/hooks/useActiveJobQueue';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobs: QueueJob[];
  summary: QueueSummary;
  loading: boolean;
  onRefresh: () => void;
}

function formatElapsed(from: string | null): string {
  if (!from) return '—';
  const ms = Date.now() - new Date(from).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const STATUS_CONFIG = {
  running: { label: 'Running Now', icon: Loader2, color: 'text-primary', bg: 'bg-primary/10', iconClass: 'animate-spin' },
  queued: { label: 'Queued', icon: Clock, color: 'text-muted-foreground', bg: 'bg-muted/50', iconClass: '' },
  retrying: { label: 'Retrying', icon: RefreshCw, color: 'text-amber-600', bg: 'bg-amber-500/10', iconClass: '' },
  stalled: { label: 'Stalled', icon: AlertTriangle, color: 'text-destructive', bg: 'bg-destructive/10', iconClass: '' },
} as const;

function JobCard({ job }: { job: QueueJob }) {
  const config = STATUS_CONFIG[job.status];
  const Icon = config.icon;

  return (
    <div className={cn('rounded-lg border p-3 space-y-1.5', config.bg, 'border-border/50')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium truncate text-foreground">{job.resourceTitle}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <Badge variant="outline" className="text-[9px] h-4 font-normal">
              {job.jobType}
            </Badge>
            {job.stepLabel && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <ChevronRight className="h-2.5 w-2.5" />
                {job.stepLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Icon className={cn('h-3.5 w-3.5', config.color, config.iconClass)} />
          {job.status === 'running' && job.startedAt && (
            <span className="text-[10px] text-muted-foreground tabular-nums flex items-center gap-0.5">
              <Timer className="h-2.5 w-2.5" />
              {formatElapsed(job.startedAt)}
            </span>
          )}
        </div>
      </div>

      {/* Progress bar for jobs with progress */}
      {job.progressPercent != null && job.progressPercent > 0 && (
        <div className="space-y-0.5">
          <Progress value={job.progressPercent} className="h-1" />
          <div className="flex justify-between text-[9px] text-muted-foreground">
            <span>{job.progressPercent}%</span>
            {job.progressCurrent != null && job.progressTotal != null && (
              <span>{job.progressCurrent}/{job.progressTotal}</span>
            )}
          </div>
        </div>
      )}

      {/* Error for stalled/retrying */}
      {job.error && (job.status === 'stalled' || job.status === 'retrying') && (
        <p className="text-[10px] text-destructive truncate">{job.error}</p>
      )}

      {/* Queued timestamp */}
      {job.status === 'queued' && (
        <span className="text-[10px] text-muted-foreground">
          Queued at {formatTime(job.createdAt)}
        </span>
      )}

      {/* Stalled: last heartbeat */}
      {job.status === 'stalled' && (
        <span className="text-[10px] text-destructive flex items-center gap-0.5">
          <AlertTriangle className="h-2.5 w-2.5" />
          Last update {formatElapsed(job.updatedAt)} ago — no heartbeat
        </span>
      )}
    </div>
  );
}

function JobSection({ status, jobs }: { status: keyof typeof STATUS_CONFIG; jobs: QueueJob[] }) {
  if (jobs.length === 0) return null;
  const config = STATUS_CONFIG[status];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Icon className={cn('h-3.5 w-3.5', config.color, config.iconClass)} />
        <span className={cn('text-xs font-semibold', config.color)}>{config.label}</span>
        <Badge variant="secondary" className="text-[9px] h-4 ml-auto">{jobs.length}</Badge>
      </div>
      <div className="space-y-1.5">
        {jobs.map(j => <JobCard key={j.id} job={j} />)}
      </div>
    </div>
  );
}

export function ProcessingQueuePanel({ open, onOpenChange, jobs, summary, loading, onRefresh }: Props) {
  const grouped = useMemo(() => ({
    running: jobs.filter(j => j.status === 'running'),
    queued: jobs.filter(j => j.status === 'queued'),
    retrying: jobs.filter(j => j.status === 'retrying'),
    stalled: jobs.filter(j => j.status === 'stalled'),
  }), [jobs]);

  const sortedTypes = useMemo(() => 
    Object.entries(summary.byType)
      .sort((a, b) => b[1] - a[1]),
  [summary.byType]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[420px] sm:w-[480px] p-0 flex flex-col">
        <SheetHeader className="px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between">
            <SheetTitle className="text-sm flex items-center gap-2">
              <Activity className="h-4 w-4 text-primary" />
              Processing Queue
            </SheetTitle>
            <Button variant="ghost" size="sm" onClick={onRefresh} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </Button>
          </div>
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-4">
            {/* Summary header */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              {/* Counts row */}
              <div className="flex items-center gap-3 flex-wrap">
                <SumPill label="Total" count={summary.total} color="text-foreground" />
                <SumPill label="Running" count={summary.running} color="text-primary" />
                <SumPill label="Queued" count={summary.queued} color="text-muted-foreground" />
                {summary.retrying > 0 && <SumPill label="Retrying" count={summary.retrying} color="text-amber-600" />}
                {summary.stalled > 0 && <SumPill label="Stalled" count={summary.stalled} color="text-destructive" />}
              </div>

              {/* Type breakdown */}
              {sortedTypes.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Layers className="h-3 w-3 text-muted-foreground shrink-0" />
                  {sortedTypes.map(([type, count]) => (
                    <Badge key={type} variant="outline" className="text-[9px] h-4 font-normal">
                      {count} {type}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Empty state */}
            {summary.total === 0 && !loading && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No active jobs in the pipeline.
              </div>
            )}

            {/* Grouped sections */}
            <JobSection status="running" jobs={grouped.running} />
            <JobSection status="stalled" jobs={grouped.stalled} />
            <JobSection status="retrying" jobs={grouped.retrying} />
            <JobSection status="queued" jobs={grouped.queued} />
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function SumPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className={cn('text-base font-bold tabular-nums', color)}>{count}</span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
    </div>
  );
}
