/**
 * Execution Tracker — lag-tolerant, external-execution-aware context
 * persistence for the confirm/skip/block/snooze loop.
 *
 * Immediate layer: tracks lightweight user signals (done/blocked/skipped/snoozed).
 * Delayed layer: reconciles when CRM/cadence/transcript data arrives later.
 *
 * Future-ready: externalSystem field + reconciliation hooks for
 * Salesforce and Outreach/Salesloft passive sync.
 */

import { useState, useCallback, useEffect } from 'react';

export type ExternalSystem = 'salesforce' | 'outreach' | 'salesloft' | 'manual';
export type ActionOutcome = 'done' | 'blocked' | 'skipped' | 'snoozed';

export interface ExecutionContext {
  actionId: string;
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

export interface ExecutionLogEntry {
  actionId: string;
  accountId: string;
  accountName: string;
  outcome: ActionOutcome;
  externalSystem: ExternalSystem;
  timestamp: number;
  durationMs?: number;
  snoozeUntil?: number;
  blockReason?: string;
  /** Set when delayed data (transcript, CRM sync) is reconciled */
  reconciled?: boolean;
  reconciledAt?: number;
  reconciledSource?: string;
}

const CTX_KEY = 'execution-tracker-context';
const LOG_KEY = 'execution-tracker-log';
const MAX_LOG = 300;

function loadCtx(): ExecutionContext | null {
  try {
    const raw = localStorage.getItem(CTX_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function loadLog(): ExecutionLogEntry[] {
  try {
    const raw = localStorage.getItem(LOG_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

export function useExecutionTracker() {
  const [context, setContext] = useState<ExecutionContext | null>(loadCtx);
  const [log, setLog] = useState<ExecutionLogEntry[]>(loadLog);

  useEffect(() => {
    if (context) localStorage.setItem(CTX_KEY, JSON.stringify(context));
    else localStorage.removeItem(CTX_KEY);
  }, [context]);

  useEffect(() => {
    localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-MAX_LOG)));
  }, [log]);

  // ── Immediate layer ──────────────────────────────────────────

  /** Set the current execution focus */
  const setFocus = useCallback((ctx: Omit<ExecutionContext, 'startedAt'>) => {
    setContext({ ...ctx, startedAt: Date.now() });
  }, []);

  /** Record an outcome and clear context */
  const resolve = useCallback((outcome: ActionOutcome, opts?: { snoozeMinutes?: number; blockReason?: string }) => {
    if (!context) return;
    const entry: ExecutionLogEntry = {
      actionId: context.actionId,
      accountId: context.accountId,
      accountName: context.accountName,
      outcome,
      externalSystem: context.externalSystem,
      timestamp: Date.now(),
      durationMs: Date.now() - context.startedAt,
    };
    if (outcome === 'snoozed' && opts?.snoozeMinutes) {
      entry.snoozeUntil = Date.now() + opts.snoozeMinutes * 60_000;
    }
    if (outcome === 'blocked' && opts?.blockReason) {
      entry.blockReason = opts.blockReason;
    }
    setLog(prev => [...prev, entry]);
    setContext(null);
  }, [context]);

  // ── Delayed learning layer ───────────────────────────────────

  /** Reconcile a past action when delayed data arrives (e.g. transcript sync) */
  const reconcile = useCallback((actionId: string, source: string) => {
    setLog(prev => prev.map(entry =>
      entry.actionId === actionId && !entry.reconciled
        ? { ...entry, reconciled: true, reconciledAt: Date.now(), reconciledSource: source }
        : entry
    ));
  }, []);

  /** Find unreconciled 'done' actions for a given account (for delayed matching) */
  const getUnreconciledForAccount = useCallback((accountId: string): ExecutionLogEntry[] => {
    const dayAgo = Date.now() - 24 * 3600_000;
    return log.filter(l =>
      l.accountId === accountId &&
      l.outcome === 'done' &&
      !l.reconciled &&
      l.timestamp > dayAgo
    );
  }, [log]);

  // ── Snooze management ────────────────────────────────────────

  /** Get snoozed action IDs that are still active */
  const getSnoozedActionIds = useCallback((): Set<string> => {
    const now = Date.now();
    const snoozed = new Set<string>();
    for (const entry of log) {
      if (entry.outcome === 'snoozed' && entry.snoozeUntil && entry.snoozeUntil > now) {
        snoozed.add(entry.actionId);
      }
    }
    return snoozed;
  }, [log]);

  // ── Analytics ────────────────────────────────────────────────

  /** Completion rate across all outcomes */
  const getCompletionRate = useCallback((): number => {
    const recent = log.filter(l => l.timestamp > Date.now() - 7 * 86400_000);
    if (recent.length < 3) return 0.5;
    const done = recent.filter(l => l.outcome === 'done').length;
    return done / recent.length;
  }, [log]);

  /** Average time from focus to 'done' */
  const getAvgCompletionTime = useCallback((): number | null => {
    const completed = log.filter(l => l.outcome === 'done' && l.durationMs);
    if (completed.length === 0) return null;
    return completed.reduce((s, l) => s + (l.durationMs || 0), 0) / completed.length;
  }, [log]);

  /** Reconciliation rate — how often delayed data matched */
  const getReconciliationRate = useCallback((): number => {
    const doneEntries = log.filter(l => l.outcome === 'done');
    if (doneEntries.length < 3) return 0;
    return doneEntries.filter(l => l.reconciled).length / doneEntries.length;
  }, [log]);

  return {
    context,
    setFocus,
    resolve,
    reconcile,
    getUnreconciledForAccount,
    getSnoozedActionIds,
    getCompletionRate,
    getAvgCompletionTime,
    getReconciliationRate,
    hasActiveContext: context !== null,
  };
}
