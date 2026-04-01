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
  | string;

export type JobType =
  | 'podcast_import'
  | 'extraction'
  | 'enrichment'
  | 'ki_generation'
  | 'playbook_generation'
  | 'transcript_preprocessing'
  | 'bulk_action'
  | string;

export interface BackgroundJob {
  id: string;
  type: JobType;
  title: string;
  status: JobStatus;
  substatus?: JobSubstatus;
  progress?: { current: number; total: number };
  error?: string;
  createdAt: number;
  updatedAt: number;
  /** Optional ID to link back to the originating resource/entity */
  entityId?: string;
  /** Optional metadata for job-specific UI */
  meta?: Record<string, unknown>;
}

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

export const useBackgroundJobs = create<BackgroundJobsStore>((set) => ({
  jobs: [],
  drawerOpen: false,

  addJob: (job) => {
    const now = Date.now();
    set((s) => ({
      jobs: [{ ...job, createdAt: now, updatedAt: now }, ...s.jobs],
    }));
  },

  updateJob: (id, patch) =>
    set((s) => ({
      jobs: s.jobs.map((j) =>
        j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j,
      ),
    })),

  removeJob: (id) =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

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
