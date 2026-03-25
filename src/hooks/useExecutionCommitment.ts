// Execution Commitment — global single-action enforcement with state tracking
// States: not_started | committed | completed | interrupted
// Only ONE action may be active at a time.

import { useState, useCallback, useMemo } from 'react';

export type CommitmentState = 'not_started' | 'committed' | 'completed' | 'interrupted';

export interface CommittedAction {
  actionId: string;
  action: string;
  why: string;
  nextStep: string;
  committedAt: number;
  state: CommitmentState;
  interruptReason?: string;
}

const STORAGE_KEY = 'execution-commitment';
const COMMITMENT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours max

function loadCommitment(): CommittedAction | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CommittedAction;
    // Expire stale commitments
    if (Date.now() - parsed.committedAt > COMMITMENT_TIMEOUT_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    // Only return active commitments
    if (parsed.state === 'completed' || parsed.state === 'interrupted') return null;
    return parsed;
  } catch { return null; }
}

function saveCommitment(action: CommittedAction | null) {
  if (!action) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(action));
  }
}

export function useExecutionCommitment() {
  const [committed, setCommitted] = useState<CommittedAction | null>(loadCommitment);

  const commit = useCallback((action: {
    actionId: string;
    action: string;
    why: string;
    nextStep: string;
  }) => {
    const entry: CommittedAction = {
      ...action,
      committedAt: Date.now(),
      state: 'committed',
    };
    saveCommitment(entry);
    setCommitted(entry);
  }, []);

  const complete = useCallback((actionId: string) => {
    setCommitted(prev => {
      if (!prev || prev.actionId !== actionId) return prev;
      // Log completion to action memory
      try {
        const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
        records.push({ actionId, outcome: 'completed', timestamp: Date.now() });
        localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
      } catch {}
      saveCommitment(null);
      return null;
    });
  }, []);

  const interrupt = useCallback((reason?: string) => {
    setCommitted(prev => {
      if (!prev) return prev;
      // Log interruption to action memory
      try {
        const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
        records.push({ actionId: prev.actionId, outcome: 'interrupted', timestamp: Date.now() });
        localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
      } catch {}
      const updated: CommittedAction = { ...prev, state: 'interrupted', interruptReason: reason };
      saveCommitment(null); // Clear so next action can be committed
      return null;
    });
  }, []);

  const isCommitted = useMemo(() => committed?.state === 'committed', [committed]);

  return {
    committed,
    isCommitted,
    commit,
    complete,
    interrupt,
  };
}
