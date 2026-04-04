/**
 * useLibraryCatchup — Zustand-based orchestrator for library reconciliation.
 * Manages scan → preview → phased execution → completion.
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
}

interface CatchupState {
  status: CatchupStatus;
  mode: CatchupMode;
  runId: string | null;
  snapshot: CatchupSnapshot | null;
  currentPhase: CatchupPhase | null;
  phaseResults: Record<CatchupPhase, PhaseResult>;
  error: string | null;

  // Actions
  startScan: (mode?: CatchupMode) => Promise<void>;
  executePhases: () => Promise<void>;
  cancelRun: () => void;
  reset: () => void;
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

  startScan: async (mode: CatchupMode = 'dry_run') => {
    set({ status: 'scanning', mode, error: null, snapshot: null, runId: null, phaseResults: emptyPhaseResults() });
    try {
      const { data, error } = await supabase.functions.invoke('reconcile-library', {
        body: { mode },
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

  executePhases: async () => {
    const { runId, mode } = get();
    if (!runId) return;

    let cancelled = false;
    set({ status: 'running' });

    for (const phase of PHASES) {
      if (cancelled || get().status === 'cancelled') break;

      set({ currentPhase: phase });

      // Update phase status to running
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

    if (get().status !== 'cancelled') {
      set({ status: 'completed', currentPhase: null });
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
    });
  },
}));
