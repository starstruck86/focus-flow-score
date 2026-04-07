/**
 * useDurableJobRehydration — on app mount, loads active jobs from the
 * background_jobs DB table into the Zustand store, and subscribes to
 * realtime updates so the UI stays in sync even after refresh/navigation.
 *
 * ARCHITECTURE:
 * - The `background_jobs` table is the DURABLE source of truth.
 * - Both enrichment and re-extract jobs now write terminal status server-side.
 * - No client-side polling is needed for terminal resolution.
 * - Realtime subscription keeps the UI in sync for all in-progress updates.
 */
import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAuth } from '@/contexts/AuthContext';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';
import { loadActiveJobs, subscribeToDurableJobs } from '@/lib/durableJobs';

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
        console.info(`[DURABLE JOBS] rehydrated ${jobs.length} jobs — no client polling needed, server owns terminal resolution`);
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
