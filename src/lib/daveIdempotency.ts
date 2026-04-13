/**
 * Dave Idempotency Layer — Prevents duplicate scoring, persistence, and state advancement
 * when queued operations are replayed after signal recovery.
 *
 * Uses operation keys to deduplicate. Each operation gets a deterministic key
 * based on surface + session + position, so replaying the same op is safe.
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveIdempotency');

const COMPLETED_OPS_KEY = 'dave_completed_ops';
const MAX_OPS = 200;
const EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

interface CompletedOp {
  key: string;
  completedAt: number;
}

function loadCompletedOps(): CompletedOp[] {
  try {
    const raw = localStorage.getItem(COMPLETED_OPS_KEY);
    if (!raw) return [];
    const ops = JSON.parse(raw) as CompletedOp[];
    const cutoff = Date.now() - EXPIRY_MS;
    return ops.filter(o => o.completedAt > cutoff);
  } catch {
    return [];
  }
}

function saveCompletedOps(ops: CompletedOp[]): void {
  try {
    // Keep bounded
    const bounded = ops.slice(-MAX_OPS);
    localStorage.setItem(COMPLETED_OPS_KEY, JSON.stringify(bounded));
  } catch { /* noop */ }
}

/**
 * Generate a deterministic operation key for deduplication.
 */
export function makeOpKey(
  surface: string,
  sessionId: string,
  position: number,
  opType: 'score' | 'persist' | 'advance',
): string {
  return `${surface}:${sessionId}:${position}:${opType}`;
}

/**
 * Check if an operation has already been completed.
 */
export function isOpCompleted(opKey: string): boolean {
  const ops = loadCompletedOps();
  return ops.some(o => o.key === opKey);
}

/**
 * Mark an operation as completed (idempotency guard).
 */
export function markOpCompleted(opKey: string): void {
  const ops = loadCompletedOps();
  if (ops.some(o => o.key === opKey)) return; // already there
  ops.push({ key: opKey, completedAt: Date.now() });
  saveCompletedOps(ops);
  logger.info('Op marked completed', { opKey });
}

/**
 * Run an operation with idempotency protection.
 * Returns null if already completed, otherwise runs and marks complete.
 */
export async function runIdempotent<T>(
  opKey: string,
  execute: () => Promise<T>,
): Promise<T | null> {
  if (isOpCompleted(opKey)) {
    logger.info('Skipping duplicate op', { opKey });
    return null;
  }

  const result = await execute();
  markOpCompleted(opKey);
  return result;
}

/**
 * Clear all idempotency records (e.g., on session end).
 */
export function clearIdempotencyRecords(): void {
  try { localStorage.removeItem(COMPLETED_OPS_KEY); } catch { /* noop */ }
}
