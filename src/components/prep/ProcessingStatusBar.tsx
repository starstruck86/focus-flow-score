/**
 * ProcessingStatusBar — Global "Processing Now" summary.
 * Shows active processing count, batch progress, stage breakdown, and stuck detection.
 * Reads from both Zustand live state and durable resource `active_job_*` columns.
 */
import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Loader2, Activity, CheckCircle2, AlertTriangle,
  Clock, Zap, RefreshCw, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useResourceJobProgress, getJobLabel, isJobStale } from '@/store/useResourceJobProgress';
import type { Resource } from '@/hooks/useResources';

interface Props {
  resources: Resource[];
}

interface ProcessingSummary {
  activeCount: number;
  stuckCount: number;
  byStage: { label: string; count: number; color: string }[];
  batchActive: boolean;
  batchTotal: number;
  batchProcessed: number;
  batchPct: number;
  batchJobType: string | null;
  batchDone: number;
  batchFailed: number;
  batchQueued: number;
}

export function ProcessingStatusBar({ resources }: Props) {
  const liveJobs = useResourceJobProgress(s => s.resources);
  const batchActive = useResourceJobProgress(s => s.batchActive);
  const batchTotal = useResourceJobProgress(s => s.batchTotal);
  const batchProcessed = useResourceJobProgress(s => s.batchProcessed);
  const batchJobType = useResourceJobProgress(s => s.batchJobType);

  const summary = useMemo<ProcessingSummary>(() => {
    let activeCount = 0;
    let stuckCount = 0;
    const stages: Record<string, number> = {};
    let batchDone = 0;
    let batchFailed = 0;
    let batchQueued = 0;

    // Count from live Zustand store
    for (const [, entry] of Object.entries(liveJobs)) {
      if (entry.status === 'running') {
        activeCount++;
        const label = getJobLabel(entry.jobType, 'running');
        stages[label] = (stages[label] ?? 0) + 1;
      }
      if (entry.status === 'done') batchDone++;
      if (entry.status === 'failed') batchFailed++;
      if (entry.status === 'queued') batchQueued++;
    }

    // Count from durable DB state (resources with active_job_status = 'running')
    for (const r of resources) {
      const rAny = r as any;
      if (rAny.active_job_status === 'running') {
        // Don't double-count if already in live jobs
        if (!liveJobs[r.id] || liveJobs[r.id].status !== 'running') {
          activeCount++;
          const label = rAny.active_job_type
            ? getJobLabel(rAny.active_job_type, 'running')
            : 'Processing…';
          stages[label] = (stages[label] ?? 0) + 1;
        }
        // Check for stuck
        if (isJobStale(rAny.active_job_updated_at, 'running')) {
          stuckCount++;
        }
      }
    }

    // Also check enrichment_status running states
    for (const r of resources) {
      const s = r.enrichment_status;
      if (
        s === 'deep_enrich_in_progress' ||
        s === 'reenrich_in_progress' ||
        s === 'queued_for_deep_enrich' ||
        s === 'queued_for_reenrich'
      ) {
        if (!liveJobs[r.id] || liveJobs[r.id].status !== 'running') {
          const rAny = r as any;
          if (rAny.active_job_status !== 'running') {
            activeCount++;
            const label = s.includes('enrich') ? 'Enriching…' : 'Processing…';
            stages[label] = (stages[label] ?? 0) + 1;
          }
        }
      }
    }

    const byStage = Object.entries(stages)
      .sort((a, b) => b[1] - a[1])
      .map(([label, count]) => ({
        label,
        count,
        color: label.includes('Extract') ? 'text-primary' : label.includes('Enrich') ? 'text-amber-600' : 'text-muted-foreground',
      }));

    const batchPct = batchTotal > 0 ? Math.round((batchProcessed / batchTotal) * 100) : 0;

    return {
      activeCount,
      stuckCount,
      byStage,
      batchActive,
      batchTotal,
      batchProcessed,
      batchPct,
      batchJobType,
      batchDone,
      batchFailed,
      batchQueued,
    };
  }, [resources, liveJobs, batchActive, batchTotal, batchProcessed, batchJobType]);

  // Nothing processing — don't show
  if (summary.activeCount === 0 && !summary.batchActive) return null;

  return (
    <div className="border border-border rounded-lg px-3 py-2 bg-primary/5 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          <span className="text-xs font-semibold text-foreground">Processing</span>
        </div>
        <Badge variant="secondary" className="text-[9px] h-4">
          {summary.activeCount} active
        </Badge>
        {summary.stuckCount > 0 && (
          <Badge className="text-[9px] h-4 bg-destructive/10 text-destructive">
            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
            {summary.stuckCount} stuck
          </Badge>
        )}
        {/* Stage breakdown */}
        {summary.byStage.length > 0 && (
          <div className="flex items-center gap-2 ml-auto text-[10px]">
            {summary.byStage.map(s => (
              <span key={s.label} className={cn('font-medium', s.color)}>
                {s.count} {s.label.replace('…', '')}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Batch progress */}
      {summary.batchActive && summary.batchTotal > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px]">
            <Activity className="h-3 w-3 text-primary" />
            <span className="text-muted-foreground">
              Batch {summary.batchJobType ? getJobLabel(summary.batchJobType, 'running').replace('…', '') : 'Operation'}
            </span>
            <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />
            <span className="font-medium text-foreground">
              {summary.batchProcessed}/{summary.batchTotal}
            </span>
            <span className="text-muted-foreground">({summary.batchPct}%)</span>
            {summary.batchDone > 0 && (
              <span className="text-emerald-600 flex items-center gap-0.5">
                <CheckCircle2 className="h-2.5 w-2.5" /> {summary.batchDone}
              </span>
            )}
            {summary.batchFailed > 0 && (
              <span className="text-destructive flex items-center gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" /> {summary.batchFailed}
              </span>
            )}
            {summary.batchQueued > 0 && (
              <span className="text-muted-foreground flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" /> {summary.batchQueued} queued
              </span>
            )}
          </div>
          <Progress value={summary.batchPct} className="h-1.5" />
        </div>
      )}
    </div>
  );
}
