/**
 * Dojo Reliability V3 — Self-Healing & Health Intelligence
 *
 * Layered ON TOP of existing controller/transport/analytics.
 * Provides:
 * 1. Forward-progress detector (hang detection)
 * 2. Audible confirmation guard (min audible duration)
 * 3. Real-time health classification (HEALTHY → FAILING)
 * 4. Recovery confidence scoring
 * 5. Session-level reliability telemetry
 *
 * Does NOT replace any existing invariant or controller logic.
 */

import { createLogger } from '@/lib/logger';

const log = createLogger('ReliabilityV3');

// ── Health Classification ─────────────────────────────────────────

export type SessionHealth = 'HEALTHY' | 'DEGRADED' | 'UNSTABLE' | 'FAILING';

export interface HealthScore {
  status: SessionHealth;
  /** 0-100 composite score */
  score: number;
  /** What's driving the current status */
  reasons: string[];
  /** Timestamp of last assessment */
  assessedAt: number;
}

export interface ReliabilityMetrics {
  /** Consecutive chunks completed without failure */
  consecutiveSuccesses: number;
  /** Total forward-progress events (chunk completed, text shown) */
  forwardProgressCount: number;
  /** Timestamp of last forward progress */
  lastProgressAt: number;
  /** Timestamps of recent failures (sliding window, last 60s) */
  recentFailureTimestamps: number[];
  /** Recovery attempts and their outcomes */
  recoveryAttempts: RecoveryAttempt[];
  /** Audible confirmation results */
  audibleConfirmations: AudibleResult[];
  /** Current health */
  health: HealthScore;
  /** Hang detection state */
  hangDetector: HangDetectorState;
}

export interface RecoveryAttempt {
  timestamp: number;
  action: 'retry' | 'skip' | 'degrade_text' | 'restart_delivery';
  confidence: 'high' | 'medium' | 'low';
  succeeded: boolean | null; // null = pending
  chunkId?: string;
}

export interface AudibleResult {
  chunkId: string;
  playAttemptedAt: number;
  audibleAt: number | null;
  endedAt: number | null;
  /** Whether audio met minimum audible duration */
  confirmed: boolean;
  durationMs: number;
}

// ── Hang Detection ────────────────────────────────────────────────

export interface HangDetectorState {
  /** Whether the detector is armed (session is active) */
  armed: boolean;
  /** Timestamp of last forward progress */
  lastProgressAt: number;
  /** Number of hang warnings issued this session */
  hangWarnings: number;
  /** Whether we're currently in a hang state */
  isHung: boolean;
}

/** No forward progress for this long → first warning */
const HANG_WARNING_MS = 30_000;
/** No forward progress for this long → trigger recovery */
const HANG_RECOVERY_MS = 45_000;
/** Minimum audible duration to consider a chunk "heard" */
const MIN_AUDIBLE_MS = 300;
/** Sliding window for failure rate calculation */
const FAILURE_WINDOW_MS = 60_000;
/** Max recovery attempts before giving up on voice */
const MAX_RECOVERY_CHAIN = 4;
/** Max entries kept for sliding-window buffers (prevents memory growth in long sessions) */
const MAX_FAILURE_TIMESTAMPS = 50;
const MAX_RECOVERY_ATTEMPTS = 20;
const MAX_AUDIBLE_CONFIRMATIONS = 20;

// ── Factory ───────────────────────────────────────────────────────

export function createReliabilityMetrics(): ReliabilityMetrics {
  return {
    consecutiveSuccesses: 0,
    forwardProgressCount: 0,
    lastProgressAt: Date.now(),
    recentFailureTimestamps: [],
    recoveryAttempts: [],
    audibleConfirmations: [],
    health: { status: 'HEALTHY', score: 100, reasons: [], assessedAt: Date.now() },
    hangDetector: { armed: false, lastProgressAt: Date.now(), hangWarnings: 0, isHung: false },
  };
}

// ── Forward Progress Tracking ─────────────────────────────────────

export function onForwardProgress(m: ReliabilityMetrics): ReliabilityMetrics {
  const now = Date.now();
  return {
    ...m,
    consecutiveSuccesses: m.consecutiveSuccesses + 1,
    forwardProgressCount: m.forwardProgressCount + 1,
    lastProgressAt: now,
    hangDetector: { ...m.hangDetector, lastProgressAt: now, isHung: false, hangWarnings: 0 },
    health: assessHealth({ ...m, consecutiveSuccesses: m.consecutiveSuccesses + 1, lastProgressAt: now }),
  };
}

export function onFailure(m: ReliabilityMetrics, chunkId?: string): ReliabilityMetrics {
  const now = Date.now();
  const recentFailures = [...m.recentFailureTimestamps.filter(t => now - t < FAILURE_WINDOW_MS), now]
    .slice(-MAX_FAILURE_TIMESTAMPS);
  const updated = {
    ...m,
    consecutiveSuccesses: 0,
    recentFailureTimestamps: recentFailures,
  };
  return { ...updated, health: assessHealth(updated) };
}

// ── Audible Confirmation ──────────────────────────────────────────

export function startAudibleTracking(m: ReliabilityMetrics, chunkId: string): ReliabilityMetrics {
  const entry: AudibleResult = {
    chunkId,
    playAttemptedAt: Date.now(),
    audibleAt: null,
    endedAt: null,
    confirmed: false,
    durationMs: 0,
  };
  return { ...m, audibleConfirmations: [...m.audibleConfirmations.slice(-(MAX_AUDIBLE_CONFIRMATIONS - 1)), entry] };
}

export function confirmAudible(m: ReliabilityMetrics, chunkId: string): ReliabilityMetrics {
  const now = Date.now();
  return {
    ...m,
    audibleConfirmations: m.audibleConfirmations.map(a =>
      a.chunkId === chunkId && !a.audibleAt ? { ...a, audibleAt: now } : a
    ),
  };
}

export function finalizeAudible(m: ReliabilityMetrics, chunkId: string): ReliabilityMetrics {
  const now = Date.now();
  return {
    ...m,
    audibleConfirmations: m.audibleConfirmations.map(a => {
      if (a.chunkId !== chunkId || a.endedAt) return a;
      const duration = a.audibleAt ? now - a.audibleAt : 0;
      return { ...a, endedAt: now, durationMs: duration, confirmed: duration >= MIN_AUDIBLE_MS };
    }),
  };
}

/** Check if a chunk was confirmed audible for minimum duration */
export function wasChunkAudible(m: ReliabilityMetrics, chunkId: string): boolean {
  const entry = m.audibleConfirmations.find(a => a.chunkId === chunkId);
  return entry?.confirmed ?? false;
}

// ── Hang Detection ────────────────────────────────────────────────

export interface HangCheckResult {
  action: 'none' | 'warn' | 'recover';
  staleDurationMs: number;
}

export function checkForHang(m: ReliabilityMetrics): HangCheckResult {
  if (!m.hangDetector.armed) return { action: 'none', staleDurationMs: 0 };

  const stale = Date.now() - m.hangDetector.lastProgressAt;

  if (stale >= HANG_RECOVERY_MS) {
    return { action: 'recover', staleDurationMs: stale };
  }
  if (stale >= HANG_WARNING_MS) {
    return { action: 'warn', staleDurationMs: stale };
  }
  return { action: 'none', staleDurationMs: stale };
}

export function armHangDetector(m: ReliabilityMetrics): ReliabilityMetrics {
  return { ...m, hangDetector: { ...m.hangDetector, armed: true, lastProgressAt: Date.now() } };
}

export function disarmHangDetector(m: ReliabilityMetrics): ReliabilityMetrics {
  return { ...m, hangDetector: { ...m.hangDetector, armed: false, isHung: false } };
}

export function markHangWarning(m: ReliabilityMetrics): ReliabilityMetrics {
  log.warn('hang_warning', { staleSince: m.hangDetector.lastProgressAt, warnings: m.hangDetector.hangWarnings + 1 });
  return { ...m, hangDetector: { ...m.hangDetector, hangWarnings: m.hangDetector.hangWarnings + 1 } };
}

export function markHung(m: ReliabilityMetrics): ReliabilityMetrics {
  log.error('session_hung', { staleSince: m.hangDetector.lastProgressAt });
  return { ...m, hangDetector: { ...m.hangDetector, isHung: true } };
}

// ── Recovery Confidence ───────────────────────────────────────────

export type RecoveryStrategy = 'retry_chunk' | 'skip_chunk' | 'degrade_text' | 'restart_from_checkpoint';

export function determineRecoveryStrategy(m: ReliabilityMetrics): { strategy: RecoveryStrategy; confidence: 'high' | 'medium' | 'low' } {
  const recentFailures = m.recentFailureTimestamps.filter(t => Date.now() - t < FAILURE_WINDOW_MS).length;
  const recentRecoveries = m.recoveryAttempts.filter(r => Date.now() - r.timestamp < FAILURE_WINDOW_MS);
  const failedRecoveries = recentRecoveries.filter(r => r.succeeded === false).length;

  // If recoveries keep failing, degrade
  if (failedRecoveries >= MAX_RECOVERY_CHAIN) {
    return { strategy: 'degrade_text', confidence: 'high' };
  }

  // Hung → restart from checkpoint
  if (m.hangDetector.isHung) {
    return { strategy: 'restart_from_checkpoint', confidence: 'low' };
  }

  // Low failure rate → simple retry
  if (recentFailures <= 1 && m.consecutiveSuccesses >= 2) {
    return { strategy: 'retry_chunk', confidence: 'high' };
  }

  // Moderate failures → skip the problematic chunk
  if (recentFailures <= 3) {
    return { strategy: 'skip_chunk', confidence: 'medium' };
  }

  // High failure rate → degrade
  return { strategy: 'degrade_text', confidence: 'medium' };
}

export function logRecoveryAttempt(
  m: ReliabilityMetrics,
  action: RecoveryAttempt['action'],
  confidence: RecoveryAttempt['confidence'],
  chunkId?: string
): ReliabilityMetrics {
  const attempt: RecoveryAttempt = { timestamp: Date.now(), action, confidence, succeeded: null, chunkId };
  log.info('recovery_attempt', { action, confidence, chunkId });
  return { ...m, recoveryAttempts: [...m.recoveryAttempts.slice(-(MAX_RECOVERY_ATTEMPTS - 1)), attempt] };
}

export function resolveRecoveryAttempt(m: ReliabilityMetrics, succeeded: boolean): ReliabilityMetrics {
  const attempts = [...m.recoveryAttempts];
  let lastPending = -1;
  for (let i = attempts.length - 1; i >= 0; i--) {
    if (attempts[i].succeeded === null) { lastPending = i; break; }
  }
  if (lastPending >= 0) {
    attempts[lastPending] = { ...attempts[lastPending], succeeded };
  }
  return { ...m, recoveryAttempts: attempts };
}

// ── Health Assessment ─────────────────────────────────────────────

function assessHealth(m: ReliabilityMetrics): HealthScore {
  const now = Date.now();
  const reasons: string[] = [];
  let score = 100;

  // Factor 1: Recent failure rate
  const recentFailures = m.recentFailureTimestamps.filter(t => now - t < FAILURE_WINDOW_MS).length;
  if (recentFailures > 0) {
    score -= recentFailures * 15;
    reasons.push(`${recentFailures} failures in last 60s`);
  }

  // Factor 2: Consecutive successes (positive signal)
  if (m.consecutiveSuccesses >= 5) {
    score = Math.min(100, score + 10);
  }

  // Factor 3: Audible confirmation rate
  const recentAudible = m.audibleConfirmations.slice(-5);
  if (recentAudible.length >= 3) {
    const confirmed = recentAudible.filter(a => a.confirmed).length;
    const rate = confirmed / recentAudible.length;
    if (rate < 0.5) {
      score -= 20;
      reasons.push(`Low audible rate: ${Math.round(rate * 100)}%`);
    }
  }

  // Factor 4: Recovery chain depth
  const pendingRecoveries = m.recoveryAttempts.filter(r => r.succeeded === null).length;
  const failedRecoveries = m.recoveryAttempts.filter(r => r.succeeded === false && now - r.timestamp < FAILURE_WINDOW_MS).length;
  if (failedRecoveries >= 2) {
    score -= 25;
    reasons.push(`${failedRecoveries} failed recoveries`);
  }

  // Factor 5: Hang state
  if (m.hangDetector.isHung) {
    score -= 40;
    reasons.push('Session hung');
  } else if (m.hangDetector.hangWarnings > 0) {
    score -= 15;
    reasons.push(`${m.hangDetector.hangWarnings} hang warnings`);
  }

  // Clamp
  score = Math.max(0, Math.min(100, score));

  let status: SessionHealth;
  if (score >= 75) status = 'HEALTHY';
  else if (score >= 50) status = 'DEGRADED';
  else if (score >= 25) status = 'UNSTABLE';
  else status = 'FAILING';

  return { status, score, reasons, assessedAt: now };
}

// ── Serializable Summary ──────────────────────────────────────────

export interface ReliabilitySummary {
  health: HealthScore;
  forwardProgressCount: number;
  consecutiveSuccesses: number;
  recentFailureCount: number;
  hangWarnings: number;
  isHung: boolean;
  recoveryAttempts: number;
  recoverySuccessRate: number;
  audibleConfirmationRate: number;
  lastProgressAgoMs: number;
}

export function summarizeReliability(m: ReliabilityMetrics): ReliabilitySummary {
  const now = Date.now();
  const recentFailures = m.recentFailureTimestamps.filter(t => now - t < FAILURE_WINDOW_MS).length;
  const resolvedRecoveries = m.recoveryAttempts.filter(r => r.succeeded !== null);
  const successfulRecoveries = resolvedRecoveries.filter(r => r.succeeded).length;
  const confirmedAudible = m.audibleConfirmations.filter(a => a.confirmed).length;

  return {
    health: m.health,
    forwardProgressCount: m.forwardProgressCount,
    consecutiveSuccesses: m.consecutiveSuccesses,
    recentFailureCount: recentFailures,
    hangWarnings: m.hangDetector.hangWarnings,
    isHung: m.hangDetector.isHung,
    recoveryAttempts: m.recoveryAttempts.length,
    recoverySuccessRate: resolvedRecoveries.length > 0 ? successfulRecoveries / resolvedRecoveries.length : 1,
    audibleConfirmationRate: m.audibleConfirmations.length > 0 ? confirmedAudible / m.audibleConfirmations.length : 1,
    lastProgressAgoMs: now - m.lastProgressAt,
  };
}
