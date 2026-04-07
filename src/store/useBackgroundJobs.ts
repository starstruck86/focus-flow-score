/**
 * useBackgroundJobs — global Zustand store for tracking all long-running background jobs.
 * Any part of the app can add/update/remove jobs. The global indicator + drawer read from here.
 */
import { create } from 'zustand';

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
  /** 'determinate' when we know exact progress, 'indeterminate' for unknown */
  progressMode?: ProgressMode;
  progress?: { current: number; total: number };
  /** Pre-computed percent (0–100); computed from progress if not set */
  progressPercent?: number;
  /** Human-readable step label, e.g. "Batch 3 of 7", "Polling durable state" */
  stepLabel?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Optional ID to link back to the originating resource/entity */
  entityId?: string;
  /** Optional metadata for job-specific UI */
  meta?: Record<string, unknown>;
}

/** Auto-remove delay for completed/failed jobs (ms) */
const AUTO_REMOVE_DELAY_MS = 8_000;

const TERMINAL_STATUSES: JobStatus[] = ['completed', 'failed', 'cancelled'];

interface BackgroundJobsState {
  jobs: BackgroundJob[];
  drawerOpen: boolean;
}

interface BackgroundJobsActions {
  addJob: (job: Omit<BackgroundJob, 'createdAt' | 'updatedAt'>) => void;
  updateJob: (id: string, patch: Partial<Omit<BackgroundJob, 'id' | 'createdAt'>>) => void;
  removeJob: (id: string) => void;
  clearCompleted: () => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
}

export type BackgroundJobsStore = BackgroundJobsState & BackgroundJobsActions;

// Track auto-remove timers to avoid duplicates
const autoRemoveTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useBackgroundJobs = create<BackgroundJobsStore>((set, get) => ({
  jobs: [],
  drawerOpen: false,

  addJob: (job) => {
    const now = Date.now();
    // Clear any existing auto-remove timer for this job id
    if (autoRemoveTimers.has(job.id)) {
      clearTimeout(autoRemoveTimers.get(job.id)!);
      autoRemoveTimers.delete(job.id);
    }

    // Guard: don't re-add a job that is already terminal
    const existing = get().jobs.find(j => j.id === job.id);
    if (existing && TERMINAL_STATUSES.includes(existing.status) && !TERMINAL_STATUSES.includes(job.status)) {
      // Allow overriding terminal with a new run
      console.info(`[BACKGROUND JOBS] Re-adding job "${job.id}" (was ${existing.status}, now ${job.status})`);
    }

    console.info(`[BACKGROUND JOBS] addJob: "${job.id}" type=${job.type} status=${job.status}`);

    set((s) => ({
      jobs: [{ ...job, createdAt: now, updatedAt: now }, ...s.jobs.filter(j => j.id !== job.id)],
    }));
  },

  updateJob: (id, patch) => {
    const current = get().jobs.find(j => j.id === id);
    if (!current) {
      console.warn(`[BACKGROUND JOBS] updateJob: job "${id}" not found, ignoring`);
      return;
    }

    // Guard: don't let a late update overwrite a terminal state with a non-terminal state
    if (TERMINAL_STATUSES.includes(current.status) && patch.status && !TERMINAL_STATUSES.includes(patch.status)) {
      console.warn(`[BACKGROUND JOBS] updateJob: blocked non-terminal update on terminal job "${id}" (${current.status} → ${patch.status})`);
      return;
    }

    // Guard: don't let progress percent go backward
    if (patch.progressPercent != null && current.progressPercent != null && patch.progressPercent < current.progressPercent) {
      console.warn(`[BACKGROUND JOBS] updateJob: progress regression blocked for "${id}" (${current.progressPercent}% → ${patch.progressPercent}%)`);
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

    // Schedule auto-removal for terminal states
    if (patch.status && TERMINAL_STATUSES.includes(patch.status)) {
      if (!autoRemoveTimers.has(id)) {
        console.info(`[BACKGROUND JOBS] auto-dismiss scheduled for "${id}" in ${AUTO_REMOVE_DELAY_MS}ms`);
        const timer = setTimeout(() => {
          console.info(`[BACKGROUND JOBS] auto-dismiss: removing "${id}"`);
          set((s) => ({ jobs: s.jobs.filter(j => j.id !== id) }));
          autoRemoveTimers.delete(id);
        }, AUTO_REMOVE_DELAY_MS);
        autoRemoveTimers.set(id, timer);
      }
    }
  },

  removeJob: (id) => {
    if (autoRemoveTimers.has(id)) {
      clearTimeout(autoRemoveTimers.get(id)!);
      autoRemoveTimers.delete(id);
    }
    console.info(`[BACKGROUND JOBS] removeJob: "${id}"`);
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }));
  },

  clearCompleted: () =>
    set((s) => ({
      jobs: s.jobs.filter((j) => j.status !== 'completed' && j.status !== 'cancelled'),
    })),

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),
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
