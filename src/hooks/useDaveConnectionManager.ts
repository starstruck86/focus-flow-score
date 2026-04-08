/**
 * useDaveConnectionManager — React hook wrapping the Dave connection state machine.
 * 
 * This is the single source of truth for Dave's connection lifecycle.
 * UI components consume state from this hook; they do NOT manage WebRTC directly.
 * 
 * Hardening notes:
 * - reconnectAttemptCount is tracked via ref to avoid stale closures in setTimeout
 * - cleanup() preserves terminal state briefly for UX; use reset() for full wipe
 * - event history is maintained for debug panel
 */

import { useReducer, useCallback, useRef, useEffect } from 'react';
import { createLogger } from '@/lib/logger';
import {
  type DaveConnectionMeta,
  type DaveConnectionEvent,
  type DaveConnectionState,
  daveConnectionReducer,
  createInitialMeta,
  getBackoffDelay,
  MAX_RECONNECT_ATTEMPTS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  STABLE_CONNECTION_MS,
} from '@/lib/daveConnectionManager';

const logger = createLogger('DaveConnectionMgr');

// ── Event History ──────────────────────────────────────────────────
export interface DaveEventRecord {
  type: string;
  ts: number;
  detail?: string;
}

const MAX_EVENT_HISTORY = 20;

export interface UseDaveConnectionManager {
  meta: DaveConnectionMeta;
  dispatch: (event: DaveConnectionEvent) => void;
  startHeartbeat: (checkFn: () => Promise<boolean>) => void;
  stopHeartbeat: () => void;
  scheduleReconnect: (reconnectFn: () => Promise<void>) => void;
  cancelReconnect: () => void;
  /** Soft cleanup — stops timers but preserves terminal state for UX */
  cleanup: () => void;
  /** Hard reset — wipes all state back to idle */
  reset: () => void;
  isReconnectExhausted: boolean;
  /** Last N connection events for debug panel */
  eventHistory: DaveEventRecord[];
}

export function useDaveConnectionManager(): UseDaveConnectionManager {
  const [meta, rawDispatch] = useReducer(daveConnectionReducer, undefined, createInitialMeta);

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);
  const cleanedUpRef = useRef(false);

  // ── Ref-backed state to avoid stale closures ──
  const metaRef = useRef(meta);
  metaRef.current = meta;

  // ── Event history ──
  const eventHistoryRef = useRef<DaveEventRecord[]>([]);
  // Force re-render on event history update via a counter
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const pushEvent = useCallback((type: string, detail?: string) => {
    const record: DaveEventRecord = { type, ts: Date.now(), detail };
    eventHistoryRef.current = [...eventHistoryRef.current.slice(-(MAX_EVENT_HISTORY - 1)), record];
    forceUpdate();
  }, []);

  // Wrap dispatch with logging + event history
  const dispatch = useCallback((event: DaveConnectionEvent) => {
    logger.info(`Event: ${event.type}`, event);
    const detail =
      'error' in event ? (event as any).error :
      'reason' in event ? (event as any).reason :
      'latencyMs' in event ? `${(event as any).latencyMs}ms` :
      undefined;
    pushEvent(event.type, detail);
    rawDispatch(event);
  }, [pushEvent]);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const cancelReconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    reconnectingRef.current = false;
  }, []);

  const startHeartbeat = useCallback((checkFn: () => Promise<boolean>) => {
    stopHeartbeat();

    heartbeatTimerRef.current = setInterval(async () => {
      const currentMeta = metaRef.current;
      // Only heartbeat when we think we're connected or degraded
      if (currentMeta.state !== 'connected' && currentMeta.state !== 'degraded') return;

      const start = Date.now();
      try {
        const ok = await Promise.race([
          checkFn(),
          new Promise<boolean>((_, reject) =>
            setTimeout(() => reject(new Error('heartbeat_timeout')), HEARTBEAT_TIMEOUT_MS)
          ),
        ]);
        if (ok) {
          dispatch({ type: 'HEARTBEAT_OK', latencyMs: Date.now() - start });
        } else {
          logger.warn('Heartbeat returned false');
          dispatch({ type: 'HEARTBEAT_FAIL' });
        }
      } catch (err) {
        logger.warn('Heartbeat failed', { error: err instanceof Error ? err.message : String(err) });
        dispatch({ type: 'HEARTBEAT_FAIL' });
      }
    }, HEARTBEAT_INTERVAL_MS);
  }, [dispatch, stopHeartbeat]);

  const scheduleReconnect = useCallback((reconnectFn: () => Promise<void>) => {
    // Prevent duplicate reconnect attempts
    if (reconnectingRef.current || reconnectTimerRef.current) {
      logger.warn('Reconnect already scheduled or in progress — skipping');
      return;
    }

    // Read latest state from ref, not stale closure
    const currentMeta = metaRef.current;
    const currentAttempt = currentMeta.reconnectAttemptCount;

    // Check exhaustion BEFORE scheduling
    if (currentAttempt >= MAX_RECONNECT_ATTEMPTS) {
      logger.warn('Reconnect exhausted — not scheduling');
      dispatch({ type: 'RECONNECT_EXHAUSTED' });
      return;
    }

    const delay = getBackoffDelay(currentAttempt);
    
    logger.info('Scheduling reconnect', { attempt: currentAttempt + 1, delayMs: delay });
    dispatch({ type: 'RECONNECT_SCHEDULED' });

    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;

      if (cleanedUpRef.current) return;

      // Re-check exhaustion at execution time using ref
      const latestMeta = metaRef.current;
      if (latestMeta.reconnectAttemptCount >= MAX_RECONNECT_ATTEMPTS) {
        dispatch({ type: 'RECONNECT_EXHAUSTED' });
        reconnectingRef.current = false;
        return;
      }

      reconnectingRef.current = true;
      dispatch({ type: 'RECONNECT_START' });

      try {
        await reconnectFn();
        // Success will be handled by CONNECT_SUCCESS or RECONNECT_SUCCESS dispatched externally
        reconnectingRef.current = false;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'RECONNECT_FAILURE', error: msg });
        reconnectingRef.current = false;

        // Check exhaustion after failure using ref
        const afterFailMeta = metaRef.current;
        if (afterFailMeta.reconnectAttemptCount >= MAX_RECONNECT_ATTEMPTS) {
          dispatch({ type: 'RECONNECT_EXHAUSTED' });
        }
      }
    }, delay);
  }, [dispatch]);

  // Soft cleanup: stop timers but preserve terminal state for banner/debug
  const cleanup = useCallback(() => {
    cleanedUpRef.current = true;
    stopHeartbeat();
    cancelReconnect();
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current);
      stableTimerRef.current = null;
    }
    // Do NOT dispatch RESET — let the last state linger for UX.
    // Components should call reset() explicitly when they want to wipe.
  }, [stopHeartbeat, cancelReconnect]);

  // Hard reset: full state wipe
  const reset = useCallback(() => {
    cleanup();
    dispatch({ type: 'RESET' });
    eventHistoryRef.current = [];
  }, [cleanup, dispatch]);

  // Cleanup on unmount
  useEffect(() => {
    cleanedUpRef.current = false;
    return () => {
      cleanedUpRef.current = true;
      stopHeartbeat();
      cancelReconnect();
      if (stableTimerRef.current) clearTimeout(stableTimerRef.current);
    };
  }, [stopHeartbeat, cancelReconnect]);

  return {
    meta,
    dispatch,
    startHeartbeat,
    stopHeartbeat,
    scheduleReconnect,
    cancelReconnect,
    cleanup,
    reset,
    isReconnectExhausted: meta.reconnectAttemptCount >= MAX_RECONNECT_ATTEMPTS,
    eventHistory: eventHistoryRef.current,
  };
}
