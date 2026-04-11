/**
 * Job lifecycle observer — wraps existing job store transitions with telemetry.
 *
 * This is a pure observation layer. It reads from existing store actions
 * and records telemetry events. It does NOT modify job behavior.
 *
 * Usage: call `installJobObserver()` once at app startup.
 */

import { useBackgroundJobs, type BackgroundJob, type JobStatus } from '@/store/useBackgroundJobs';
import { recordTelemetryEvent } from './telemetry';

const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

/** Observe the Zustand store and emit telemetry on state changes */
export function installJobObserver(): (() => void) {
  let previousJobs: BackgroundJob[] = [];

  const unsubscribe = useBackgroundJobs.subscribe((state) => {
    try {
      const currentJobs = state.jobs;

      for (const job of currentJobs) {
        const prev = previousJobs.find(j => j.id === job.id);

        if (!prev) {
          // New job appeared
          recordTelemetryEvent('job:created', {
            jobId: job.id,
            type: job.type,
            status: job.status,
            title: job.title,
            entityId: job.entityId,
          });
          continue;
        }

        // Status changed
        if (prev.status !== job.status) {
          const eventType = mapStatusToEventType(prev.status, job.status);
          recordTelemetryEvent(eventType, {
            jobId: job.id,
            type: job.type,
            from: prev.status,
            to: job.status,
            title: job.title,
            error: job.error,
            stepLabel: job.stepLabel,
          });
        }

        // Progress updated
        if (job.progressPercent !== prev.progressPercent || job.stepLabel !== prev.stepLabel) {
          recordTelemetryEvent('job:progress', {
            jobId: job.id,
            type: job.type,
            percent: job.progressPercent,
            stepLabel: job.stepLabel,
            substatus: job.substatus,
          });
        }

        // Stuck detection: running for > threshold with no update
        if (
          (job.status === 'running' || job.status === 'queued') &&
          Date.now() - job.updatedAt > STALE_THRESHOLD_MS
        ) {
          recordTelemetryEvent('job:stuck', {
            jobId: job.id,
            type: job.type,
            status: job.status,
            staleDurationMs: Date.now() - job.updatedAt,
            stepLabel: job.stepLabel,
          });
        }
      }

      // Detect removed jobs
      for (const prev of previousJobs) {
        if (!currentJobs.find(j => j.id === prev.id)) {
          recordTelemetryEvent('job:cancelled', {
            jobId: prev.id,
            type: prev.type,
            lastStatus: prev.status,
            reason: 'removed_from_store',
          });
        }
      }

      previousJobs = [...currentJobs];
    } catch {
      // Never disrupt the store subscription
    }
  });

  return unsubscribe;
}

function mapStatusToEventType(from: JobStatus, to: JobStatus): string {
  switch (to) {
    case 'queued': return from === 'failed' || from === 'cancelled' ? 'job:retried' : 'job:queued';
    case 'running': return 'job:started';
    case 'completed': return 'job:completed';
    case 'failed': return 'job:failed';
    case 'cancelled': return 'job:cancelled';
    case 'awaiting_review': return 'job:completed';
    default: return 'state:transition';
  }
}
