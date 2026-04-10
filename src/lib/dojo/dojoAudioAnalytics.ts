/**
 * Dojo Audio Analytics v3
 *
 * Structured telemetry for Dave's audio delivery inside Sales Dojo.
 * Tracks chunk lifecycle, audibility, failures, retries, degradation, recovery,
 * transport details, ownership conflicts, and visibility events.
 */

import { createLogger } from '@/lib/logger';
import type { RestoreReason, ChunkAudibleState } from './dojoAudioController';

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
  chunkDurations: number[];
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

  // ── Transport-level metrics ──
  transportRetryCount: number;
  autoplayBlockedCount: number;
  ownershipConflictCount: number;
  /** How many chunks actually became audible (got 'playing' event). */
  chunksAudible: number;
  /** How many chunks failed before reaching audible state. */
  chunksFailedBeforeAudible: number;
  /** How many chunks failed after reaching audible state. */
  chunksFailedAfterAudible: number;
  /** How many chunks were voice vs text fallback vs replay vs skip. */
  voiceDeliveryCount: number;
  textFallbackDeliveryCount: number;
  /** How many voice restores after degradation. */
  voiceRestoreCount: number;

  // ── Visibility metrics ──
  tabHiddenCount: number;
  tabResumeCount: number;

  // ── Restore reason tracking ──
  lastRestoreReason: RestoreReason;
  restoreReasons: RestoreReason[];
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
    transportRetryCount: 0,
    autoplayBlockedCount: 0,
    ownershipConflictCount: 0,
    chunksAudible: 0,
    chunksFailedBeforeAudible: 0,
    chunksFailedAfterAudible: 0,
    voiceDeliveryCount: 0,
    textFallbackDeliveryCount: 0,
    voiceRestoreCount: 0,
    tabHiddenCount: 0,
    tabResumeCount: 0,
    lastRestoreReason: null,
    restoreReasons: [],
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
    chunksAudible: m.chunksAudible + 1,
    sessionStartedAt: m.sessionStartedAt ?? Date.now(),
  };
}

export function logChunkCompleted(m: DojoAudioMetrics, chunkId: string, durationMs: number): DojoAudioMetrics {
  log.info('chunk_completed', { chunkId, durationMs });
  return {
    ...m,
    chunksCompleted: m.chunksCompleted + 1,
    voiceDeliveryCount: durationMs > 0 ? m.voiceDeliveryCount + 1 : m.voiceDeliveryCount,
    textFallbackDeliveryCount: durationMs === 0 ? m.textFallbackDeliveryCount + 1 : m.textFallbackDeliveryCount,
    totalPlaybackMs: m.totalPlaybackMs + durationMs,
    chunkDurations: durationMs > 0 ? [...m.chunkDurations, durationMs] : m.chunkDurations,
  };
}

export function logChunkFailed(m: DojoAudioMetrics, chunkId: string, error: string): DojoAudioMetrics {
  log.warn('chunk_failed', { chunkId, error });
  const isAutoplay = error.includes('autoplay_blocked');
  return {
    ...m,
    chunksFailed: m.chunksFailed + 1,
    autoplayBlockedCount: isAutoplay ? m.autoplayBlockedCount + 1 : m.autoplayBlockedCount,
  };
}

export function logChunkFailedAudibility(m: DojoAudioMetrics, state: ChunkAudibleState): DojoAudioMetrics {
  if (state === 'failed_before_audible') {
    return { ...m, chunksFailedBeforeAudible: m.chunksFailedBeforeAudible + 1 };
  }
  if (state === 'failed_after_audible') {
    return { ...m, chunksFailedAfterAudible: m.chunksFailedAfterAudible + 1 };
  }
  return m;
}

export function logChunkTimedOut(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.warn('chunk_timed_out', { chunkId });
  return { ...m, chunksTimedOut: m.chunksTimedOut + 1 };
}

export function logChunkSkipped(m: DojoAudioMetrics, chunkId: string): DojoAudioMetrics {
  log.info('chunk_skipped', { chunkId });
  return { ...m, chunksSkipped: m.chunksSkipped + 1 };
}

export function logRetryAttempt(m: DojoAudioMetrics, chunkId: string, attempt: number): DojoAudioMetrics {
  log.info('chunk_retry', { chunkId, attempt });
  return { ...m, retryAttempts: m.retryAttempts + 1, transportRetryCount: m.transportRetryCount + 1 };
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
  const isVoiceRestore = context.includes('voice') || context.includes('reconnect') || context.includes('user_requested');
  return {
    ...m,
    recoveryEvents: m.recoveryEvents + 1,
    voiceRestoreCount: isVoiceRestore ? m.voiceRestoreCount + 1 : m.voiceRestoreCount,
  };
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

export function logOwnershipConflict(m: DojoAudioMetrics): DojoAudioMetrics {
  log.warn('ownership_conflict');
  return { ...m, ownershipConflictCount: m.ownershipConflictCount + 1 };
}

export function logTabHidden(m: DojoAudioMetrics): DojoAudioMetrics {
  log.debug('tab_hidden');
  return { ...m, tabHiddenCount: m.tabHiddenCount + 1 };
}

export function logTabResume(m: DojoAudioMetrics): DojoAudioMetrics {
  log.debug('tab_resumed');
  return { ...m, tabResumeCount: m.tabResumeCount + 1 };
}

export function logRestoreReason(m: DojoAudioMetrics, reason: RestoreReason): DojoAudioMetrics {
  if (!reason) return m;
  log.info('restore_reason', { reason });
  return { ...m, lastRestoreReason: reason, restoreReasons: [...m.restoreReasons, reason] };
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
  transportRetries: number;
  autoplayBlocked: number;
  ownershipConflicts: number;
  chunksAudible: number;
  chunksFailedBeforeAudible: number;
  chunksFailedAfterAudible: number;
  voiceDeliveries: number;
  textFallbackDeliveries: number;
  voiceRestores: number;
  tabHiddenCount: number;
  tabResumeCount: number;
  lastRestoreReason: RestoreReason;
  restoreReasons: RestoreReason[];
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
    transportRetries: m.transportRetryCount,
    autoplayBlocked: m.autoplayBlockedCount,
    ownershipConflicts: m.ownershipConflictCount,
    chunksAudible: m.chunksAudible,
    chunksFailedBeforeAudible: m.chunksFailedBeforeAudible,
    chunksFailedAfterAudible: m.chunksFailedAfterAudible,
    voiceDeliveries: m.voiceDeliveryCount,
    textFallbackDeliveries: m.textFallbackDeliveryCount,
    voiceRestores: m.voiceRestoreCount,
    tabHiddenCount: m.tabHiddenCount,
    tabResumeCount: m.tabResumeCount,
    lastRestoreReason: m.lastRestoreReason,
    restoreReasons: m.restoreReasons,
  };
}

export function logSessionSummary(m: DojoAudioMetrics): void {
  const summary = summarizeSession(m);
  log.info('dojo_audio_session_summary', summary);
}
