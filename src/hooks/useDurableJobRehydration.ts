/**
 * useDurableJobRehydration — on app mount, loads active jobs from the
 * background_jobs DB table into the Zustand store, and subscribes to
 * realtime updates so the UI stays in sync even after refresh/navigation.
 *
 * For re-extract jobs that are still "running" after rehydration, starts
 * a lightweight poll loop against the resources table to detect terminal state.
 * For enrichment jobs still "running", starts a poll against background_jobs itself
 * (since the backend runner updates that row directly).
 */
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/contexts/AuthContext';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';
import { loadActiveJobs, subscribeToDurableJobs } from '@/lib/durableJobs';
import { supabase } from '@/integrations/supabase/client';
import type { BackgroundJob } from '@/store/useBackgroundJobs';

const RESUME_POLL_INTERVAL = 4000;
const RESUME_POLL_TIMEOUT = 5 * 60_000;

/** For rehydrated running re-extract jobs, poll the resource for terminal state */
function startReExtractResumePoll(job: BackgroundJob, updateJob: (id: string, patch: any) => void) {
  if (!job.entityId) return;
  const resourceId = job.entityId;
  const jobId = job.id;
  let stopped = false;
  const deadline = Date.now() + RESUME_POLL_TIMEOUT;

  console.info(`[DURABLE JOBS] resuming poll for rehydrated re-extract job "${jobId}"`);

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

        if (batchTotal > 1) {
          updateJob(jobId, {
            progressMode: 'determinate' as const,
            progress: { current: batchDone, total: batchTotal },
            progressPercent: Math.round((batchDone / batchTotal) * 100),
            stepLabel: `Batch ${batchDone} of ${batchTotal}`,
            substatus: 'extracting',
          });
        }

        if (d.active_job_status === 'succeeded' || d.last_extraction_run_status === 'completed') {
          updateJob(jobId, { status: 'completed' as const, progressPercent: 100, stepLabel: `Completed (${d.current_resource_ki_count ?? '?'} KIs)` });
          stopped = true;
          return;
        }
        if (d.active_job_status === 'failed' || d.last_extraction_run_status === 'failed') {
          updateJob(jobId, { status: 'failed' as const, error: d.last_extraction_summary || 'Extraction failed', stepLabel: 'Failed' });
          stopped = true;
          return;
        }
      } catch (err) {
        console.warn(`[DURABLE JOBS] resume poll error for "${jobId}":`, err);
      }
      await new Promise(r => setTimeout(r, RESUME_POLL_INTERVAL));
    }
  };

  poll();
}

export function useDurableJobRehydration() {
  const { user } = useAuth();

  // Single selector to avoid changing hook count across renders
  const actions = useBackgroundJobs(useShallow((s) => ({
    rehydrateJobs: s.rehydrateJobs,
    syncJobFromDB: s.syncJobFromDB,
    updateJob: s.updateJob,
    removeJob: s.removeJob,
    rehydrated: s.rehydrated,
  })));

  const subRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    if (!actions.rehydrated) {
      loadActiveJobs(user.id).then((jobs) => {
        actions.rehydrateJobs(jobs);

        // Resume polling for any running jobs
        for (const job of jobs) {
          if ((job.status === 'running' || job.status === 'queued') && job.entityId) {
            if (job.type === 're_extraction') {
              startReExtractResumePoll(job, actions.updateJob);
            }
            // Enrichment jobs: the backend runner updates background_jobs directly,
            // so realtime subscription handles it — no client-side poll needed.
          }
        }
      }).catch((err) => {
        console.error('[DURABLE JOBS] rehydration error:', err);
      });
    }

    if (!subRef.current) {
      subRef.current = subscribeToDurableJobs(
        user.id,
        (job) => actions.syncJobFromDB(job),
        (jobId) => actions.removeJob(jobId),
      );
    }

    return () => {
      if (subRef.current) {
        subRef.current();
        subRef.current = null;
      }
    };
  }, [user?.id]);

  return { rehydrated: actions.rehydrated };
}
