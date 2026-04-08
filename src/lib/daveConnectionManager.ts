/**
 * Dave Connection Manager — single source of truth for Dave's WebRTC connection lifecycle.
 * 
 * Architecture:
 * - State machine with explicit typed states
 * - Heartbeat/liveness detection
 * - Exponential backoff reconnect
 * - Idempotent connect/disconnect
 * - Structured logging for all transitions
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveConnection');

// ── Connection States ──────────────────────────────────────────────
export type DaveConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'degraded'
  | 'offline'
  | 'failed';

export interface DaveConnectionMeta {
  state: DaveConnectionState;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  reconnectAttemptCount: number;
  lastError: string | null;
  heartbeatLatencyMs: number | null;
  lastHeartbeatAt: number | null;
  sessionId: string | null;
  reconnectTimerActive: boolean;
}

export type DaveConnectionEvent =
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_SUCCESS'; sessionId?: string }
  | { type: 'CONNECT_FAILURE'; error: string }
  | { type: 'DISCONNECT'; reason: string; wasClean: boolean }
  | { type: 'HEARTBEAT_OK'; latencyMs: number }
  | { type: 'HEARTBEAT_FAIL' }
  | { type: 'RECONNECT_SCHEDULED' }
  | { type: 'RECONNECT_START' }
  | { type: 'RECONNECT_SUCCESS'; sessionId?: string }
  | { type: 'RECONNECT_FAILURE'; error: string }
  | { type: 'RECONNECT_EXHAUSTED' }
  | { type: 'MANUAL_RETRY' }
  | { type: 'RESET' };

// ── State Machine Reducer ──────────────────────────────────────────

export function daveConnectionReducer(
  meta: DaveConnectionMeta,
  event: DaveConnectionEvent,
): DaveConnectionMeta {
  const now = Date.now();

  switch (event.type) {
    case 'CONNECT_START':
      return { ...meta, state: 'connecting', lastError: null };

    case 'CONNECT_SUCCESS':
      return {
        ...meta,
        state: 'connected',
        lastConnectedAt: now,
        lastError: null,
        reconnectAttemptCount: 0,
        sessionId: event.sessionId ?? meta.sessionId,
        reconnectTimerActive: false,
        lastHeartbeatAt: now,
        heartbeatLatencyMs: null,
      };

    case 'CONNECT_FAILURE':
      return {
        ...meta,
        state: 'failed',
        lastError: event.error,
        lastDisconnectedAt: now,
      };

    case 'DISCONNECT': {
      if (event.wasClean) {
        return {
          ...meta,
          state: 'idle',
          lastDisconnectedAt: now,
          sessionId: null,
          reconnectTimerActive: false,
        };
      }
      // Unexpected disconnect → try reconnecting
      return {
        ...meta,
        state: 'reconnecting',
        lastDisconnectedAt: now,
        lastError: event.reason,
        reconnectTimerActive: true,
      };
    }

    case 'HEARTBEAT_OK':
      return {
        ...meta,
        state: meta.state === 'degraded' ? 'connected' : meta.state,
        heartbeatLatencyMs: event.latencyMs,
        lastHeartbeatAt: now,
      };

    case 'HEARTBEAT_FAIL': {
      if (meta.state === 'connected') {
        return { ...meta, state: 'degraded', lastError: 'Heartbeat timeout' };
      }
      if (meta.state === 'degraded') {
        return { ...meta, state: 'reconnecting', reconnectTimerActive: true };
      }
      return meta;
    }

    case 'RECONNECT_SCHEDULED':
      return { ...meta, reconnectTimerActive: true };

    case 'RECONNECT_START':
      return {
        ...meta,
        state: 'reconnecting',
        reconnectAttemptCount: meta.reconnectAttemptCount + 1,
      };

    case 'RECONNECT_SUCCESS':
      return {
        ...meta,
        state: 'connected',
        lastConnectedAt: now,
        lastError: null,
        reconnectAttemptCount: 0,
        sessionId: event.sessionId ?? meta.sessionId,
        reconnectTimerActive: false,
        lastHeartbeatAt: now,
        heartbeatLatencyMs: null,
      };

    case 'RECONNECT_FAILURE':
      return {
        ...meta,
        lastError: event.error,
        lastDisconnectedAt: now,
      };

    case 'RECONNECT_EXHAUSTED':
      return {
        ...meta,
        state: 'failed',
        reconnectTimerActive: false,
        lastError: meta.lastError || 'Max reconnect attempts exceeded',
      };

    case 'MANUAL_RETRY':
      return {
        ...meta,
        state: 'connecting',
        reconnectAttemptCount: 0,
        lastError: null,
        reconnectTimerActive: false,
      };

    case 'RESET':
      return createInitialMeta();

    default:
      return meta;
  }
}

export function createInitialMeta(): DaveConnectionMeta {
  return {
    state: 'idle',
    lastConnectedAt: null,
    lastDisconnectedAt: null,
    reconnectAttemptCount: 0,
    lastError: null,
    heartbeatLatencyMs: null,
    lastHeartbeatAt: null,
    sessionId: null,
    reconnectTimerActive: false,
  };
}

// ── Backoff Strategy ───────────────────────────────────────────────

const BACKOFF_SCHEDULE_MS = [1000, 2000, 5000, 10000, 20000, 30000];
const MAX_RECONNECT_ATTEMPTS = 6;
const HEARTBEAT_INTERVAL_MS = 20_000; // 20s
const HEARTBEAT_TIMEOUT_MS = 5_000;   // 5s timeout for heartbeat response
const STABLE_CONNECTION_MS = 30_000;  // Reset backoff after 30s stable

export function getBackoffDelay(attempt: number): number {
  return BACKOFF_SCHEDULE_MS[Math.min(attempt, BACKOFF_SCHEDULE_MS.length - 1)];
}

export {
  MAX_RECONNECT_ATTEMPTS,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  STABLE_CONNECTION_MS,
};
