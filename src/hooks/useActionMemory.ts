// Action Memory — lightweight tracking of completed/ignored/repeated actions
// Used for adaptive prioritization. Stored in localStorage for simplicity.

import { useCallback, useState, useEffect } from 'react';

interface ActionRecord {
  actionId: string;
  outcome: 'completed' | 'ignored' | 'deferred';
  timestamp: number;
  entityType?: string;
  entityId?: string;
}

const STORAGE_KEY = 'jarvis-action-memory';
const MAX_RECORDS = 100;

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

  const clearMemory = useCallback(() => {
    setRecords([]);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  return { records, recordAction, getIgnoreCount, getScoreAdjustment, getEntityCompletionRate, clearMemory };
}
