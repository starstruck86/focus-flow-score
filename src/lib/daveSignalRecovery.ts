/**
 * Dave Signal Recovery — Resilience layer for voice sessions during driving.
 *
 * Handles:
 * - Detecting connectivity loss
 * - Buffering pending operations (scoring, persistence)
 * - Replaying queued work on reconnect
 * - Calm Dave messaging during outages
 *
 * Does NOT:
 * - Fake scores
 * - Skip required operations
 * - Discard user responses
 */

import { createLogger } from '@/lib/logger';
import { isOnline } from '@/lib/sessionRecovery';

const logger = createLogger('DaveSignalRecovery');

// ── Connectivity Monitor ──────────────────────────────────────

export interface ConnectivityState {
  online: boolean;
  lastOnlineAt: number;
  lastOfflineAt: number | null;
  offlineDurationMs: number;
  /** Number of connectivity drops this session */
  dropCount: number;
}

export function createConnectivityState(): ConnectivityState {
  return {
    online: isOnline(),
    lastOnlineAt: Date.now(),
    lastOfflineAt: null,
    offlineDurationMs: 0,
    dropCount: 0,
  };
}

export type ConnectivityListener = (state: ConnectivityState) => void;

/**
 * Monitor connectivity changes. Returns cleanup function.
 */
export function monitorConnectivity(
  onChange: ConnectivityListener,
): () => void {
  const state = createConnectivityState();

  const handleOnline = () => {
    state.online = true;
    state.lastOnlineAt = Date.now();
    if (state.lastOfflineAt) {
      state.offlineDurationMs = Date.now() - state.lastOfflineAt;
    }
    logger.info('Signal restored', { offlineMs: state.offlineDurationMs });
    onChange({ ...state });
  };

  const handleOffline = () => {
    state.online = false;
    state.lastOfflineAt = Date.now();
    state.dropCount++;
    logger.info('Signal lost', { dropCount: state.dropCount });
    onChange({ ...state });
  };

  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);

  return () => {
    window.removeEventListener('online', handleOnline);
    window.removeEventListener('offline', handleOffline);
  };
}

// ── Pending Operation Queue ───────────────────────────────────

export type QueuedOpType = 'score' | 'persist' | 'tts';

export interface QueuedOperation {
  id: string;
  type: QueuedOpType;
  /** The async function to retry */
  execute: () => Promise<unknown>;
  /** Human-readable label for debugging */
  label: string;
  createdAt: number;
  attempts: number;
  maxAttempts: number;
}

/**
 * In-memory operation queue for replay on reconnect.
 * Not persisted — for transient signal drops during a single session.
 */
export class OperationQueue {
  private queue: QueuedOperation[] = [];
  private processing = false;

  get length(): number { return this.queue.length; }
  get isEmpty(): boolean { return this.queue.length === 0; }

  enqueue(
    type: QueuedOpType,
    execute: () => Promise<unknown>,
    label: string,
    maxAttempts = 10,
  ): string {
    const id = crypto.randomUUID();
    this.queue.push({ id, type, execute, label, createdAt: Date.now(), attempts: 0, maxAttempts });
    logger.info('Operation queued', { id, type, label });
    return id;
  }

  /**
   * Process all queued operations. Returns count of successfully replayed ops.
   */
  async processAll(onProgress?: (remaining: number) => void): Promise<number> {
    if (this.processing) return 0;
    this.processing = true;

    let succeeded = 0;
    const failed: QueuedOperation[] = [];

    while (this.queue.length > 0) {
      const op = this.queue.shift()!;
      op.attempts++;

      try {
        await op.execute();
        succeeded++;
        logger.info('Queued operation replayed', { id: op.id, label: op.label });
      } catch (err) {
        logger.warn('Queued operation replay failed', {
          id: op.id, label: op.label, attempt: op.attempts,
          error: err instanceof Error ? err.message : String(err),
        });
        if (op.attempts < op.maxAttempts) {
          failed.push(op);
        }
      }

      onProgress?.(this.queue.length + failed.length);
    }

    // Re-enqueue failed ops for next attempt
    this.queue.push(...failed);
    this.processing = false;
    return succeeded;
  }

  clear(): void {
    this.queue = [];
  }
}

// ── Dave Signal Messages ──────────────────────────────────────

const SIGNAL_LOSS_MESSAGES = [
  "We lost signal. I'll keep your place.",
  "Connection dropped. Your session is safe.",
  "No signal right now. Hang tight.",
];

const SIGNAL_RESTORED_MESSAGES = [
  "Signal is back. Picking up where we left off.",
  "We're back. Continuing.",
  "Reconnected. Let's keep going.",
];

export function getSignalLossMessage(dropCount: number): string {
  return SIGNAL_LOSS_MESSAGES[Math.min(dropCount - 1, SIGNAL_LOSS_MESSAGES.length - 1)];
}

export function getSignalRestoredMessage(): string {
  return SIGNAL_RESTORED_MESSAGES[Math.floor(Math.random() * SIGNAL_RESTORED_MESSAGES.length)];
}
