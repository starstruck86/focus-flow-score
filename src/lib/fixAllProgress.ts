/**
 * fixAllProgress — Shared progress model for Fix All execution.
 * Provides immutable update helpers for real-time progress tracking.
 */

export type FixAllPhaseName =
  | 'normalize_status'
  | 'stalled_retry'
  | 'enrichment'
  | 'extraction'
  | 'activation';

export interface FixAllLiveProgress {
  isRunning: boolean;
  phase: FixAllPhaseName | null;
  phaseLabel: string;
  total: number;
  completed: number;
  running: number;
  failed: number;
  remaining: number;
  percent: number;
  startedAt: string | null;
  lastProgressAt: string | null;
  elapsedMs: number;
  etaMs: number | null;
  stalled: boolean;
  stallThresholdMs: number;
  currentMessage: string | null;
  completedIds: string[];
  failedIds: string[];
  runningIds: string[];
}

export const FIX_ALL_STALL_THRESHOLD_MS = 90_000;

const PHASE_LABELS: Record<FixAllPhaseName, string> = {
  normalize_status: 'Normalizing statuses',
  stalled_retry: 'Retrying stalled jobs',
  enrichment: 'Enriching resources',
  extraction: 'Extracting knowledge items',
  activation: 'Activating knowledge items',
};

export function createFixAllProgress(total: number): FixAllLiveProgress {
  return {
    isRunning: true,
    phase: null,
    phaseLabel: 'Starting…',
    total,
    completed: 0,
    running: 0,
    failed: 0,
    remaining: total,
    percent: 0,
    startedAt: new Date().toISOString(),
    lastProgressAt: new Date().toISOString(),
    elapsedMs: 0,
    etaMs: null,
    stalled: false,
    stallThresholdMs: FIX_ALL_STALL_THRESHOLD_MS,
    currentMessage: `Starting auto-fix for ${total} blockers…`,
    completedIds: [],
    failedIds: [],
    runningIds: [],
  };
}

export function markFixAllPhase(
  progress: FixAllLiveProgress,
  phase: FixAllPhaseName,
  phaseLabel?: string,
  message?: string,
): FixAllLiveProgress {
  const now = new Date().toISOString();
  return recomputeFixAllDerived({
    ...progress,
    phase,
    phaseLabel: phaseLabel || PHASE_LABELS[phase] || phase,
    currentMessage: message || PHASE_LABELS[phase] || `Phase: ${phase}`,
    lastProgressAt: now,
  });
}

export function markFixAllItemStart(
  progress: FixAllLiveProgress,
  resourceId: string,
  message?: string,
): FixAllLiveProgress {
  const runningIds = progress.runningIds.includes(resourceId)
    ? progress.runningIds
    : [...progress.runningIds, resourceId];
  return recomputeFixAllDerived({
    ...progress,
    runningIds,
    running: runningIds.length,
    currentMessage: message || progress.currentMessage,
    lastProgressAt: new Date().toISOString(),
  });
}

export function markFixAllItemDone(
  progress: FixAllLiveProgress,
  resourceId: string,
  message?: string,
): FixAllLiveProgress {
  const runningIds = progress.runningIds.filter(id => id !== resourceId);
  const completedIds = progress.completedIds.includes(resourceId)
    ? progress.completedIds
    : [...progress.completedIds, resourceId];
  return recomputeFixAllDerived({
    ...progress,
    runningIds,
    running: runningIds.length,
    completedIds,
    completed: completedIds.length,
    currentMessage: message || progress.currentMessage,
    lastProgressAt: new Date().toISOString(),
  });
}

export function markFixAllItemFailed(
  progress: FixAllLiveProgress,
  resourceId: string,
  message?: string,
): FixAllLiveProgress {
  const runningIds = progress.runningIds.filter(id => id !== resourceId);
  const failedIds = progress.failedIds.includes(resourceId)
    ? progress.failedIds
    : [...progress.failedIds, resourceId];
  return recomputeFixAllDerived({
    ...progress,
    runningIds,
    running: runningIds.length,
    failedIds,
    failed: failedIds.length,
    currentMessage: message || progress.currentMessage,
    lastProgressAt: new Date().toISOString(),
  });
}

export function finalizeFixAllProgress(
  progress: FixAllLiveProgress,
  message?: string,
): FixAllLiveProgress {
  return recomputeFixAllDerived({
    ...progress,
    isRunning: false,
    running: 0,
    runningIds: [],
    currentMessage: message || 'Fix All complete',
  });
}

export function recomputeFixAllDerived(
  progress: FixAllLiveProgress,
  now?: number,
): FixAllLiveProgress {
  const nowMs = now ?? Date.now();
  const startMs = progress.startedAt ? new Date(progress.startedAt).getTime() : nowMs;
  const elapsedMs = nowMs - startMs;
  const finished = progress.completed + progress.failed;
  const remaining = Math.max(progress.total - finished - progress.running, 0);
  const percent = progress.total > 0 ? Math.floor((finished / progress.total) * 100) : 0;

  let etaMs: number | null = null;
  if (finished > 0 && remaining > 0 && progress.isRunning) {
    const avgMs = elapsedMs / finished;
    etaMs = Math.round(avgMs * remaining);
  }

  const lastProgressMs = progress.lastProgressAt
    ? new Date(progress.lastProgressAt).getTime()
    : nowMs;
  const stalled = progress.isRunning && (nowMs - lastProgressMs) > progress.stallThresholdMs;

  return {
    ...progress,
    elapsedMs,
    remaining,
    percent,
    etaMs,
    stalled,
  };
}

export function formatDurationShort(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const totalSeconds = Math.round(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}
