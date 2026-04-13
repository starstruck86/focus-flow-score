/**
 * useDaveSessionBridge — Bridge between existing surface components
 * (AudioSessionMode, AudioLessonMode) and the Dave Audio OS infrastructure.
 *
 * Adds signal recovery, session buffering, and prefetch to existing surfaces
 * WITHOUT replacing their TTS/STT calls. Instead, wraps them with resilience.
 *
 * This is the minimal-disruption integration path: existing surfaces keep
 * their `useVoiceMode()` calls, this hook adds the driving-resilience layer.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import type { DeliveryMode } from '@/hooks/useAudioPreference';
import {
  monitorConnectivity,
  OperationQueue,
  getSignalLossMessage,
  getSignalRestoredMessage,
  type ConnectivityState,
} from '@/lib/daveSignalRecovery';
import {
  saveVoiceSessionBuffer,
  loadVoiceSessionBuffer,
  clearVoiceSessionBuffer,
  createEmptyBuffer,
  appendToTranscriptLog,
  updateBufferPosition,
  type VoiceSessionBuffer,
} from '@/lib/daveSessionBuffer';
import { PrefetchCache } from '@/lib/daveSessionPrefetch';
import { makeOpKey, runIdempotent } from '@/lib/daveIdempotency';
import { monitorLifecycle, getResumeMessage } from '@/lib/daveLifecycleRecovery';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDaveSessionBridge');

export interface DaveSessionBridgeConfig {
  surface: VoiceSurface;
  /** Unique session identifier (e.g., scenario title hash, lesson id) */
  sessionKey: string;
  /** Current delivery mode */
  mode: DeliveryMode;
}

export interface UseDaveSessionBridge {
  // ── Connectivity ────────────────────────────────────
  isOffline: boolean;
  connectivity: ConnectivityState;
  /** Dave's signal message (loss/restored) */
  signalMessage: string | null;
  /** Queue an operation for replay on reconnect */
  queueForReconnect: (execute: () => Promise<unknown>, label: string) => void;
  /** Number of pending queued operations */
  pendingOpsCount: number;
  /** Replay all queued operations now */
  replayQueue: () => Promise<number>;

  // ── Session Buffer ──────────────────────────────────
  /** Update position in the session */
  updatePosition: (position: number, surfaceState?: Record<string, unknown>) => void;
  /** Record a transcript entry */
  recordTranscript: (role: 'dave' | 'user', text: string) => void;
  /** Store a pending transcript (spoken but not scored) */
  setPendingTranscript: (t: string | null) => void;
  /** Current buffer */
  buffer: VoiceSessionBuffer | null;
  /** Whether there's a resumable session for this surface */
  hasResumableSession: boolean;
  /** Clear the session buffer */
  clearBuffer: () => void;

  // ── Prefetch ────────────────────────────────────────
  prefetchCache: PrefetchCache;

  // ── Idempotent Operations ──────────────────────────
  /** Queue an idempotent operation (deduplicated by opKey) */
  queueIdempotent: (opKey: string, execute: () => Promise<unknown>, label: string) => void;

  // ── Lifecycle ──────────────────────────────────────
  /** Whether the app was recently backgrounded and resumed */
  wasBackgrounded: boolean;
  /** Resume message from Dave if app was backgrounded */
  resumeMessage: string | null;
}

export function useDaveSessionBridge(config: DaveSessionBridgeConfig): UseDaveSessionBridge {
  const [connectivity, setConnectivity] = useState<ConnectivityState>({
    online: navigator.onLine,
    lastOnlineAt: Date.now(),
    lastOfflineAt: null,
    offlineDurationMs: 0,
    dropCount: 0,
  });
  const [signalMessage, setSignalMessage] = useState<string | null>(null);
  const [bufferState, setBufferState] = useState<VoiceSessionBuffer | null>(null);
  const [wasBackgrounded, setWasBackgrounded] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  const opQueue = useRef(new OperationQueue());
  const prefetchCache = useRef(new PrefetchCache());
  const msgTimer = useRef<ReturnType<typeof setTimeout>>();
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Initialize buffer on mount ──────────────────────
  useEffect(() => {
    const saved = loadVoiceSessionBuffer();
    if (saved && saved.surface === config.surface && saved.sessionId === config.sessionKey) {
      setBufferState(saved);
      logger.info('Restored session buffer', { surface: config.surface, position: saved.position });
    } else {
      const fresh = createEmptyBuffer(config.sessionKey, config.surface, config.mode);
      setBufferState(fresh);
      saveVoiceSessionBuffer(fresh);
    }
  }, [config.surface, config.sessionKey, config.mode]);

  // ── Connectivity monitoring ─────────────────────────
  useEffect(() => {
    const cleanup = monitorConnectivity((state) => {
      setConnectivity(state);

      if (!state.online) {
        const msg = getSignalLossMessage(state.dropCount);
        setSignalMessage(msg);
      } else if (state.offlineDurationMs > 0) {
        const msg = getSignalRestoredMessage();
        setSignalMessage(msg);

        // Auto-replay queued ops
        opQueue.current.processAll().then(count => {
          if (count > 0) {
            logger.info('Replayed queued operations on reconnect', { count });
          }
        }).catch(() => { /* noop */ });

        // Clear message after delay
        msgTimer.current = setTimeout(() => setSignalMessage(null), 6000);
      }
    });

    return () => {
      cleanup();
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  // ── Lifecycle monitoring (backgrounding) ────────────
  useEffect(() => {
    const cleanup = monitorLifecycle((lifecycle) => {
      if (lifecycle.isVisible && lifecycle.hiddenDurationMs > 3000) {
        setWasBackgrounded(true);
        const msg = getResumeMessage(lifecycle.hiddenDurationMs);
        if (msg) setResumeMessage(msg);
        resumeTimer.current = setTimeout(() => {
          setWasBackgrounded(false);
          setResumeMessage(null);
        }, 8000);
      }
    });

    return () => {
      cleanup();
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, []);

  // ── Queue Operations ────────────────────────────────
  const queueForReconnect = useCallback((execute: () => Promise<unknown>, label: string) => {
    opQueue.current.enqueue('score', execute, label);
  }, []);

  const replayQueue = useCallback(() => {
    return opQueue.current.processAll();
  }, []);

  // ── Idempotent Queue ────────────────────────────────
  const queueIdempotent = useCallback((opKey: string, execute: () => Promise<unknown>, label: string) => {
    opQueue.current.enqueue('score', () => runIdempotent(opKey, execute), label);
  }, []);

  // ── Buffer Operations ───────────────────────────────
  const updatePosition = useCallback((position: number, surfaceState?: Record<string, unknown>) => {
    setBufferState(prev => {
      if (!prev) return prev;
      const updated = updateBufferPosition(prev, position, surfaceState);
      saveVoiceSessionBuffer(updated);
      return updated;
    });
  }, []);

  const recordTranscript = useCallback((role: 'dave' | 'user', text: string) => {
    setBufferState(prev => {
      if (!prev) return prev;
      const updated = appendToTranscriptLog(prev, role, text);
      saveVoiceSessionBuffer(updated);
      return updated;
    });
  }, []);

  const setPendingTranscript = useCallback((t: string | null) => {
    setBufferState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, pendingTranscript: t };
      saveVoiceSessionBuffer(updated);
      return updated;
    });
  }, []);

  const clearBuffer = useCallback(() => {
    clearVoiceSessionBuffer();
    setBufferState(null);
    opQueue.current.clear();
  }, []);

  const hasResumableSession = (() => {
    const saved = loadVoiceSessionBuffer();
    return !!(saved && saved.surface === config.surface && saved.sessionId === config.sessionKey);
  })();

  return {
    isOffline: !connectivity.online,
    connectivity,
    signalMessage,
    queueForReconnect,
    pendingOpsCount: opQueue.current.length,
    replayQueue,
    updatePosition,
    recordTranscript,
    setPendingTranscript,
    buffer: bufferState,
    hasResumableSession,
    clearBuffer,
    prefetchCache: prefetchCache.current,
    queueIdempotent,
    wasBackgrounded,
    resumeMessage,
  };
}
