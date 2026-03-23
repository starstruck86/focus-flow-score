/**
 * Execution Tracker — persists current execution context across
 * the confirm/skip loop so the app remembers where the user is
 * in their external workflow (Salesforce, Outreach, etc.).
 *
 * Stores: current account, contact, funnel stage, and pending action.
 * Future-ready: includes externalSystem field for CRM/cadence integration.
 */

import { useState, useCallback, useEffect } from 'react';

export type ExternalSystem = 'salesforce' | 'outreach' | 'salesloft' | 'manual';

export interface ExecutionContext {
  accountId: string;
  accountName: string;
  contactName?: string;
  contactTitle?: string;
  stage: string;
  pendingAction: string;
  script?: string;
  externalSystem: ExternalSystem;
  startedAt: number;
}

interface ExecutionLog {
  actionId: string;
  accountId: string;
  outcome: 'confirmed' | 'skipped';
  externalSystem: ExternalSystem;
  timestamp: number;
  durationMs?: number;
}

const CTX_KEY = 'execution-tracker-context';
const LOG_KEY = 'execution-tracker-log';
const MAX_LOG = 200;

function loadCtx(): ExecutionContext | null {
  try {
    const raw = localStorage.getItem(CTX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadLog(): ExecutionLog[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function useExecutionTracker() {
  const [context, setContext] = useState<ExecutionContext | null>(loadCtx);
  const [log, setLog] = useState<ExecutionLog[]>(loadLog);

  useEffect(() => {
    if (context) localStorage.setItem(CTX_KEY, JSON.stringify(context));
    else localStorage.removeItem(CTX_KEY);
  }, [context]);

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)));
  }, [log]);

  /** Set the current execution focus (called when a new action is surfaced) */
  const setFocus = useCallback((ctx: Omit<ExecutionContext, 'startedAt'>) => {
    setContext({ ...ctx, startedAt: Date.now() });
  }, []);

  /** User confirms they completed the action externally */
  const confirmAction = useCallback((actionId: string) => {
    if (context) {
      setLog(prev => [...prev, {
        actionId,
        accountId: context.accountId,
        outcome: 'confirmed',
        externalSystem: context.externalSystem,
        timestamp: Date.now(),
        durationMs: Date.now() - context.startedAt,
      }]);
    }
    setContext(null);
  }, [context]);

  /** User skips — not now, move to next */
  const skipAction = useCallback((actionId: string) => {
    if (context) {
      setLog(prev => [...prev, {
        actionId,
        accountId: context.accountId,
        outcome: 'skipped',
        externalSystem: context.externalSystem,
        timestamp: Date.now(),
      }]);
    }
    setContext(null);
  }, [context]);

  /** Get confirmation rate for learning */
  const getConfirmationRate = useCallback((): number => {
    if (log.length < 3) return 0.5;
    const confirmed = log.filter(l => l.outcome === 'confirmed').length;
    return confirmed / log.length;
  }, [log]);

  /** Average time-to-confirm for completed actions */
  const getAvgCompletionTime = useCallback((): number | null => {
    const completed = log.filter(l => l.outcome === 'confirmed' && l.durationMs);
    if (completed.length === 0) return null;
    return completed.reduce((s, l) => s + (l.durationMs || 0), 0) / completed.length;
  }, [log]);

  return {
    context,
    setFocus,
    confirmAction,
    skipAction,
    getConfirmationRate,
    getAvgCompletionTime,
    hasActiveContext: context !== null,
  };
}
