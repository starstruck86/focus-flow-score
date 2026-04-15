/**
 * useDaveVoiceController — Unified audio controller for all surfaces.
 *
 * This is the single interface that Dojo, Learn, and Skill Builder call
 * for ALL audio operations. It consolidates:
 *
 * - TTS playback (from useVoiceMode)
 * - STT recording (from useVoiceMode)
 * - Session resilience (from useDaveSessionBridge)
 * - Idempotent operations (from daveIdempotency)
 * - Lifecycle recovery (from daveLifecycleRecovery)
 * - Voice command parsing (from daveVoiceRuntime)
 *
 * OWNERSHIP BOUNDARIES:
 *   Dave (this controller) owns: speech, listening, interruption, commands,
 *     session continuity, signal recovery, buffer persistence, replay safety.
 *   Surfaces own: content, scoring handlers, navigation/progression, product semantics.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { useVoiceMode } from '@/hooks/useVoiceMode';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import { parseVoiceCommand, type VoiceCommand } from '@/lib/daveVoiceRuntime';
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
import { runIdempotent } from '@/lib/daveIdempotency';
import { monitorLifecycle, getResumeMessage } from '@/lib/daveLifecycleRecovery';
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDaveVoiceController');

// ── Config ──────────────────────────────────────────────────

export interface DaveVoiceControllerConfig {
  surface: VoiceSurface;
  /** Unique session identifier */
  sessionKey: string;
  /** Current delivery mode */
  mode: DeliveryMode;
}

// ── Return Type ─────────────────────────────────────────────

export interface UseDaveVoiceController {
  // ── Speech Output ──────────────────────────────────
  /** Speak text via TTS. Dave owns this. */
  speak: (text: string, voiceId?: string) => Promise<void>;
  /** Stop current TTS playback */
  stopSpeaking: () => void;
  /** Whether Dave is currently speaking */
  isSpeaking: boolean;

  // ── Speech Input ───────────────────────────────────
  /** Start microphone recording */
  startListening: () => Promise<void>;
  /** Stop recording and get transcript */
  stopListening: () => Promise<string>;
  /** Cancel recording without transcribing */
  cancelListening: () => void;
  /** Whether actively recording */
  isListening: boolean;
  /** Whether transcribing recorded audio */
  isTranscribing: boolean;

  // ── Voice Commands ─────────────────────────────────
  /** Parse a voice command from transcript */
  parseCommand: (transcript: string) => VoiceCommand;

  // ── Connectivity / Signal ──────────────────────────
  isOffline: boolean;
  connectivity: ConnectivityState;
  signalMessage: string | null;
  pendingOpsCount: number;

  // ── Operation Queue ────────────────────────────────
  /** Queue an operation for replay on reconnect */
  queueForReconnect: (execute: () => Promise<unknown>, label: string) => void;
  /** Queue an idempotent operation */
  queueIdempotent: (opKey: string, execute: () => Promise<unknown>, label: string) => void;
  /** Replay all queued operations */
  replayQueue: () => Promise<number>;

  // ── Session Buffer ─────────────────────────────────
  buffer: VoiceSessionBuffer | null;
  hasResumableSession: boolean;
  updatePosition: (position: number, surfaceState?: Record<string, unknown>) => void;
  recordTranscript: (role: 'dave' | 'user', text: string) => void;
  setPendingTranscript: (t: string | null) => void;
  clearBuffer: () => void;

  // ── Prefetch ───────────────────────────────────────
  prefetchCache: PrefetchCache;

  // ── Lifecycle ──────────────────────────────────────
  wasBackgrounded: boolean;
  resumeMessage: string | null;

  // ── Diagnostics ───────────────────────────────────
  getDiagnostics: (() => import('@/hooks/useVoiceMode').VoiceModeDiagnostics) | null;
}

// ── Hook ────────────────────────────────────────────────────

export function useDaveVoiceController(config: DaveVoiceControllerConfig): UseDaveVoiceController {
  // Legacy voice mode — Dave wraps its TTS/STT
  const voice = useVoiceMode();

  // ── Connectivity ──────────────────────────────────
  const [connectivity, setConnectivity] = useState<ConnectivityState>({
    online: navigator.onLine,
    lastOnlineAt: Date.now(),
    lastOfflineAt: null,
    offlineDurationMs: 0,
    dropCount: 0,
  });
  const [signalMessage, setSignalMessage] = useState<string | null>(null);

  // ── Buffer ────────────────────────────────────────
  const [bufferState, setBufferState] = useState<VoiceSessionBuffer | null>(null);

  // ── Lifecycle ─────────────────────────────────────
  const [wasBackgrounded, setWasBackgrounded] = useState(false);
  const [resumeMessage, setResumeMessage] = useState<string | null>(null);

  // ── Refs ───────────────────────────────────────────
  const opQueue = useRef(new OperationQueue());
  const prefetchCache = useRef(new PrefetchCache());
  const msgTimer = useRef<ReturnType<typeof setTimeout>>();
  const resumeTimer = useRef<ReturnType<typeof setTimeout>>();

  // ── Initialize buffer on mount ────────────────────
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

  // ── Connectivity monitoring ───────────────────────
  useEffect(() => {
    const cleanup = monitorConnectivity((state) => {
      setConnectivity(state);

      if (!state.online) {
        setSignalMessage(getSignalLossMessage(state.dropCount));
      } else if (state.offlineDurationMs > 0) {
        setSignalMessage(getSignalRestoredMessage());
        opQueue.current.processAll().then(count => {
          if (count > 0) logger.info('Replayed queued operations', { count });
        }).catch(() => {});
        msgTimer.current = setTimeout(() => setSignalMessage(null), 6000);
      }
    });

    return () => {
      cleanup();
      if (msgTimer.current) clearTimeout(msgTimer.current);
    };
  }, []);

  // ── Lifecycle monitoring ──────────────────────────
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

  // ── Speech Output (Dave owns TTS) ─────────────────
  const speak = useCallback(async (text: string, voiceId?: string) => {
    await voice.playTTS(text, voiceId);
  }, [voice]);

  const stopSpeaking = useCallback(() => {
    voice.stopPlayback();
  }, [voice]);

  // ── Speech Input (Dave owns STT) ──────────────────
  const startListening = useCallback(async () => {
    await voice.startRecording();
  }, [voice]);

  const stopListening = useCallback(async () => {
    return voice.stopRecording();
  }, [voice]);

  const cancelListening = useCallback(() => {
    voice.cancelRecording();
  }, [voice]);

  // ── Queue Operations ──────────────────────────────
  const queueForReconnect = useCallback((execute: () => Promise<unknown>, label: string) => {
    opQueue.current.enqueue('score', execute, label);
  }, []);

  const queueIdempotent = useCallback((opKey: string, execute: () => Promise<unknown>, label: string) => {
    opQueue.current.enqueue('score', () => runIdempotent(opKey, execute), label);
  }, []);

  const replayQueue = useCallback(() => opQueue.current.processAll(), []);

  // ── Buffer Operations ─────────────────────────────
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
    // Speech output
    speak,
    stopSpeaking,
    isSpeaking: voice.isPlaying,

    // Speech input
    startListening,
    stopListening,
    cancelListening,
    isListening: voice.isRecording,
    isTranscribing: voice.isTranscribing,

    // Commands
    parseCommand: parseVoiceCommand,

    // Connectivity
    isOffline: !connectivity.online,
    connectivity,
    signalMessage,
    pendingOpsCount: opQueue.current.length,

    // Queue
    queueForReconnect,
    queueIdempotent,
    replayQueue,

    // Buffer
    buffer: bufferState,
    hasResumableSession,
    updatePosition,
    recordTranscript,
    setPendingTranscript,
    clearBuffer,

    // Prefetch
    prefetchCache: prefetchCache.current,

    // Lifecycle
    wasBackgrounded,
    resumeMessage,

    // Diagnostics
    getDiagnostics: voice.getDiagnostics,
  };
}
