/**
 * useDaveConnectionManager — React hook wrapping the Dave connection state machine.
 * 
 * This is the single source of truth for Dave's connection lifecycle.
 * UI components consume state from this hook; they do NOT manage WebRTC directly.
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

export interface UseDaveConnectionManager {
  /** Current connection metadata (state, timestamps, errors, etc.) */
  meta: DaveConnectionMeta;
  /** Dispatch a connection event to transition state */
  dispatch: (event: DaveConnectionEvent) => void;
  /** Start heartbeat monitoring (call when connected) */
  startHeartbeat: (checkFn: () => Promise<boolean>) => void;
  /** Stop heartbeat monitoring */
  stopHeartbeat: () => void;
  /** Schedule a reconnect with exponential backoff */
  scheduleReconnect: (reconnectFn: () => Promise<void>) => void;
  /** Cancel any pending reconnect timer */
  cancelReconnect: () => void;
  /** Full cleanup — stop heartbeat, cancel reconnect, reset state */
  cleanup: () => void;
  /** Whether we've exceeded max reconnect attempts */
  isReconnectExhausted: boolean;
}

export function useDaveConnectionManager(): UseDaveConnectionManager {
  const [meta, rawDispatch] = useReducer(daveConnectionReducer, undefined, createInitialMeta);

  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stableTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectingRef = useRef(false);
  const cleanedUpRef = useRef(false);

  // Wrap dispatch with logging
  const dispatch = useCallback((event: DaveConnectionEvent) => {
    logger.info(`Event: ${event.type}`, event);
    rawDispatch(event);
  }, []);

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

    // Check if exhausted based on current meta
    // We read from a ref-like pattern since meta is stale in closure
    // The reducer itself will handle RECONNECT_EXHAUSTED
    const delay = getBackoffDelay(meta.reconnectAttemptCount);
    
    logger.info('Scheduling reconnect', { attempt: meta.reconnectAttemptCount + 1, delayMs: delay });
    dispatch({ type: 'RECONNECT_SCHEDULED' });

    reconnectTimerRef.current = setTimeout(async () => {
      reconnectTimerRef.current = null;

      if (cleanedUpRef.current) return;

      reconnectingRef.current = true;
      dispatch({ type: 'RECONNECT_START' });

      try {
        await reconnectFn();
        // Success will be handled by CONNECT_SUCCESS or RECONNECT_SUCCESS dispatched externally
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'RECONNECT_FAILURE', error: msg });
        reconnectingRef.current = false;

        // Check if we should try again
        if (meta.reconnectAttemptCount + 1 >= MAX_RECONNECT_ATTEMPTS) {
          dispatch({ type: 'RECONNECT_EXHAUSTED' });
        }
      }
    }, delay);
  }, [meta.reconnectAttemptCount, dispatch]);

  const cleanup = useCallback(() => {
    cleanedUpRef.current = true;
    stopHeartbeat();
    cancelReconnect();
    if (stableTimerRef.current) {
      clearTimeout(stableTimerRef.current);
      stableTimerRef.current = null;
    }
    dispatch({ type: 'RESET' });
  }, [stopHeartbeat, cancelReconnect, dispatch]);

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
    isReconnectExhausted: meta.reconnectAttemptCount >= MAX_RECONNECT_ATTEMPTS,
  };
}
