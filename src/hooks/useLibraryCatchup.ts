/**
 * useLibraryCatchup — Zustand-based orchestrator for library reconciliation.
 * Manages scan → preview → phased execution → completion.
 * Supports conservative rollout: enrichment-only, then extraction, then full.
 */
import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──────────────────────────────────────────────────
export type CatchupMode = 'dry_run' | 'safe_auto_fix' | 'force_reprocess';
export type CatchupPhase = 'enrich' | 'extract' | 'activate' | 'surface_to_qa';
export type CatchupStatus = 'idle' | 'scanning' | 'scanned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'error';

const PHASES: CatchupPhase[] = ['enrich', 'extract', 'activate', 'surface_to_qa'];

export interface PhaseResult {
  phase: CatchupPhase;
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  qa_flagged: number;
  skipped: number;
  status: 'pending' | 'running' | 'complete' | 'skipped';
}

export interface CatchupSnapshot {
  run_id: string;
  mode: CatchupMode;
  total_resources: number;
  buckets: Record<string, number>;
  issue_breakdown: Record<string, number>;
  needs_action: number;
  qa_flagged: number;
  backfilled_content_length?: number;
}

interface CatchupState {
  status: CatchupStatus;
  mode: CatchupMode;
  runId: string | null;
  snapshot: CatchupSnapshot | null;
  currentPhase: CatchupPhase | null;
  phaseResults: Record<CatchupPhase, PhaseResult>;
  error: string | null;
  /** Which phases to run (conservative rollout) */
  selectedPhases: CatchupPhase[];
  /** Completed rollout step for guidance */
  lastCompletedStep: 'none' | 'dry_run' | 'enrichment' | 'extraction' | 'full';

  // Actions
  startScan: (mode?: CatchupMode, backfillContentLength?: boolean) => Promise<void>;
  executePhases: (phases?: CatchupPhase[]) => Promise<void>;
  cancelRun: () => void;
  reset: () => void;
  setSelectedPhases: (phases: CatchupPhase[]) => void;
}

const emptyPhaseResults = (): Record<CatchupPhase, PhaseResult> => ({
  enrich: { phase: 'enrich', total: 0, processed: 0, succeeded: 0, failed: 0, qa_flagged: 0, skipped: 0, status: 'pending' },
  extract: { phase: 'extract', total: 0, processed: 0, succeeded: 0, failed: 0, qa_flagged: 0, skipped: 0, status: 'pending' },
  activate: { phase: 'activate', total: 0, processed: 0, succeeded: 0, failed: 0, qa_flagged: 0, skipped: 0, status: 'pending' },
  surface_to_qa: { phase: 'surface_to_qa', total: 0, processed: 0, succeeded: 0, failed: 0, qa_flagged: 0, skipped: 0, status: 'pending' },
});

export const useLibraryCatchup = create<CatchupState>((set, get) => ({
  status: 'idle',
  mode: 'dry_run',
  runId: null,
  snapshot: null,
  currentPhase: null,
  phaseResults: emptyPhaseResults(),
  error: null,
  selectedPhases: ['enrich'],
  lastCompletedStep: 'none',

  startScan: async (mode: CatchupMode = 'dry_run', backfillContentLength = true) => {
    set({ status: 'scanning', mode, error: null, snapshot: null, runId: null, phaseResults: emptyPhaseResults(), lastCompletedStep: 'none' });
    try {
      const { data, error } = await supabase.functions.invoke('reconcile-library', {
        body: { mode, backfill_content_length: backfillContentLength },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      set({
        status: 'scanned',
        runId: data.run_id,
        snapshot: data as CatchupSnapshot,
      });
    } catch (err: any) {
      set({ status: 'error', error: err.message || 'Scan failed' });
    }
  },

  setSelectedPhases: (phases: CatchupPhase[]) => {
    set({ selectedPhases: phases });
  },

  executePhases: async (phases?: CatchupPhase[]) => {
    const { runId, mode, selectedPhases } = get();
    if (!runId) return;

    const phasesToRun = phases || selectedPhases;
    set({ status: 'running' });

    for (const phase of phasesToRun) {
      if (get().status === 'cancelled') break;

      set({ currentPhase: phase });
      set(s => ({
        phaseResults: {
          ...s.phaseResults,
          [phase]: { ...s.phaseResults[phase], status: 'running' },
        },
      }));

      try {
        const { data, error } = await supabase.functions.invoke('run-catchup', {
          body: { run_id: runId, phase, limit: 100 },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        set(s => ({
          phaseResults: {
            ...s.phaseResults,
            [phase]: { ...(data as PhaseResult), phase, status: 'complete' },
          },
        }));
      } catch (err: any) {
        set(s => ({
          phaseResults: {
            ...s.phaseResults,
            [phase]: { ...s.phaseResults[phase], status: 'complete' },
          },
          error: err.message,
        }));
      }
    }

    // Mark unselected phases as skipped
    for (const phase of PHASES) {
      if (!phasesToRun.includes(phase)) {
        set(s => ({
          phaseResults: {
            ...s.phaseResults,
            [phase]: { ...s.phaseResults[phase], status: 'skipped' },
          },
        }));
      }
    }

    // Determine completed rollout step
    const ranPhases = new Set(phasesToRun);
    let lastStep: CatchupState['lastCompletedStep'] = 'none';
    if (mode === 'dry_run') lastStep = 'dry_run';
    else if (ranPhases.has('surface_to_qa')) lastStep = 'full';
    else if (ranPhases.has('extract')) lastStep = 'extraction';
    else if (ranPhases.has('enrich')) lastStep = 'enrichment';

    if (get().status !== 'cancelled') {
      set({ status: 'completed', currentPhase: null, lastCompletedStep: lastStep });
    }
  },

  cancelRun: () => {
    const { runId } = get();
    set({ status: 'cancelled', currentPhase: null });
    if (runId) {
      supabase
        .from('library_reconciliation_runs')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', runId)
        .then(() => {});
    }
  },

  reset: () => {
    set({
      status: 'idle',
      mode: 'dry_run',
      runId: null,
      snapshot: null,
      currentPhase: null,
      phaseResults: emptyPhaseResults(),
      error: null,
      selectedPhases: ['enrich'],
      lastCompletedStep: 'none',
    });
  },
}));
