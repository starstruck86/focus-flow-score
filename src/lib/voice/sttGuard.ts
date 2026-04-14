/**
 * STT Guard — Preflight validation, retry policy, and circuit breaker
 * for speech-to-text requests.
 *
 * Prevents wasted credits from:
 * - empty/malformed audio blobs
 * - duplicate submissions
 * - retrying non-retryable errors
 * - rapid-fire failures (circuit breaker)
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('SttGuard');

// ── Preflight Validation ───────────────────────────────────────────

export interface SttPreflightResult {
  valid: boolean;
  reason?: string;
}

const MIN_BLOB_SIZE = 1000; // ~1KB minimum for meaningful audio
const MAX_BLOB_SIZE = 25 * 1024 * 1024; // 25MB max
const MAX_RECORDING_DURATION_MS = 120_000; // 2 min

/** Recent submission fingerprints for dedupe (last 5) */
const recentSubmissions: string[] = [];

export function validateSttRequest(blob: Blob | null | undefined): SttPreflightResult {
  if (!blob) return { valid: false, reason: 'no_blob' };
  if (blob.size === 0) return { valid: false, reason: 'empty_blob' };
  if (blob.size < MIN_BLOB_SIZE) return { valid: false, reason: 'blob_too_small' };
  if (blob.size > MAX_BLOB_SIZE) return { valid: false, reason: 'blob_too_large' };
  if (!blob.type && blob.size < MIN_BLOB_SIZE) return { valid: false, reason: 'no_mime_type' };

  // Dedupe check based on size (rough fingerprint)
  const fingerprint = `${blob.size}_${blob.type}`;
  if (recentSubmissions.includes(fingerprint)) {
    return { valid: false, reason: 'duplicate_submission' };
  }
  recentSubmissions.push(fingerprint);
  if (recentSubmissions.length > 5) recentSubmissions.shift();

  return { valid: true };
}

// ── Retry Policy ───────────────────────────────────────────────────

const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 413, 415, 422]);

export interface SttRetryDecision {
  shouldRetry: boolean;
  reason: string;
}

export function shouldRetryStt(status: number, attempt: number): SttRetryDecision {
  if (NON_RETRYABLE_STATUS.has(status)) {
    return { shouldRetry: false, reason: `non_retryable_${status}` };
  }
  if (attempt >= 1) {
    return { shouldRetry: false, reason: 'max_retries_reached' };
  }
  // Only retry transient errors (5xx, network)
  if (status >= 500) {
    return { shouldRetry: true, reason: 'transient_server_error' };
  }
  return { shouldRetry: false, reason: `unexpected_${status}` };
}

export function getSttRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 4000);
}

// ── Circuit Breaker ────────────────────────────────────────────────

const CIRCUIT_WINDOW_MS = 60_000; // 1 minute window
const CIRCUIT_FAILURE_THRESHOLD = 4; // open after 4 failures in window
const CIRCUIT_RECOVERY_MS = 30_000; // try again after 30s

interface CircuitState {
  failures: number[];
  openedAt: number | null;
}

const circuit: CircuitState = { failures: [], openedAt: null };

export function isCircuitOpen(): boolean {
  if (circuit.openedAt) {
    if (Date.now() - circuit.openedAt > CIRCUIT_RECOVERY_MS) {
      // Half-open: allow one try
      circuit.openedAt = null;
      return false;
    }
    return true;
  }
  return false;
}

export function recordSttFailure(): void {
  const now = Date.now();
  circuit.failures.push(now);
  // Trim old entries
  circuit.failures = circuit.failures.filter(t => now - t < CIRCUIT_WINDOW_MS);
  if (circuit.failures.length >= CIRCUIT_FAILURE_THRESHOLD) {
    circuit.openedAt = now;
    logger.warn('STT circuit breaker opened', { failures: circuit.failures.length });
  }
}

export function recordSttSuccess(): void {
  circuit.failures = [];
  circuit.openedAt = null;
}

// ── Stats ──────────────────────────────────────────────────────────

let sttStats = {
  totalCalls: 0,
  successCalls: 0,
  failedCalls: 0,
  blockedByPreflight: 0,
  blockedByCircuit: 0,
  retriedCalls: 0,
  totalAudioSeconds: 0,
};

export function recordSttCall(success: boolean, audioSeconds?: number): void {
  sttStats.totalCalls++;
  if (success) sttStats.successCalls++;
  else sttStats.failedCalls++;
  if (audioSeconds) sttStats.totalAudioSeconds += audioSeconds;
}

export function recordSttBlocked(reason: 'preflight' | 'circuit'): void {
  if (reason === 'preflight') sttStats.blockedByPreflight++;
  else sttStats.blockedByCircuit++;
}

export function recordSttRetry(): void {
  sttStats.retriedCalls++;
}

export function getSttStats() {
  return { ...sttStats };
}

export function resetSttStats(): void {
  sttStats = {
    totalCalls: 0, successCalls: 0, failedCalls: 0,
    blockedByPreflight: 0, blockedByCircuit: 0,
    retriedCalls: 0, totalAudioSeconds: 0,
  };
}
