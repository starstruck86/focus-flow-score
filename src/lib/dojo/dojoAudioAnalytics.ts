/**
 * Dojo Audio Analytics
 *
 * Structured telemetry for Dave's audio delivery inside Sales Dojo.
 * Tracks chunk lifecycle, failures, retries, degradation, and recovery
 * so we can measure whether Dave is truly reliable in production.
 *
 * No side effects beyond logging. No UI coupling.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('DojoAudio');

// ── Metrics Accumulator ────────────────────────────────────────────

export interface DojoAudioMetrics {
  chunksRequested: number;
  chunksStarted: number;
  chunksCompleted: number;
  chunksFailed: number;
  chunksSkipped: number;
  chunksTimedOut: number;
  retryAttempts: number;
  degradationEvents: number;
  recoveryEvents: number;
  replaysRequested: number;
  skipsRequested: number;
  interruptions: number;
  totalPlaybackMs: number;
  chunkDurations: number[]; // individual durations for avg/p95
  sessionStartedAt: number | null;

  // ── Crash/recovery debugging metrics ──
  crashRecoveryCount: number;
  snapshotRestoreCount: number;
  resumedFromAmbiguousCount: number;
  replayDeliveryCount: number;
  normalDeliveryCount: number;
  chunkLevelDegradeCount: number;
  sessionLevelDegradeCount: number;
  duplicateCallbackSuppressions: number;
  staleCallbackSuppressions: number;
}

export function createMetrics(): DojoAudioMetrics {
  return {
    chunksRequested: 0,
    chunksStarted: 0,
    chunksCompleted: 0,
    chunksFailed: 0,
    chunksSkipped: 0,
    chunksTimedOut: 0,
    retryAttempts: 0,
    degradationEvents: 0,
    recoveryEvents: 0,
    replaysRequested: 0,
    skipsRequested: 0,
    interruptions: 0,
    totalPlaybackMs: 0,
    chunkDurations: [],
    sessionStartedAt: null,
    crashRecoveryCount: 0,
    snapshotRestoreCount: 0,
    resumedFromAmbiguousCount: 0,
    replayDeliveryCount: 0,
    normalDeliveryCount: 0,
    chunkLevelDegradeCount: 0,
    sessionLevelDegradeCount: 0,
    duplicateCallbackSuppressions: 0,
    staleCallbackSuppressions: 0,
  };
}

// ── Event Loggers ──────────────────────────────────────────────────

export function logChunkRequested(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.debug('chunk_requested', { chunkId });
  return { ...m, chunksRequested: m.chunksRequested + 1, normalDeliveryCount: m.normalDeliveryCount + 1 };
}

export function logChunkStarted(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.debug('chunk_started', { chunkId });
  return {
    ...m,
    chunksStarted: m.chunksStarted + 1,
    sessionStartedAt: m.sessionStartedAt ?? Date.now(),
  };
}

export function logChunkCompleted(
  m: DojoAudioMetrics,
  chunkId: string,
  durationMs: number
): DojoAudioMetrics {
  log.info('chunk_completed', { chunkId, durationMs });
  return {
    ...m,
    chunksCompleted: m.chunksCompleted + 1,
    totalPlaybackMs: m.totalPlaybackMs + durationMs,
    chunkDurations: [...m.chunkDurations, durationMs],
  };
}

export function logChunkFailed(
  m: DojoAudioMetrics,
  chunkId: string,
  error: string
): DojoAudioMetrics {
  log.warn('chunk_failed', { chunkId, error });
  return { ...m, chunksFailed: m.chunksFailed + 1 };
}

export function logChunkTimedOut(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.warn('chunk_timed_out', { chunkId });
  return { ...m, chunksTimedOut: m.chunksTimedOut + 1 };
}

export function logChunkSkipped(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.info('chunk_skipped', { chunkId });
  return { ...m, chunksSkipped: m.chunksSkipped + 1 };
}

export function logRetryAttempt(
  m: DojoAudioMetrics,
  chunkId: string,
  attempt: number
): DojoAudioMetrics {
  log.info('chunk_retry', { chunkId, attempt });
  return { ...m, retryAttempts: m.retryAttempts + 1 };
}

export function logDegradation(m: DojoAudioMetrics, reason: string): DojoAudioMetrics {
  log.warn('voice_degraded_to_text', { reason });
  return { ...m, degradationEvents: m.degradationEvents + 1 };
}

export function logChunkLevelDegrade(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.warn('chunk_level_degrade', { chunkId });
  return { ...m, chunkLevelDegradeCount: m.chunkLevelDegradeCount + 1 };
}

export function logSessionLevelDegrade(m: DojoAudioMetrics, reason: string): DojoAudioMetrics {
  log.warn('session_level_degrade', { reason });
  return { ...m, sessionLevelDegradeCount: m.sessionLevelDegradeCount + 1 };
}

export function logRecovery(m: DojoAudioMetrics, context: string): DojoAudioMetrics {
  log.info('session_recovered', { context });
  return { ...m, recoveryEvents: m.recoveryEvents + 1 };
}

export function logCrashRecovery(m: DojoAudioMetrics, context: string): DojoAudioMetrics {
  log.info('crash_recovery', { context });
  return { ...m, crashRecoveryCount: m.crashRecoveryCount + 1, snapshotRestoreCount: m.snapshotRestoreCount + 1 };
}

export function logAmbiguousResume(m: DojoAudioMetrics): DojoAudioMetrics {
  log.warn('resumed_from_ambiguous_state');
  return { ...m, resumedFromAmbiguousCount: m.resumedFromAmbiguousCount + 1 };
}

export function logReplay(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.info('replay_requested', { chunkId });
  return { ...m, replaysRequested: m.replaysRequested + 1, replayDeliveryCount: m.replayDeliveryCount + 1 };
}

export function logSkip(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.info('skip_requested', { chunkId });
  return { ...m, skipsRequested: m.skipsRequested + 1 };
}

export function logInterruption(m: DojoAudioMetrics): DojoAudioMetrics {
  log.info('user_interrupted');
  return { ...m, interruptions: m.interruptions + 1 };
}

export function logDuplicateSuppressed(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.debug('duplicate_callback_suppressed', { chunkId });
  return { ...m, duplicateCallbackSuppressions: m.duplicateCallbackSuppressions + 1 };
}

export function logStaleSuppressed(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.debug('stale_callback_suppressed', { chunkId });
  return { ...m, staleCallbackSuppressions: m.staleCallbackSuppressions + 1 };
}

// ── Summary ────────────────────────────────────────────────────────

export interface AudioSessionSummary {
  totalChunks: number;
  completed: number;
  failed: number;
  skipped: number;
  timedOut: number;
  retries: number;
  degradations: number;
  recoveries: number;
  avgChunkDurationMs: number;
  p95ChunkDurationMs: number;
  sessionDurationMs: number;
  successRate: number;
  crashRecoveries: number;
  snapshotRestores: number;
  ambiguousResumes: number;
  replayDeliveries: number;
  normalDeliveries: number;
  chunkDegrades: number;
  sessionDegrades: number;
  duplicateSuppressions: number;
  staleSuppressions: number;
}

export function summarizeSession(m: DojoAudioMetrics): AudioSessionSummary {
  const sorted = [...m.chunkDurations].sort((a, b) => a - b);
  const p95Index = Math.min(Math.floor(sorted.length * 0.95), sorted.length - 1);

  return {
    totalChunks: m.chunksRequested,
    completed: m.chunksCompleted,
    failed: m.chunksFailed,
    skipped: m.chunksSkipped,
    timedOut: m.chunksTimedOut,
    retries: m.retryAttempts,
    degradations: m.degradationEvents,
    recoveries: m.recoveryEvents,
    avgChunkDurationMs:
      m.chunkDurations.length > 0
        ? Math.round(m.totalPlaybackMs / m.chunkDurations.length)
        : 0,
    p95ChunkDurationMs: sorted.length > 0 ? sorted[p95Index] : 0,
    sessionDurationMs: m.sessionStartedAt ? Date.now() - m.sessionStartedAt : 0,
    successRate:
      m.chunksRequested > 0
        ? Math.round((m.chunksCompleted / m.chunksRequested) * 100)
        : 0,
    crashRecoveries: m.crashRecoveryCount,
    snapshotRestores: m.snapshotRestoreCount,
    ambiguousResumes: m.resumedFromAmbiguousCount,
    replayDeliveries: m.replayDeliveryCount,
    normalDeliveries: m.normalDeliveryCount,
    chunkDegrades: m.chunkLevelDegradeCount,
    sessionDegrades: m.sessionLevelDegradeCount,
    duplicateSuppressions: m.duplicateCallbackSuppressions,
    staleSuppressions: m.staleCallbackSuppressions,
  };
}

export function logSessionSummary(m: DojoAudioMetrics): void {
  const summary = summarizeSession(m);
  log.info('dojo_audio_session_summary', summary);
}
