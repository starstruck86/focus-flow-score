/**
 * BackgroundJobDrawer — slide-up drawer showing all background jobs.
 */
import {
  useBackgroundJobs,
  selectActiveJobs,
  selectReviewJobs,
  selectFailedJobs,
  selectCompletedJobs,
  type BackgroundJob,
  type JobStatus,
} from '@/store/useBackgroundJobs';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Inbox,
  Ban,
  Trash2,
  RefreshCw,
} from 'lucide-react';

const STATUS_META: Record<JobStatus, { icon: typeof Clock; color: string; label: string }> = {
  queued: { icon: Clock, color: 'text-muted-foreground', label: 'Queued' },
  running: { icon: Loader2, color: 'text-primary', label: 'Running' },
  awaiting_review: { icon: Inbox, color: 'text-amber-500', label: 'Review' },
  completed: { icon: CheckCircle2, color: 'text-emerald-500', label: 'Done' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Failed' },
  cancelled: { icon: Ban, color: 'text-muted-foreground', label: 'Cancelled' },
};

function JobRow({ job }: { job: BackgroundJob }) {
  const updateJob = useBackgroundJobs((s) => s.updateJob);
  const removeJob = useBackgroundJobs((s) => s.removeJob);
  const meta = STATUS_META[job.status];
  const Icon = meta.icon;
  const pct =
    job.progress && job.progress.total > 0
      ? Math.round((job.progress.current / job.progress.total) * 100)
      : undefined;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
      <Icon
        className={cn(
          'h-4 w-4 mt-0.5 shrink-0',
          meta.color,
          job.status === 'running' && 'animate-spin',
        )}
      />
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{job.title}</span>
          <Badge variant="outline" className="text-[10px] shrink-0">
            {job.type.replace(/_/g, ' ')}
          </Badge>
        </div>

        {job.substatus && (
          <span className="text-[11px] text-muted-foreground capitalize">
            {job.substatus.replace(/_/g, ' ')}
          </span>
        )}

        {pct !== undefined && job.status === 'running' && (
          <div className="flex items-center gap-2">
            <Progress value={pct} className="h-1.5 flex-1" />
            <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
          </div>
        )}

        {job.error && (
          <p className="text-[11px] text-destructive line-clamp-2">{job.error}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {job.status === 'running' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => updateJob(job.id, { status: 'cancelled' })}
            title="Cancel"
          >
            <Ban className="h-3.5 w-3.5" />
          </Button>
        )}
        {job.status === 'failed' && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => updateJob(job.id, { status: 'queued', error: undefined })}
            title="Retry"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        )}
        {(job.status === 'completed' || job.status === 'cancelled') && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => removeJob(job.id)}
            title="Dismiss"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function JobList({ jobs, empty }: { jobs: BackgroundJob[]; empty: string }) {
  if (jobs.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-8">{empty}</p>;
  }
  return (
    <div className="space-y-2">
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} />
      ))}
    </div>
  );
}

export function BackgroundJobDrawer() {
  const open = useBackgroundJobs((s) => s.drawerOpen);
  const setOpen = useBackgroundJobs((s) => s.setDrawerOpen);
  const clearCompleted = useBackgroundJobs((s) => s.clearCompleted);

  const active = useBackgroundJobs(selectActiveJobs);
  const review = useBackgroundJobs(selectReviewJobs);
  const failed = useBackgroundJobs(selectFailedJobs);
  const completed = useBackgroundJobs(selectCompletedJobs);

  return (
    <Drawer open={open} onOpenChange={setOpen}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="flex flex-row items-center justify-between">
          <div>
            <DrawerTitle>Background Jobs</DrawerTitle>
            <DrawerDescription>Track all running and completed tasks</DrawerDescription>
          </div>
          {completed.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearCompleted} className="text-xs">
              Clear done
            </Button>
          )}
        </DrawerHeader>

        <Tabs defaultValue="active" className="px-4 pb-4">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="active" className="text-xs">
              Active{active.length > 0 && ` (${active.length})`}
            </TabsTrigger>
            <TabsTrigger value="review" className="text-xs">
              Review{review.length > 0 && ` (${review.length})`}
            </TabsTrigger>
            <TabsTrigger value="failed" className="text-xs">
              Failed{failed.length > 0 && ` (${failed.length})`}
            </TabsTrigger>
            <TabsTrigger value="done" className="text-xs">
              Done{completed.length > 0 && ` (${completed.length})`}
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="mt-3 max-h-[55vh]">
            <TabsContent value="active" className="mt-0">
              <JobList jobs={active} empty="No active jobs" />
            </TabsContent>
            <TabsContent value="review" className="mt-0">
              <JobList jobs={review} empty="Nothing needs review" />
            </TabsContent>
            <TabsContent value="failed" className="mt-0">
              <JobList jobs={failed} empty="No failures" />
            </TabsContent>
            <TabsContent value="done" className="mt-0">
              <JobList jobs={completed} empty="No completed jobs" />
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DrawerContent>
    </Drawer>
  );
}
