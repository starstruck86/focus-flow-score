/**
 * useDurableJobRehydration — on app mount, loads active jobs from the
 * background_jobs DB table into the Zustand store, and subscribes to
 * realtime updates so the UI stays in sync even after refresh/navigation.
 */
import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useBackgroundJobs } from '@/store/useBackgroundJobs';
import { loadActiveJobs, subscribeToDurableJobs } from '@/lib/durableJobs';

export function useDurableJobRehydration() {
  const { user } = useAuth();
  const rehydrateJobs = useBackgroundJobs((s) => s.rehydrateJobs);
  const syncJobFromDB = useBackgroundJobs((s) => s.syncJobFromDB);
  const removeJob = useBackgroundJobs((s) => s.removeJob);
  const rehydrated = useBackgroundJobs((s) => s.rehydrated);
  const subRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!user?.id) return;

    // Only rehydrate once per session (avoid re-fetching on every re-render)
    if (!rehydrated) {
      loadActiveJobs(user.id).then((jobs) => {
        rehydrateJobs(jobs);
      }).catch((err) => {
        console.error('[DURABLE JOBS] rehydration error:', err);
      });
    }

    // Subscribe to realtime updates
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
