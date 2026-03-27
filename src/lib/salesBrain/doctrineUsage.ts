/**
 * Sales Brain — Doctrine Usage Logging
 *
 * Tracks actual downstream usage of doctrine entries (not just eligibility).
 * localStorage-backed, capped at 1000 events, corruption-safe.
 */

export type DoctrineUsageTarget = 'dave' | 'roleplay' | 'prep' | 'playbooks';

export interface DoctrineUsageEvent {
  id: string;
  doctrineId: string;
  target: DoctrineUsageTarget;
  contextType: string | null;
  contextId: string | null;
  reason: string | null;
  timestamp: string;
}

export interface DoctrineUsageSummary {
  doctrineId: string;
  totalUsages: number;
  byTarget: Record<DoctrineUsageTarget, number>;
  lastUsedAt: string | null;
  lastUsedTarget: DoctrineUsageTarget | null;
  recentEvents: DoctrineUsageEvent[];
}

const USAGE_KEY = 'sales-brain-doctrine-usage';
const MAX_EVENTS = 1000;

function generateId(): string {
  return `du-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function loadDoctrineUsage(): DoctrineUsageEvent[] {
  try {
    const raw = localStorage.getItem(USAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveDoctrineUsage(events: DoctrineUsageEvent[]): void {
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
  } catch { /* quota */ }
}

export function logDoctrineUsage(
  doctrineId: string,
  target: DoctrineUsageTarget,
  contextType: string | null = null,
  contextId: string | null = null,
  reason: string | null = null,
): void {
  const events = loadDoctrineUsage();
  events.unshift({
    id: generateId(),
    doctrineId,
    target,
    contextType,
    contextId,
    reason,
    timestamp: new Date().toISOString(),
  });
  saveDoctrineUsage(events);
}

/** Log usage for multiple doctrine IDs at once (batch) */
export function logDoctrineUsageBatch(
  doctrineIds: string[],
  target: DoctrineUsageTarget,
  contextType: string | null = null,
  contextId: string | null = null,
  reason: string | null = null,
): void {
  if (doctrineIds.length === 0) return;
  const events = loadDoctrineUsage();
  const now = new Date().toISOString();
  for (const doctrineId of doctrineIds) {
    events.unshift({
      id: generateId(),
      doctrineId,
      target,
      contextType,
      contextId,
      reason,
      timestamp: now,
    });
  }
  saveDoctrineUsage(events);
}

export function getDoctrineUsageForId(doctrineId: string): DoctrineUsageEvent[] {
  return loadDoctrineUsage().filter(e => e.doctrineId === doctrineId);
}

export function getDoctrineUsageSummary(doctrineId: string): DoctrineUsageSummary {
  const events = getDoctrineUsageForId(doctrineId);
  const byTarget: Record<DoctrineUsageTarget, number> = { dave: 0, roleplay: 0, prep: 0, playbooks: 0 };
  for (const e of events) byTarget[e.target]++;
  const latest = events[0] || null;
  return {
    doctrineId,
    totalUsages: events.length,
    byTarget,
    lastUsedAt: latest?.timestamp ?? null,
    lastUsedTarget: latest?.target ?? null,
    recentEvents: events.slice(0, 10),
  };
}

export function getRecentDoctrineUsage(target?: DoctrineUsageTarget, limit = 20): DoctrineUsageEvent[] {
  let events = loadDoctrineUsage();
  if (target) events = events.filter(e => e.target === target);
  return events.slice(0, limit);
}

/** Get count of unique doctrine IDs actually used per target */
export function getActualUsageCounts(): Record<DoctrineUsageTarget, number> {
  const events = loadDoctrineUsage();
  const sets: Record<DoctrineUsageTarget, Set<string>> = {
    dave: new Set(), roleplay: new Set(), prep: new Set(), playbooks: new Set(),
  };
  for (const e of events) sets[e.target].add(e.doctrineId);
  return {
    dave: sets.dave.size,
    roleplay: sets.roleplay.size,
    prep: sets.prep.size,
    playbooks: sets.playbooks.size,
  };
}
