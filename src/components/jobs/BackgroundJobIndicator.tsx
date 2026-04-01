/**
 * BackgroundJobIndicator — persistent floating chip visible app-wide.
 * Shows summary of running / review / failed jobs. Clicks open the drawer.
 */
import { useBackgroundJobs, selectJobCounts } from '@/store/useBackgroundJobs';
import { useShallow } from 'zustand/react/shallow';
import { Loader2, AlertTriangle, CheckCircle2, Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

export function BackgroundJobIndicator() {
  const counts = useBackgroundJobs(useShallow(selectJobCounts));
  const toggleDrawer = useBackgroundJobs((s) => s.toggleDrawer);

  // Nothing to show
  if (counts.total === 0) return null;

  const hasActive = counts.active > 0;
  const hasFailed = counts.failed > 0;
  const hasReview = counts.review > 0;

  const segments: string[] = [];
  if (counts.active > 0) segments.push(`${counts.active} running`);
  if (counts.review > 0) segments.push(`${counts.review} review`);
  if (counts.failed > 0) segments.push(`${counts.failed} failed`);
  if (segments.length === 0 && counts.completed > 0) segments.push(`${counts.completed} done`);

  return (
    <button
      onClick={toggleDrawer}
      className={cn(
        'fixed bottom-20 right-4 z-50 flex items-center gap-2 rounded-full px-3.5 py-2 shadow-lg border',
        'bg-card text-card-foreground border-border',
        'hover:shadow-xl transition-shadow cursor-pointer',
        'md:bottom-6',
      )}
      aria-label="Background jobs"
    >
      {hasActive ? (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
      ) : hasFailed ? (
        <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
      ) : hasReview ? (
        <Inbox className="h-4 w-4 shrink-0 text-amber-500" />
      ) : (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
      )}
      <span className="text-xs font-medium whitespace-nowrap">{segments.join(' · ')}</span>
    </button>
  );
}
