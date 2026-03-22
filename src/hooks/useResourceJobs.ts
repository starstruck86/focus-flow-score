/**
 * React hooks for resource job tracking, pipeline execution, and realtime status.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  createResourceJob,
  runPipeline,
  retryJob,
  getJobWithSteps,
  getJobsForResource,
  type ResourceJob,
  type ResourceJobStep,
} from '@/lib/resourcePipeline';

export function useResourceJobs(resourceId: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['resource-jobs', resourceId],
    queryFn: () => getJobsForResource(resourceId),
    enabled: !!user && !!resourceId,
  });

  // Realtime subscription for job status changes
  useEffect(() => {
    if (!resourceId) return;
    const channel = supabase
      .channel(`resource-jobs-${resourceId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'resource_jobs',
        filter: `resource_id=eq.${resourceId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['resource-jobs', resourceId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [resourceId, queryClient]);

  return query;
}

export function useJobDetails(jobId: string | null) {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['resource-job-details', jobId],
    queryFn: () => getJobWithSteps(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const job = query.state.data?.job;
      return job?.status === 'running' ? 2000 : false;
    },
  });

  // Realtime for steps
  useEffect(() => {
    if (!jobId) return;
    const channel = supabase
      .channel(`job-steps-${jobId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'resource_job_steps',
        filter: `job_id=eq.${jobId}`,
      }, () => {
        queryClient.invalidateQueries({ queryKey: ['resource-job-details', jobId] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [jobId, queryClient]);

  return query;
}

export function useStartPipeline() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (resourceId: string) => {
      if (!user) throw new Error('Not authenticated');
      const job = await createResourceJob(resourceId, user.id);
      // Run in background — don't await
      runPipeline(job.id, {
        onStepComplete: (step) => {
          queryClient.invalidateQueries({ queryKey: ['resource-job-details', job.id] });
        },
      }).then(result => {
        queryClient.invalidateQueries({ queryKey: ['resource-jobs', resourceId] });
        queryClient.invalidateQueries({ queryKey: ['resources'] });
        queryClient.invalidateQueries({ queryKey: ['resource-digests'] });
        if (result.success) {
          toast.success('Resource processing completed');
        } else {
          toast.error(`Processing failed at: ${result.failedStep}`);
        }
      });
      return job;
    },
    onSuccess: (job) => {
      queryClient.invalidateQueries({ queryKey: ['resource-jobs', job.resource_id] });
      toast.info('Processing pipeline started…');
    },
    onError: (e: any) => toast.error(e.message || 'Failed to start pipeline'),
  });
}

export function useRetryJob() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ jobId, resourceId }: { jobId: string; resourceId: string }) => {
      const result = await retryJob(jobId);
      queryClient.invalidateQueries({ queryKey: ['resource-jobs', resourceId] });
      queryClient.invalidateQueries({ queryKey: ['resource-job-details', jobId] });
      return result;
    },
    onSuccess: (result) => {
      if (result.success) {
        toast.success('Retry completed successfully');
      } else {
        toast.error(`Retry failed at: ${result.failedStep}`);
      }
    },
    onError: (e: any) => toast.error(e.message || 'Retry failed'),
  });
}

export function useAllActiveJobs() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resource-jobs-active', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('resource_jobs')
        .select('*, resource_job_steps(*)')
        .in('status', ['queued', 'running', 'partial', 'failed'])
        .order('created_at', { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!user,
    refetchInterval: 10_000,
  });
}
