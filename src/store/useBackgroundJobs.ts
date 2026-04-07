/**
 * useBackgroundJobs — global Zustand store for tracking all long-running background jobs.
 *
 * ARCHITECTURE:
 * - The `background_jobs` DB table is the DURABLE source of truth.
 * - This store is a UI CACHE / PROJECTION. It never owns state independently.
 * - Two paths to create a job:
 *   1. DURABLE (preferred): call `createDurableJob()` externally, then `addJob()` WITHOUT userId
 *      to populate the UI cache. The DB row already exists.
 *   2. INLINE: call `addJob()` WITH userId — this creates the DB row AND the UI cache entry.
 *      Use only for simple jobs that don't need external orchestration setup.
 *   NEVER do both — that causes duplicate DB writes.
 * - On app load, jobs are rehydrated from DB via `rehydrateJobs()`.
 * - Realtime subscription keeps them in sync via `syncJobFromDB()`.
 */
import { create } from 'zustand';
import {
  createDurableJob,
  updateDurableJob,
  finalizeDurableJob,
} from '@/lib/durableJobs';
import { retryDurableJob } from '@/lib/startDurableEnrichment';

export type JobStatus = 'queued' | 'running' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled';

export type JobSubstatus =
  | 'resolving'
  | 'transcribing'
  | 'preprocessing'
  | 'extracting'
  | 'enriching'
  | 'generating_kis'
  | 'generating_playbook'
  | 'polling'
  | 'waiting_continuation'
  | 'retrying'
  | 'reconciling'
  | string;

export type JobType =
  | 'podcast_import'
  | 'extraction'
  | 'enrichment'
  | 'ki_generation'
  | 'playbook_generation'
  | 'transcript_preprocessing'
  | 'bulk_action'
  | 're_extraction'
  | 're_enrichment'
  | 'deep_enrich'
  | string;

export type ProgressMode = 'determinate' | 'indeterminate';

export interface BackgroundJob {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  substatus?: JobSubstatus;
  progressMode?: ProgressMode;
  progress?: { current: number; total: number };
  progressPercent?: number;
  stepLabel?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  entityId?: string;
  meta?: Record<string, unknown>;
}

const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled'];

interface BackgroundJobsState {
  jobs: BackgroundJob[];
  drawerOpen: boolean;
  /** Whether we've loaded from DB at least once */
  rehydrated: boolean;
}

interface BackgroundJobsActions {
  /**
   * Add a job to the UI cache.
   *
   * CONTRACT:
   * - If `userId` is provided → also creates the DB row (inline path).
   * - If `userId` is omitted → UI-only cache entry. The DB row MUST already exist
   *   (created via `createDurableJob()` or `startDurableEnrichment()`).
   * - NEVER provide userId when the DB row was already created externally.
   */
  addJob: (job: Omit<BackgroundJob, 'createdAt' | 'updatedAt'> & { userId?: string }) => void;
  /** Update a job in the UI cache AND persist progress to DB. */
  updateJob: (id: string, patch: Partial<Omit<BackgroundJob, 'id' | 'createdAt'>>) => void;
  /**
   * Retry a terminal job: resets DB row to queued AND dispatches real backend work.
   * For enrichment: re-invokes run-enrichment-job edge function.
   * For re-extraction: re-invokes batch-extract-kis edge function.
   */
  retryJob: (id: string) => void;
  /**
   * Remove/cancel a job.
   * If the job is running/queued, marks it as 'cancelled' in DB so backend workers exit.
   */
  removeJob: (id: string) => void;
  clearCompleted: () => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  /** Bulk-set jobs from DB rehydration (replaces current state). */
  rehydrateJobs: (jobs: BackgroundJob[]) => void;
  /** Upsert a single job from realtime/DB (does not write back to DB). */
  syncJobFromDB: (job: BackgroundJob) => void;
}

export type BackgroundJobsStore = BackgroundJobsState & BackgroundJobsActions;

// Throttle DB progress writes (at most once per 2s per job)
const lastDbWrite = new Map<string, number>();
const DB_WRITE_THROTTLE_MS = 2000;

function shouldThrottleDbWrite(jobId: string): boolean {
  const last = lastDbWrite.get(jobId) ?? 0;
  if (Date.now() - last < DB_WRITE_THROTTLE_MS) return true;
  lastDbWrite.set(jobId, Date.now());
  return false;
}

export const useBackgroundJobs = create<BackgroundJobsStore>((set, get) => ({
  jobs: [],
  drawerOpen: false,
  rehydrated: false,

  addJob: (job) => {
    const now = Date.now();

    // Deduplicate: if job already exists with same or newer state, skip
    const existing = get().jobs.find(j => j.id === job.id);
    if (existing && !TERMINAL_STATUSES.includes(existing.status) && existing.status === job.status) {
      console.info(`[BACKGROUND JOBS] addJob: "${job.id}" already exists with status=${existing.status}, skipping`);
      return;
    }

    console.info(`[BACKGROUND JOBS] addJob: "${job.id}" type=${job.type} status=${job.status} durable=${!!job.userId}`);

    // Strip userId before storing in memory — it's only used for the DB write decision
    const { userId, ...jobData } = job;

    set((s) => ({
      jobs: [{ ...jobData, createdAt: now, updatedAt: now }, ...s.jobs.filter(j => j.id !== job.id)],
    }));

    // Persist to DB only if userId provided (inline path)
    if (userId) {
      createDurableJob({
        id: job.id,
        userId,
        type: job.type,
        title: job.title,
        status: job.status,
        entityId: job.entityId,
        progressMode: job.progressMode,
        stepLabel: job.stepLabel,
        substatus: job.substatus,
        metadata: job.meta,
      }).catch((err) => console.error(`[BACKGROUND JOBS] DB create failed:`, err));
    }
  },

  updateJob: (id, patch) => {
    const current = get().jobs.find(j => j.id === id);
    if (!current) {
      console.warn(`[BACKGROUND JOBS] updateJob: job "${id}" not found, ignoring`);
      return;
    }

    // Guard: don't overwrite terminal with non-terminal
    if (TERMINAL_STATUSES.includes(current.status) && patch.status && !TERMINAL_STATUSES.includes(patch.status)) {
      console.warn(`[BACKGROUND JOBS] updateJob: blocked non-terminal update on terminal job "${id}" (${current.status} → ${patch.status})`);
      return;
    }

    // Guard: don't let progress percent go backward
    if (patch.progressPercent != null && current.progressPercent != null && patch.progressPercent < current.progressPercent) {
      patch = { ...patch, progressPercent: current.progressPercent };
    }

    if (patch.status && patch.status !== current.status) {
      console.info(`[BACKGROUND JOBS] updateJob: "${id}" status ${current.status} → ${patch.status}`);
    }

    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j,
      ),
    }));

    // Persist to DB
    const isTerminal = patch.status && TERMINAL_STATUSES.includes(patch.status);
    if (isTerminal) {
      finalizeDurableJob(id, patch.status as 'completed' | 'failed' | 'cancelled', {
        error: patch.error ?? undefined,
        stepLabel: patch.stepLabel ?? undefined,
        progressPercent: patch.progressPercent,
      }).catch((err) => console.error(`[BACKGROUND JOBS] DB finalize failed:`, err));
    } else if (!shouldThrottleDbWrite(id)) {
      const dbPatch: Record<string, unknown> = {};
      if (patch.status) dbPatch.status = patch.status;
      if (patch.substatus !== undefined) dbPatch.substatus = patch.substatus;
      if (patch.progressMode) dbPatch.progress_mode = patch.progressMode;
      if (patch.progress) {
        dbPatch.progress_current = patch.progress.current;
        dbPatch.progress_total = patch.progress.total;
      }
      if (patch.progressPercent != null) dbPatch.progress_percent = patch.progressPercent;
      if (patch.stepLabel !== undefined) dbPatch.step_label = patch.stepLabel;
      if (patch.error !== undefined) dbPatch.error = patch.error;

      if (Object.keys(dbPatch).length > 0) {
        updateDurableJob(id, dbPatch as any).catch(() => {});
      }
    }
  },

  retryJob: (id) => {
    const current = get().jobs.find(j => j.id === id);
    if (!current) return;
    if (!TERMINAL_STATUSES.includes(current.status)) return;

    console.info(`[BACKGROUND JOBS] retryJob: "${id}" ${current.status} → queued (dispatching to backend)`);
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id
          ? { ...j, status: 'queued' as const, error: undefined, progressPercent: undefined, substatus: undefined, stepLabel: 'Queued for retry', updatedAt: Date.now() }
          : j,
      ),
    }));

    // Persist retry to DB AND dispatch real backend work
    retryDurableJob(id).catch((err) => {
      console.error(`[BACKGROUND JOBS] retry dispatch failed for "${id}":`, err);
    });
  },

  removeJob: (id) => {
    const current = get().jobs.find(j => j.id === id);
    console.info(`[BACKGROUND JOBS] removeJob: "${id}" (was ${current?.status})`);

    // If the job is active, mark it as cancelled in DB so the backend stops
    if (current && (current.status === 'running' || current.status === 'queued')) {
      finalizeDurableJob(id, 'cancelled', { stepLabel: 'Cancelled by user' }).catch(() => {});
    }

    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  },

  clearCompleted: () =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled'),
    })),

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

  rehydrateJobs: (jobs) => {
    console.info(`[BACKGROUND JOBS] rehydrated ${jobs.length} jobs from DB`);
    set({ jobs, rehydrated: true });
  },

  syncJobFromDB: (job) => {
    set((s) => {
      const exists = s.jobs.find(j => j.id === job.id);
      if (exists) {
        // DB is authoritative — always accept if updatedAt is >= local
        if (job.updatedAt >= exists.updatedAt) {
          return { jobs: s.jobs.map(j => j.id === job.id ? job : j) };
        }
        return s;
      }
      return { jobs: [job, ...s.jobs] };
    });
  },
}));

// ── Selectors ──
export const selectActiveJobs = (s: BackgroundJobsStore) =>
  s.jobs.filter((j) => j.status === 'queued' || j.status === 'running');

export const selectReviewJobs = (s: BackgroundJobsStore) =>
  s.jobs.filter((j) => j.status === 'awaiting_review');

export const selectFailedJobs = (s: BackgroundJobsStore) =>
  s.jobs.filter((j) => j.status === 'failed');

export const selectCompletedJobs = (s: BackgroundJobsStore) =>
  s.jobs.filter((j) => j.status === 'completed');

export const selectJobCounts = (s: BackgroundJobsStore) => ({
  active: s.jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
  review: s.jobs.filter((j) => j.status === 'awaiting_review').length,
  failed: s.jobs.filter((j) => j.status === 'failed').length,
  completed: s.jobs.filter((j) => j.status === 'completed').length,
  total: s.jobs.length,
});

/** Get the computed percent for a job */
export function getJobPercent(job: BackgroundJob): number | undefined {
  if (job.progressPercent != null) return job.progressPercent;
  if (job.progress && job.progress.total > 0) {
    return Math.round((job.progress.current / job.progress.total) * 100);
  }
  return undefined;
}

/** Format elapsed time since job creation */
export function formatElapsed(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m`;
}
