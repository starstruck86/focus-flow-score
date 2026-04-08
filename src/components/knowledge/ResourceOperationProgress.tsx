/**
 * ResourceOperationProgress — shows a real progress bar for any active resource operation.
 * Reads from active_job_* fields on the resource row. Shows step label, percent, stall detection.
 */
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Loader2, AlertTriangle, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

const STALL_THRESHOLD_MS = 3 * 60 * 1000; // 3 minutes

interface ResourceOperationProgressProps {
  /** active_job_status from the resource row */
  status: string | null;
  /** active_job_type (e.g. extraction, enrichment) */
  jobType?: string | null;
  /** Current step label (e.g. extracting, validating, saving) */
  stepLabel?: string | null;
  /** 0-100 */
  progressPct?: number | null;
  /** e.g. 3 */
  progressCurrent?: number | null;
  /** e.g. 8 */
  progressTotal?: number | null;
  /** ISO timestamp of last heartbeat */
  updatedAt?: string | null;
  /** Compact mode for table rows */
  compact?: boolean;
}

const STEP_LABELS: Record<string, string> = {
  preparing: 'Preparing…',
  extracting: 'Extracting…',
  validating: 'Validating…',
  deduping: 'Deduplicating…',
  saving: 'Saving…',
  enriching: 'Enriching…',
  fetching: 'Fetching content…',
  parsing: 'Parsing…',
  completed: 'Completed',
};

const JOB_TYPE_LABELS: Record<string, string> = {
  extraction: 'Extraction',
  re_extraction: 'Re-extraction',
  deep_extraction: 'Deep extraction',
  enrichment: 'Enrichment',
  deep_enrichment: 'Deep enrichment',
};

function isStalled(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() > STALL_THRESHOLD_MS;
}

function formatElapsed(updatedAt: string | null): string | null {
  if (!updatedAt) return null;
  const ms = Date.now() - new Date(updatedAt).getTime();
  if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
  return `${Math.round(ms / 60_000)}m ago`;
}

/**
 * ── RENDER PRIORITY (progress component) ──
 * This component renders ONLY for active operations (running, queued, partial).
 * It returns null for all terminal states (succeeded, failed, idle, null),
 * ensuring no stale progress bars persist after work completes.
 * Stall detection is handled internally via heartbeat age.
 */
export function ResourceOperationProgress({
  status,
  jobType,
  stepLabel,
  progressPct,
  progressCurrent,
  progressTotal,
  updatedAt,
  compact = false,
}: ResourceOperationProgressProps) {
  if (!status || status === 'succeeded' || status === 'failed' || status === 'idle' || !['running', 'queued', 'partial'].includes(status)) {
    return null;
  }

  const stalled = status === 'running' && isStalled(updatedAt);
  const pct = progressPct ?? 0;
  const isDeterminate = progressTotal != null && progressTotal > 0;
  const step = stepLabel ? (STEP_LABELS[stepLabel] || stepLabel) : 'Processing…';
  const jobLabel = jobType ? (JOB_TYPE_LABELS[jobType] || jobType) : '';

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 min-w-[120px]">
        {stalled ? (
          <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin text-primary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          {isDeterminate ? (
            <Progress value={pct} className="h-1.5" />
          ) : (
            <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
              <div className="h-full w-1/3 bg-primary/60 rounded-full animate-pulse" />
            </div>
          )}
        </div>
        <span className={cn(
          "text-[9px] whitespace-nowrap shrink-0",
          stalled ? "text-amber-500" : "text-muted-foreground"
        )}>
          {stalled ? 'Stalled' : isDeterminate ? `${progressCurrent}/${progressTotal}` : step}
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          {stalled ? (
            <AlertTriangle className="h-3 w-3 text-amber-500" />
          ) : status === 'queued' ? (
            <Clock className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          )}
          <span className={cn(
            "text-[10px] font-medium",
            stalled ? "text-amber-500" : "text-foreground"
          )}>
            {stalled ? 'Stalled — no progress for 3m' : status === 'queued' ? 'Queued' : step}
          </span>
          {jobLabel && (
            <Badge variant="outline" className="text-[8px] h-4 px-1">
              {jobLabel}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
          {isDeterminate && (
            <span className="font-mono">{progressCurrent}/{progressTotal} · {pct}%</span>
          )}
          {updatedAt && (
            <span>{formatElapsed(updatedAt)}</span>
          )}
        </div>
      </div>
      {isDeterminate ? (
        <Progress value={pct} className="h-1.5" />
      ) : (
        <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
          <div className="h-full w-1/3 bg-primary/60 rounded-full animate-pulse" />
        </div>
      )}
    </div>
  );
}