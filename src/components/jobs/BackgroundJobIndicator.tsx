/**
 * BackgroundJobIndicator — persistent floating chip visible app-wide.
 * Shows the top active job with real progress bar, step label, and elapsed time.
 * Clicks open the drawer for full job list.
 */
import { useEffect, useState } from 'react';
import { useBackgroundJobs, selectActiveJobs, selectJobCounts, getJobPercent, formatElapsed } from '@/store/useBackgroundJobs';
import { useShallow } from 'zustand/react/shallow';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertTriangle, CheckCircle2, Inbox, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BackgroundJobIndicator() {
  const counts = useBackgroundJobs(useShallow(selectJobCounts));
  const activeJobs = useBackgroundJobs(useShallow(selectActiveJobs));
  const toggleDrawer = useBackgroundJobs((s) => s.toggleDrawer);

  // Tick every second for elapsed time
  const [, setTick] = useState(0);
  useEffect(() => {
    if (counts.total === 0) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [counts.total]);

  if (counts.total === 0) return null;

  const hasActive = counts.active > 0;
  const hasFailed = counts.failed > 0;
  const hasReview = counts.review > 0;
  const topJob = activeJobs[0];

  const segments: string[] = [];
  if (counts.active > 0) segments.push(`${counts.active} running`);
  if (counts.review > 0) segments.push(`${counts.review} review`);
  if (counts.failed > 0) segments.push(`${counts.failed} failed`);
  if (segments.length === 0 && counts.completed > 0) segments.push(`${counts.completed} done`);

  const topPct = topJob ? getJobPercent(topJob) : undefined;
  const isDeterminate = topJob?.progressMode === 'determinate' && topPct != null;

  return (
    <button
      onClick={toggleDrawer}
      className={cn(
        'fixed bottom-20 right-4 z-50 flex flex-col gap-1 rounded-2xl px-3.5 py-2.5 shadow-lg border',
        'bg-card text-card-foreground border-border',
        'hover:shadow-xl transition-shadow cursor-pointer',
        'md:bottom-6',
        'min-w-[200px] max-w-[280px]',
      )}
      aria-label="Background jobs"
    >
      {/* Header row */}
      <div className="flex items-center gap-2 w-full">
        {hasActive ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : hasFailed ? (
          <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
        ) : hasReview ? (
          <Inbox className="h-4 w-4 shrink-0 text-amber-500" />
        ) : (
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
        )}
        <span className="text-xs font-medium whitespace-nowrap truncate flex-1 text-left">
          {topJob ? topJob.title : segments.join(' · ')}
        </span>
        {topJob && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {formatElapsed(topJob.createdAt)}
          </span>
        )}
        <ChevronUp className="h-3 w-3 shrink-0 text-muted-foreground" />
      </div>

      {/* Progress bar for top active job */}
      {topJob && hasActive && (
        <>
          {isDeterminate ? (
            <div className="flex items-center gap-2 w-full">
              <Progress value={topPct} className="h-1.5 flex-1" />
              <span className="text-[10px] text-muted-foreground w-8 text-right">{topPct}%</span>
            </div>
          ) : (
            <div className="w-full h-1.5 rounded-full bg-secondary overflow-hidden">
              <div className="h-full w-1/3 rounded-full bg-primary animate-pulse" 
                style={{ animation: 'indeterminate-slide 1.5s ease-in-out infinite' }} />
            </div>
          )}
        </>
      )}

      {/* Step label */}
      {topJob?.stepLabel && (
        <span className="text-[10px] text-muted-foreground text-left w-full truncate">
          {topJob.stepLabel}
        </span>
      )}

      {/* Multi-job summary */}
      {counts.active > 1 && (
        <span className="text-[10px] text-muted-foreground text-left w-full">
          +{counts.active - 1} more job{counts.active > 2 ? 's' : ''}
        </span>
      )}
    </button>
  );
}
