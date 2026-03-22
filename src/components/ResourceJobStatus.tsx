/**
 * ResourceJobStatus — shows pipeline progress for a resource.
 * Displays steps, their status, errors, and retry controls.
 */

import { useState } from 'react';
import { useResourceJobs, useJobDetails, useRetryJob, useStartPipeline } from '@/hooks/useResourceJobs';
import { PIPELINE_STEPS, type JobStatus, type StepStatus } from '@/lib/resourcePipeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { Play, RefreshCw, ChevronDown, CheckCircle, XCircle, Loader2, Clock, AlertTriangle, Zap } from 'lucide-react';

const STATUS_CONFIG: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  completed: { icon: CheckCircle, color: 'text-emerald-500', label: 'Done' },
  running: { icon: Loader2, color: 'text-primary', label: 'Running' },
  failed: { icon: XCircle, color: 'text-destructive', label: 'Failed' },
  pending: { icon: Clock, color: 'text-muted-foreground', label: 'Pending' },
  skipped: { icon: Clock, color: 'text-muted-foreground/50', label: 'Skipped' },
  queued: { icon: Clock, color: 'text-muted-foreground', label: 'Queued' },
  partial: { icon: AlertTriangle, color: 'text-amber-500', label: 'Partial' },
};

function StepRow({ step }: { step: { step_name: string; status: string; error_category?: string | null; error_message?: string | null; retry_count: number } }) {
  const config = STATUS_CONFIG[step.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;
  const label = PIPELINE_STEPS.find(s => s.name === step.step_name)?.label || step.step_name;

  return (
    <div className="flex items-center gap-2 py-1.5">
      <Icon className={cn('h-4 w-4 shrink-0', config.color, step.status === 'running' && 'animate-spin')} />
      <span className="text-sm flex-1">{label}</span>
      {step.retry_count > 0 && (
        <Badge variant="outline" className="text-[10px]">retry {step.retry_count}</Badge>
      )}
      {step.error_category && (
        <Badge variant="outline" className="text-[10px] text-destructive border-destructive/30">
          {step.error_category}
        </Badge>
      )}
    </div>
  );
}

export function ResourceJobStatus({ resourceId }: { resourceId: string }) {
  const { data: jobs, isLoading } = useResourceJobs(resourceId);
  const startPipeline = useStartPipeline();
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  if (isLoading) return null;

  const latestJob = jobs?.[0];
  const hasActiveJob = latestJob && ['queued', 'running'].includes(latestJob.status);

  return (
    <div className="space-y-2">
      {/* Start pipeline button — only if no active job */}
      {!hasActiveJob && (
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => startPipeline.mutate(resourceId)}
          disabled={startPipeline.isPending}
        >
          <Zap className="h-3.5 w-3.5" />
          {latestJob?.status === 'failed' || latestJob?.status === 'partial'
            ? 'Reprocess Resource'
            : 'Process Resource (Full Pipeline)'}
        </Button>
      )}

      {/* Job list */}
      {jobs?.map(job => (
        <JobCard
          key={job.id}
          job={job}
          resourceId={resourceId}
          expanded={expandedJobId === job.id}
          onToggle={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
        />
      ))}
    </div>
  );
}

function JobCard({
  job,
  resourceId,
  expanded,
  onToggle,
}: {
  job: { id: string; status: string; trace_id: string; error_category?: string | null; error_message?: string | null; retry_count: number; created_at: string };
  resourceId: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data: details } = useJobDetails(expanded ? job.id : null);
  const retryJob = useRetryJob();
  const config = STATUS_CONFIG[job.status] || STATUS_CONFIG.pending;
  const Icon = config.icon;

  return (
    <Card className="overflow-hidden">
      <Collapsible open={expanded} onOpenChange={onToggle}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="py-2.5 px-3 flex flex-row items-center gap-2">
            <Icon className={cn('h-4 w-4 shrink-0', config.color, job.status === 'running' && 'animate-spin')} />
            <span className="text-sm font-medium flex-1 text-left">{config.label}</span>
            <span className="text-[10px] text-muted-foreground font-mono">{job.trace_id}</span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="px-3 pb-3 pt-0 space-y-2">
            {details?.steps.map(step => (
              <StepRow key={step.id} step={step} />
            ))}

            {job.error_message && (
              <div className="text-xs text-destructive bg-destructive/5 rounded p-2 font-mono break-words">
                {job.error_message}
              </div>
            )}

            {(job.status === 'failed' || job.status === 'partial') && (
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2"
                onClick={() => retryJob.mutate({ jobId: job.id, resourceId })}
                disabled={retryJob.isPending}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', retryJob.isPending && 'animate-spin')} />
                Retry from failed step
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
