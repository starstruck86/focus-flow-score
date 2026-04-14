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

/**
 * Dedupe using submission ID + timestamp window.
 * Each submission gets a lightweight fingerprint from a unique ID and content hash.
 * Submissions within a short time window with matching fingerprints are blocked.
 */
interface SubmissionRecord {
  fingerprint: string;
  timestamp: number;
}

const DEDUPE_WINDOW_MS = 3000; // 3 second window
const recentSubmissions: SubmissionRecord[] = [];

/**
 * Generate a lightweight content fingerprint by sampling the blob.
 * Reads first 64 bytes + size + type for fast uniqueness without full hash.
 */
async function blobFingerprint(blob: Blob): Promise<string> {
  const sampleSize = Math.min(64, blob.size);
  const sliced = blob.slice(0, sampleSize);
  const sample = await new Response(sliced).arrayBuffer();
  const bytes = new Uint8Array(sample);
  let hash = blob.size ^ (blob.type.length << 16);
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) - hash + bytes[i]) | 0;
  }
  return `${hash >>> 0}_${blob.size}`;
}

export function validateSttRequest(blob: Blob | null | undefined): SttPreflightResult {
  if (!blob) return { valid: false, reason: 'no_blob' };
  if (blob.size === 0) return { valid: false, reason: 'empty_blob' };
  if (blob.size < MIN_BLOB_SIZE) return { valid: false, reason: 'blob_too_small' };
  if (blob.size > MAX_BLOB_SIZE) return { valid: false, reason: 'blob_too_large' };
  return { valid: true };
}

/**
 * Async duplicate check using content fingerprint + timestamp window.
 * Call AFTER validateSttRequest passes.
 */
export async function checkSttDuplicate(blob: Blob): Promise<{ isDuplicate: boolean }> {
  const now = Date.now();
  // Prune old entries
  while (recentSubmissions.length > 0 && now - recentSubmissions[0].timestamp > DEDUPE_WINDOW_MS) {
    recentSubmissions.shift();
  }

  const fp = await blobFingerprint(blob);
  if (recentSubmissions.some(s => s.fingerprint === fp)) {
    return { isDuplicate: true };
  }

  recentSubmissions.push({ fingerprint: fp, timestamp: now });
  // Keep bounded
  if (recentSubmissions.length > 10) recentSubmissions.shift();

  return { isDuplicate: false };
}

// ── Retry Policy (shared by STT and TTS) ───────────────────────────

const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 413, 415, 422]);

export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
}

export function shouldRetryRequest(status: number, attempt: number, maxRetries: number = 1): RetryDecision {
  if (NON_RETRYABLE_STATUS.has(status)) {
    return { shouldRetry: false, reason: `non_retryable_${status}` };
  }
  if (attempt >= maxRetries) {
    return { shouldRetry: false, reason: 'max_retries_reached' };
  }
  if (status >= 500 || status === 429) {
    return { shouldRetry: true, reason: 'transient_server_error' };
  }
  return { shouldRetry: false, reason: `unexpected_${status}` };
}

/** Alias for backward compat */
export const shouldRetryStt = (status: number, attempt: number) =>
  shouldRetryRequest(status, attempt, 1);

/** TTS retry: allows up to 2 retries, same non-retryable classification */
export const shouldRetryTts = (status: number, attempt: number) =>
  shouldRetryRequest(status, attempt, 2);

export function getRetryDelay(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt), 4000);
}

export const getSttRetryDelay = getRetryDelay;

// ── Circuit Breaker ────────────────────────────────────────────────

const CIRCUIT_WINDOW_MS = 60_000;
const CIRCUIT_FAILURE_THRESHOLD = 4;
const CIRCUIT_RECOVERY_MS = 30_000;

interface CircuitState {
  failures: number[];
  openedAt: number | null;
}

const circuit: CircuitState = { failures: [], openedAt: null };

export function isCircuitOpen(): boolean {
  if (circuit.openedAt) {
    if (Date.now() - circuit.openedAt > CIRCUIT_RECOVERY_MS) {
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
  blockedByDuplicate: 0,
  retriedCalls: 0,
  totalAudioSeconds: 0,
};

export function recordSttCall(success: boolean, audioSeconds?: number): void {
  sttStats.totalCalls++;
  if (success) sttStats.successCalls++;
  else sttStats.failedCalls++;
  if (audioSeconds) sttStats.totalAudioSeconds += audioSeconds;
}

export function recordSttBlocked(reason: 'preflight' | 'circuit' | 'duplicate'): void {
  if (reason === 'preflight') sttStats.blockedByPreflight++;
  else if (reason === 'circuit') sttStats.blockedByCircuit++;
  else sttStats.blockedByDuplicate++;
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
    blockedByPreflight: 0, blockedByCircuit: 0, blockedByDuplicate: 0,
    retriedCalls: 0, totalAudioSeconds: 0,
  };
}

// ── Reset circuit (for testing) ────────────────────────────────────

export function resetCircuit(): void {
  circuit.failures = [];
  circuit.openedAt = null;
}
