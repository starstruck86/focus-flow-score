/**
 * Lightweight Zustand store tracking per-resource extraction progress.
 * Used to show inline % complete on resource rows instead of toast notifications.
 */
import { create } from 'zustand';

export type ExtractionResourceStatus = 'queued' | 'extracting' | 'done' | 'failed';

export interface ExtractionProgressEntry {
  status: ExtractionResourceStatus;
  title?: string;
  kiExtracted?: number;
}

interface ExtractionProgressState {
  /** Currently running batch? */
  batchActive: boolean;
  /** Total resources in the active batch */
  batchTotal: number;
  /** Number processed so far */
  batchProcessed: number;
  /** Per-resource status */
  resources: Record<string, ExtractionProgressEntry>;

  startBatch: (resourceIds: string[]) => void;
  markExtracting: (resourceId: string, title?: string) => void;
  markDone: (resourceId: string, kiExtracted: number) => void;
  markFailed: (resourceId: string) => void;
  endBatch: () => void;
  clear: () => void;
  /** Percentage for a specific resource: 0 = queued, 50 = extracting, 100 = done */
  getResourcePct: (resourceId: string) => number | null;
  /** Overall batch percentage */
  getBatchPct: () => number;
}

export const useExtractionProgress = create<ExtractionProgressState>((set, get) => ({
  batchActive: false,
  batchTotal: 0,
  batchProcessed: 0,
  resources: {},

  startBatch: (resourceIds) => {
    const resources: Record<string, ExtractionProgressEntry> = {};
    for (const id of resourceIds) {
      resources[id] = { status: 'queued' };
    }
    set({ batchActive: true, batchTotal: resourceIds.length, batchProcessed: 0, resources });
  },

  markExtracting: (resourceId, title) => {
    set(state => ({
      resources: {
        ...state.resources,
        [resourceId]: { status: 'extracting', title },
      },
    }));
  },

  markDone: (resourceId, kiExtracted) => {
    set(state => ({
      batchProcessed: state.batchProcessed + 1,
      resources: {
        ...state.resources,
        [resourceId]: { ...state.resources[resourceId], status: 'done', kiExtracted },
      },
    }));
  },

  markFailed: (resourceId) => {
    set(state => ({
      batchProcessed: state.batchProcessed + 1,
      resources: {
        ...state.resources,
        [resourceId]: { ...state.resources[resourceId], status: 'failed' },
      },
    }));
  },

  endBatch: () => {
    // Keep entries visible for 3s, then clear
    setTimeout(() => {
      set({ batchActive: false, batchTotal: 0, batchProcessed: 0, resources: {} });
    }, 3000);
    set({ batchActive: false });
  },

  clear: () => set({ batchActive: false, batchTotal: 0, batchProcessed: 0, resources: {} }),

  getResourcePct: (resourceId) => {
    const entry = get().resources[resourceId];
    if (!entry) return null;
    if (entry.status === 'queued') return 0;
    if (entry.status === 'extracting') return 50;
    return 100;
  },

  getBatchPct: () => {
    const { batchTotal, batchProcessed } = get();
    if (batchTotal === 0) return 0;
    return Math.round((batchProcessed / batchTotal) * 100);
  },
}));
