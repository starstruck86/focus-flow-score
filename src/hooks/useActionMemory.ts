// Action Memory — lightweight tracking of completed/ignored/repeated actions
// Extended with: execution pressure, behavioral learning, kill switch support.
// Stored in localStorage for simplicity.

import { useCallback, useState, useEffect } from 'react';

interface ActionRecord {
  actionId: string;
  outcome: 'completed' | 'ignored' | 'deferred';
  timestamp: number;
  entityType?: string;
  entityId?: string;
}

const STORAGE_KEY = 'jarvis-action-memory';
const MAX_RECORDS = 200;

function loadMemory(): ActionRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveMemory(records: ActionRecord[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-MAX_RECORDS)));
}

export function useActionMemory() {
  const [records, setRecords] = useState<ActionRecord[]>(loadMemory);

  useEffect(() => { saveMemory(records); }, [records]);

  const recordAction = useCallback((actionId: string, outcome: ActionRecord['outcome'], entityType?: string, entityId?: string) => {
    setRecords(prev => [...prev, { actionId, outcome, timestamp: Date.now(), entityType, entityId }]);
  }, []);

  /** How many times has this action been ignored recently (last 7 days)? */
  const getIgnoreCount = useCallback((actionId: string): number => {
    const weekAgo = Date.now() - 7 * 86400000;
    return records.filter(r => r.actionId === actionId && r.outcome === 'ignored' && r.timestamp > weekAgo).length;
  }, [records]);

  /** Score adjustment: penalize repeatedly ignored actions */
  const getScoreAdjustment = useCallback((actionId: string): number => {
    const ignores = getIgnoreCount(actionId);
    if (ignores >= 3) return -0.5; // heavily demote
    if (ignores >= 2) return -0.3;
    if (ignores >= 1) return -0.1;
    return 0;
  }, [getIgnoreCount]);

  /** Get completion rate for an entity */
  const getEntityCompletionRate = useCallback((entityId: string): number => {
    const entityRecords = records.filter(r => r.entityId === entityId);
    if (entityRecords.length === 0) return 0.5;
    const completed = entityRecords.filter(r => r.outcome === 'completed').length;
    return completed / entityRecords.length;
  }, [records]);

  /** Execution pressure: get urgency level for an action based on defer history */
  const getExecutionPressure = useCallback((actionId: string): 'normal' | 'nudge' | 'insist' | 'escalate' => {
    const weekAgo = Date.now() - 7 * 86400000;
    const recent = records.filter(r => r.actionId === actionId && r.timestamp > weekAgo);
    const defers = recent.filter(r => r.outcome === 'deferred' || r.outcome === 'ignored').length;
    if (defers >= 4) return 'escalate';
    if (defers >= 3) return 'insist';
    if (defers >= 2) return 'nudge';
    return 'normal';
  }, [records]);

  /** Behavioral learning: what entity types get completed most? */
  const getEntityTypeCompletionRate = useCallback((entityType: string): number => {
    const monthAgo = Date.now() - 30 * 86400000;
    const typeRecords = records.filter(r => r.entityType === entityType && r.timestamp > monthAgo);
    if (typeRecords.length < 3) return 0.5; // not enough data
    const completed = typeRecords.filter(r => r.outcome === 'completed').length;
    return completed / typeRecords.length;
  }, [records]);

  /** Kill switch candidates: actions ignored 4+ times in a week */
  const getKillCandidates = useCallback((): string[] => {
    const weekAgo = Date.now() - 7 * 86400000;
    const ignoreMap: Record<string, number> = {};
    for (const r of records) {
      if (r.outcome === 'ignored' && r.timestamp > weekAgo) {
        ignoreMap[r.actionId] = (ignoreMap[r.actionId] || 0) + 1;
      }
    }
    return Object.entries(ignoreMap)
      .filter(([, count]) => count >= 4)
      .map(([id]) => id);
  }, [records]);

  /** Get behavior summary for Dave */
  const getBehaviorSummary = useCallback((): string => {
    const monthAgo = Date.now() - 30 * 86400000;
    const recent = records.filter(r => r.timestamp > monthAgo);
    if (recent.length < 5) return 'Not enough data for behavioral patterns.';

    const completed = recent.filter(r => r.outcome === 'completed').length;
    const ignored = recent.filter(r => r.outcome === 'ignored').length;
    const deferred = recent.filter(r => r.outcome === 'deferred').length;
    const total = recent.length;
    const completionRate = Math.round((completed / total) * 100);

    // Entity type analysis
    const typeStats: Record<string, { completed: number; total: number }> = {};
    for (const r of recent) {
      const t = r.entityType || 'unknown';
      if (!typeStats[t]) typeStats[t] = { completed: 0, total: 0 };
      typeStats[t].total++;
      if (r.outcome === 'completed') typeStats[t].completed++;
    }

    const bestType = Object.entries(typeStats)
      .filter(([, s]) => s.total >= 3)
      .sort(([, a], [, b]) => (b.completed / b.total) - (a.completed / a.total))[0];

    const worstType = Object.entries(typeStats)
      .filter(([, s]) => s.total >= 3)
      .sort(([, a], [, b]) => (a.completed / a.total) - (b.completed / b.total))[0];

    let summary = `Completion rate: ${completionRate}% (${completed}/${total}). `;
    if (deferred > 0) summary += `${deferred} deferred, ${ignored} ignored. `;
    if (bestType) summary += `Best at: ${bestType[0]} (${Math.round((bestType[1].completed / bestType[1].total) * 100)}%). `;
    if (worstType && worstType[0] !== bestType?.[0]) {
      summary += `Weakest: ${worstType[0]} (${Math.round((worstType[1].completed / worstType[1].total) * 100)}%).`;
    }

    return summary;
  }, [records]);

  const clearMemory = useCallback(() => {
    setRecords([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return {
    records,
    recordAction,
    getIgnoreCount,
    getScoreAdjustment,
    getEntityCompletionRate,
    getExecutionPressure,
    getEntityTypeCompletionRate,
    getKillCandidates,
    getBehaviorSummary,
    clearMemory,
  };
}
