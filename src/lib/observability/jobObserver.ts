/**
 * Job lifecycle observer — wraps existing job store transitions with telemetry.
 *
 * This is a pure observation layer. It reads from existing store actions
 * and records telemetry events. It does NOT modify job behavior.
 *
 * IMPORTANT: Telemetry is session-local, in-memory, non-persistent, best-effort.
 *
 * Usage: call `installJobObserver()` once at app startup.
 * Hard singleton — safe across remounts, hot reload, and StrictMode.
 */

import { useBackgroundJobs, type BackgroundJob, type JobStatus } from '@/store/useBackgroundJobs';
import { recordTelemetryEvent } from './telemetry';

const STALE_THRESHOLD_MS = 5 * 60_000; // 5 minutes

/** Singleton guard — prevents double-install across HMR / StrictMode */
let installedUnsubscribe: (() => void) | null = null;

/** Set of job IDs already reported as stuck, to avoid spamming */
const reportedStuckJobs = new Set<string>();

/** Observe the Zustand store and emit telemetry on state changes */
export function installJobObserver(): (() => void) {
  // Hard singleton: if already installed, return existing teardown
  if (installedUnsubscribe) {
    return installedUnsubscribe;
  }

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
          // Job is no longer stuck if status changed
          reportedStuckJobs.delete(job.id);

          const eventType = mapStatusToEventType(prev.status, job.status) as import('./telemetry').TelemetryEventType;
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

        // Stuck detection: running for > threshold with no update (deduped)
        if (
          (job.status === 'running' || job.status === 'queued') &&
          !reportedStuckJobs.has(job.id)
        ) {
          const updatedAt = typeof job.updatedAt === 'number' ? job.updatedAt : Number(job.updatedAt);
          if (Number.isFinite(updatedAt) && updatedAt > 0) {
            const staleDuration = Date.now() - updatedAt;
            if (staleDuration > STALE_THRESHOLD_MS) {
              reportedStuckJobs.add(job.id);
              recordTelemetryEvent('job:stuck', {
                jobId: job.id,
                type: job.type,
                status: job.status,
                staleDurationMs: staleDuration,
                stepLabel: job.stepLabel,
              });
            }
          }
          // If updatedAt is invalid/missing, skip stale detection silently
        }
      }

      // Detect removed jobs — record as removal, not cancellation
      for (const prev of previousJobs) {
        if (!currentJobs.find(j => j.id === prev.id)) {
          reportedStuckJobs.delete(prev.id);
          recordTelemetryEvent('job:removed_from_store', {
            jobId: prev.id,
            type: prev.type,
            lastStatus: prev.status,
          });
        }
      }

      previousJobs = [...currentJobs];
    } catch {
      // Never disrupt the store subscription
    }
  });

  const teardown = () => {
    unsubscribe();
    installedUnsubscribe = null;
    reportedStuckJobs.clear();
  };

  installedUnsubscribe = teardown;
  return teardown;
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
