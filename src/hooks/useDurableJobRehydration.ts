/**
 * useDurableJobRehydration — on app mount, loads active jobs from the
 * background_jobs DB table into the Zustand store, and subscribes to
 * realtime updates so the UI stays in sync even after refresh/navigation.
 *
 * For re-extract jobs that are still "running" after rehydration, starts
 * a lightweight poll loop against the resources table to detect terminal state
 * and update the durable job row accordingly.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBackgroundJobs, type BackgroundJob } from '@/store/useBackgroundJobs';
import { loadActiveJobs, subscribeToDurableJobs, updateDurableJob, finalizeDurableJob } from '@/lib/durableJobs';
import { supabase } from '@/integrations/supabase/client';

const RESUME_POLL_INTERVAL = 4000;
const RESUME_POLL_TIMEOUT = 5 * 60_000;

/** For rehydrated running re-extract jobs, poll the resource for terminal state */
function startResumePoll(job: BackgroundJob, updateJob: (id: string, patch: any) => void) {
  if (!job.entityId) return;
  const resourceId = job.entityId;
  const jobId = job.id;
  let stopped = false;
  const deadline = Date.now() + RESUME_POLL_TIMEOUT;

  console.info(`[DURABLE JOBS] resuming poll for rehydrated job "${jobId}" (resource=${resourceId})`);

  const poll = async () => {
    while (!stopped && Date.now() < deadline) {
      try {
        const { data } = await supabase
          .from('resources' as any)
          .select('active_job_status, last_extraction_run_status, current_resource_ki_count, extraction_batches_completed, extraction_batch_total, last_extraction_summary')
          .eq('id', resourceId)
          .single();

        if (!data) break;

        const d = data as any;
        const batchTotal = d.extraction_batch_total ?? 0;
        const batchDone = d.extraction_batches_completed ?? 0;

        // Update progress in store
        if (batchTotal > 1) {
          updateJob(jobId, {
            progressMode: 'determinate' as const,
            progress: { current: batchDone, total: batchTotal },
            progressPercent: Math.round((batchDone / batchTotal) * 100),
            stepLabel: `Batch ${batchDone} of ${batchTotal}`,
            substatus: 'extracting',
          });
        } else {
          updateJob(jobId, {
            stepLabel: `Polling… (${d.active_job_status || 'checking'})`,
            substatus: 'polling',
          });
        }

        // Check terminal
        if (d.active_job_status === 'succeeded' || d.last_extraction_run_status === 'completed') {
          console.info(`[DURABLE JOBS] resume poll: job "${jobId}" → completed`);
          updateJob(jobId, {
            status: 'completed' as const,
            progressPercent: 100,
            stepLabel: `Completed (${d.current_resource_ki_count ?? '?'} KIs)`,
            substatus: undefined,
          });
          stopped = true;
          return;
        }

        if (d.active_job_status === 'failed' || d.last_extraction_run_status === 'failed') {
          console.info(`[DURABLE JOBS] resume poll: job "${jobId}" → failed`);
          updateJob(jobId, {
            status: 'failed' as const,
            error: d.last_extraction_summary || 'Extraction failed',
            stepLabel: 'Failed',
            substatus: undefined,
          });
          stopped = true;
          return;
        }
      } catch (err) {
        console.warn(`[DURABLE JOBS] resume poll error for "${jobId}":`, err);
      }

      await new Promise(r => setTimeout(r, RESUME_POLL_INTERVAL));
    }

    if (!stopped) {
      console.warn(`[DURABLE JOBS] resume poll timed out for "${jobId}"`);
      updateJob(jobId, { stepLabel: 'Still processing in background…', substatus: 'waiting_continuation' });
    }
  };

  poll();
}

export function useDurableJobRehydration() {
  const { user } = useAuth();
  const rehydrateJobs = useBackgroundJobs((s) => s.rehydrateJobs);
  const syncJobFromDB = useBackgroundJobs((s) => s.syncJobFromDB);
  const updateJob = useBackgroundJobs((s) => s.updateJob);
  const removeJob = useBackgroundJobs((s) => s.removeJob);
  const rehydrated = useBackgroundJobs((s) => s.rehydrated);
  const subRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    if (!rehydrated) {
      loadActiveJobs(user.id).then((jobs) => {
        rehydrateJobs(jobs);

        // Resume polling for any running re-extract jobs
        for (const job of jobs) {
          if ((job.status === 'running' || job.status === 'queued') && job.type === 're_extraction' && job.entityId) {
            startResumePoll(job, updateJob);
          }
        }
      }).catch((err) => {
        console.error('[DURABLE JOBS] rehydration error:', err);
      });
    }

    if (!subRef.current) {
      subRef.current = subscribeToDurableJobs(
        user.id,
        (job) => syncJobFromDB(job),
        (jobId) => removeJob(jobId),
      );
    }

    return () => {
      if (subRef.current) {
        subRef.current();
        subRef.current = null;
      }
    };
  }, [user?.id]);

  return { rehydrated };
}
