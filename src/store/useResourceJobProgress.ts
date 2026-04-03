/**
 * Generic per-resource job progress store.
 * Tracks live state for any long-running resource operation (extract, enrich, transcribe, etc.).
 * Used for inline row-level progress; clears after batch completion.
 * Durable outcomes are persisted to the `active_job_*` columns on the resources table.
 */
import { create } from 'zustand';

// ── Types ──────────────────────────────────────────────────

export type ResourceJobType = 'extract' | 'enrich' | 'transcribe' | 'deep_enrich' | 'import' | string;
export type ResourceJobStatus = 'queued' | 'running' | 'done' | 'failed';

export interface ResourceJobEntry {
  jobType: ResourceJobType;
  status: ResourceJobStatus;
  title?: string;
  /** Optional result summary, e.g. "12 KI extracted" */
  resultSummary?: string;
  error?: string;
}

// ── Job type labels for UI ─────────────────────────────────

const JOB_TYPE_LABELS: Record<string, { running: string; done: string; failed: string }> = {
  extract:     { running: 'Extracting KIs…',    done: 'Extracted',       failed: 'Extraction failed' },
  enrich:      { running: 'Enriching…',          done: 'Enriched',        failed: 'Enrichment failed' },
  deep_enrich: { running: 'Deep enriching…',     done: 'Deep enriched',   failed: 'Deep enrich failed' },
  transcribe:  { running: 'Transcribing…',       done: 'Transcribed',     failed: 'Transcription failed' },
  import:      { running: 'Importing…',          done: 'Imported',        failed: 'Import failed' },
};

export function getJobLabel(jobType: string, status: 'running' | 'done' | 'failed'): string {
  return JOB_TYPE_LABELS[jobType]?.[status] ?? (
    status === 'running' ? 'Processing…' :
    status === 'done' ? 'Completed' :
    'Failed'
  );
}

// ── Stale timeout ──────────────────────────────────────────

/** If a durable 'running' job hasn't been updated in this window, treat it as stale */
export const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export function isJobStale(updatedAt: string | null, status: string): boolean {
  if (status !== 'running' || !updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() > STALE_JOB_TIMEOUT_MS;
}

// ── Store ──────────────────────────────────────────────────

interface ResourceJobProgressState {
  /** Currently running batch? */
  batchActive: boolean;
  batchTotal: number;
  batchProcessed: number;
  batchJobType: ResourceJobType | null;
  /** Per-resource live state */
  resources: Record<string, ResourceJobEntry>;

  startBatch: (resourceIds: string[], jobType: ResourceJobType) => void;
  markRunning: (resourceId: string, title?: string) => void;
  markDone: (resourceId: string, resultSummary?: string) => void;
  markFailed: (resourceId: string, error?: string) => void;
  endBatch: () => void;
  clear: () => void;
  getBatchPct: () => number;
}

export const useResourceJobProgress = create<ResourceJobProgressState>((set, get) => ({
  batchActive: false,
  batchTotal: 0,
  batchProcessed: 0,
  batchJobType: null,
  resources: {},

  startBatch: (resourceIds, jobType) => {
    const resources: Record<string, ResourceJobEntry> = {};
    for (const id of resourceIds) {
      resources[id] = { jobType, status: 'queued' };
    }
    set({ batchActive: true, batchTotal: resourceIds.length, batchProcessed: 0, batchJobType: jobType, resources });
  },

  markRunning: (resourceId, title) => {
    set(state => {
      const existing = state.resources[resourceId];
      return {
        resources: {
          ...state.resources,
          [resourceId]: { ...existing, jobType: existing?.jobType ?? state.batchJobType ?? 'extract', status: 'running', title },
        },
      };
    });
  },

  markDone: (resourceId, resultSummary) => {
    set(state => ({
      batchProcessed: state.batchProcessed + 1,
      resources: {
        ...state.resources,
        [resourceId]: { ...state.resources[resourceId], status: 'done', resultSummary },
      },
    }));
  },

  markFailed: (resourceId, error) => {
    set(state => ({
      batchProcessed: state.batchProcessed + 1,
      resources: {
        ...state.resources,
        [resourceId]: { ...state.resources[resourceId], status: 'failed', error },
      },
    }));
  },

  endBatch: () => {
    set({ batchActive: false });
    setTimeout(() => {
      set({ batchTotal: 0, batchProcessed: 0, batchJobType: null, resources: {} });
    }, 3000);
  },

  clear: () => set({ batchActive: false, batchTotal: 0, batchProcessed: 0, batchJobType: null, resources: {} }),

  getBatchPct: () => {
    const { batchTotal, batchProcessed } = get();
    if (batchTotal === 0) return 0;
    return Math.round((batchProcessed / batchTotal) * 100);
  },
}));

// ── Backward-compat alias ──────────────────────────────────
// So existing imports from useExtractionProgress still work

/** @deprecated Use useResourceJobProgress instead */
export const useExtractionProgress = useResourceJobProgress;
