/**
 * Session Recovery — Persistent recovery mode for interrupted sessions.
 *
 * Provides:
 * - Recovery state machine for TTS/STT/scoring/persist failures
 * - Automatic retry with bounded exponential backoff
 * - Dave messaging during recovery (calm coaching tone)
 * - Auto-resume when connectivity returns
 *
 * Does NOT:
 * - Fake success
 * - Generate substitute outputs
 * - Skip required system outputs
 */

import { createLogger } from './logger';

const logger = createLogger('SessionRecovery');

// ── Recovery States ────────────────────────────────────────────

export type RecoveryReason =
  | 'tts_failure'
  | 'stt_failure'
  | 'scoring_failure'
  | 'persist_failure'
  | 'connection_lost';

export type RecoveryStatus =
  | 'idle'
  | 'recovering'
  | 'waiting_for_connection'
  | 'resumed';

export interface RecoveryState {
  status: RecoveryStatus;
  reason: RecoveryReason | null;
  attempt: number;
  maxAttempts: number;
  lastAttemptAt: number;
  /** The phase the session was in when recovery started */
  interruptedPhase: string | null;
  /** User-facing message from Dave */
  daveMessage: string | null;
}

export function createInitialRecoveryState(): RecoveryState {
  return {
    status: 'idle',
    reason: null,
    attempt: 0,
    maxAttempts: 50, // keep trying for a long time
    lastAttemptAt: 0,
    interruptedPhase: null,
    daveMessage: null,
  };
}

// ── Backoff Strategy ───────────────────────────────────────────
// 1s, 2s, 5s, 10s, then steady 15s cadence

const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000];
const STEADY_INTERVAL_MS = 15000;

export function getRecoveryDelay(attempt: number): number {
  if (attempt < BACKOFF_SCHEDULE_MS.length) {
    return BACKOFF_SCHEDULE_MS[attempt];
  }
  return STEADY_INTERVAL_MS;
}

// ── Dave Recovery Messages ─────────────────────────────────────
// Calm, coaching-tone messages — NOT technical errors

const DAVE_MESSAGES: Record<RecoveryReason, string[]> = {
  tts_failure: [
    "Hold on — I'll continue as soon as signal comes back.",
    "Connection dropped. Your session is still here.",
    "Still reconnecting. We'll pick up right where we left off.",
  ],
  stt_failure: [
    "Hold on — I've got your response saved. Waiting for connection.",
    "Connection issue. Your words aren't lost. Hang tight.",
    "Still reconnecting. No need to re-record.",
  ],
  scoring_failure: [
    "Your response is saved. Waiting for connection to score it.",
    "I have your answer. Just need signal to evaluate it.",
    "Still working on getting your score. Hang tight.",
  ],
  persist_failure: [
    "You're good. I saved this locally. I'll sync when signal returns.",
    "Connection issue — your progress is safe.",
    "Still reconnecting. Your work is preserved.",
  ],
  connection_lost: [
    "Waiting for signal… Your session is still here.",
    "No connection right now. We'll continue when it comes back.",
    "Still reconnecting. No need to restart.",
  ],
};

export function getDaveRecoveryMessage(reason: RecoveryReason, attempt: number): string {
  const messages = DAVE_MESSAGES[reason];
  // Cycle through messages based on attempt
  return messages[Math.min(attempt, messages.length - 1)];
}

// ── User-Facing Status Labels ──────────────────────────────────

export function getRecoveryStatusLabel(state: RecoveryState): string | null {
  if (state.status === 'idle' || state.status === 'resumed') return null;
  
  switch (state.reason) {
    case 'tts_failure':
      return 'Reconnecting audio…';
    case 'stt_failure':
      return 'Response saved — reconnecting…';
    case 'scoring_failure':
      return 'Response saved — waiting for signal…';
    case 'persist_failure':
      return 'Saved locally — will sync when reconnected';
    case 'connection_lost':
      return 'Waiting for signal…';
    default:
      return 'Reconnecting…';
  }
}

// ── Recovery Controller ────────────────────────────────────────
// Manages retry loop for a single recoverable operation

export interface RecoveryController {
  cancel: () => void;
  promise: Promise<void>;
}

/**
 * Execute a recoverable operation with automatic retry.
 * 
 * - Retries with backoff until success, cancellation, or max attempts
 * - Calls onStateChange on each transition for UI updates
 * - Does NOT fake success or skip the operation
 */
export function executeWithRecovery<T>(
  operation: () => Promise<T>,
  opts: {
    reason: RecoveryReason;
    interruptedPhase: string;
    onStateChange: (state: RecoveryState) => void;
    onSuccess: (result: T) => void;
    onGiveUp: () => void;
    maxAttempts?: number;
    signal?: AbortSignal;
  },
): RecoveryController {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const maxAttempts = opts.maxAttempts ?? 50;

  const state: RecoveryState = {
    status: 'recovering',
    reason: opts.reason,
    attempt: 0,
    maxAttempts,
    lastAttemptAt: Date.now(),
    interruptedPhase: opts.interruptedPhase,
    daveMessage: getDaveRecoveryMessage(opts.reason, 0),
  };

  opts.onStateChange({ ...state });

  const promise = new Promise<void>((resolve) => {
    const tryOnce = async () => {
      if (cancelled || opts.signal?.aborted) {
        resolve();
        return;
      }

      // Check connectivity first
      if (!navigator.onLine) {
        state.status = 'waiting_for_connection';
        state.daveMessage = getDaveRecoveryMessage('connection_lost', state.attempt);
        opts.onStateChange({ ...state });

        // Wait for online event
        const onlineHandler = () => {
          window.removeEventListener('online', onlineHandler);
          state.status = 'recovering';
          opts.onStateChange({ ...state });
          tryOnce();
        };
        window.addEventListener('online', onlineHandler);
        
        // Also set a polling check in case the event doesn't fire
        timer = setTimeout(() => {
          if (navigator.onLine) {
            window.removeEventListener('online', onlineHandler);
            state.status = 'recovering';
            opts.onStateChange({ ...state });
            tryOnce();
          }
        }, STEADY_INTERVAL_MS);
        return;
      }

      state.attempt++;
      state.lastAttemptAt = Date.now();
      state.daveMessage = getDaveRecoveryMessage(opts.reason, state.attempt - 1);
      opts.onStateChange({ ...state });

      try {
        const result = await operation();
        state.status = 'resumed';
        state.daveMessage = null;
        opts.onStateChange({ ...state });
        opts.onSuccess(result);
        resolve();
      } catch (err) {
        logger.warn(`Recovery attempt ${state.attempt}/${maxAttempts} failed`, {
          reason: opts.reason,
          error: err instanceof Error ? err.message : String(err),
        });

        if (state.attempt >= maxAttempts) {
          opts.onGiveUp();
          resolve();
          return;
        }

        const delay = getRecoveryDelay(state.attempt - 1);
        timer = setTimeout(tryOnce, delay);
      }
    };

    tryOnce();
  });

  return {
    cancel: () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    },
    promise,
  };
}

// ── Online/Offline Helpers ─────────────────────────────────────

/** Returns true if navigator reports online. Falls back to true if API unavailable. */
export function isOnline(): boolean {
  return typeof navigator !== 'undefined' ? navigator.onLine : true;
}

/** Simple connectivity check via a quick fetch to the Supabase health endpoint */
export async function checkConnectivity(supabaseUrl: string): Promise<boolean> {
  try {
    const resp = await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
