/**
 * useDaveAudioSession — Integration hook that wires the Dave Audio OS
 * into real Dojo, Learn, and Skill Builder surfaces.
 *
 * Provides:
 * - Voice runtime lifecycle
 * - Signal recovery with connectivity monitoring
 * - Session buffering for driving resilience
 * - Prefetch management
 * - Mode switching with session continuity
 *
 * Surfaces call this hook instead of managing audio directly.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useDaveVoiceRuntime, type UseDaveVoiceRuntime } from '@/hooks/useDaveVoiceRuntime';
import {
  type VoiceSurface,
  type SpeechQueueItem,
  speak,
  speakQueue,
  listen,
  runTurn,
  interruptSpeech,
  parseVoiceCommand,
  type TurnConfig,
  type TurnResult,
  type VoiceCommand,
  type ActivePlayback,
} from '@/lib/daveVoiceRuntime';
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
import { createLogger } from '@/lib/logger';

const logger = createLogger('useDaveAudioSession');

export interface DaveAudioSessionConfig {
  surface: VoiceSurface;
  /** Whether to enable connectivity monitoring */
  enableRecovery?: boolean;
  /** Whether to auto-resume from buffer on mount */
  autoResume?: boolean;
}

export interface UseDaveAudioSession {
  /** The underlying voice runtime */
  runtime: UseDaveVoiceRuntime;

  // ── Convenience Wrappers ────────────────────────────
  /** Speak text via Dave (with signal recovery) */
  speak: (text: string) => Promise<void>;
  /** Speak a queue of segments */
  speakQueue: (items: SpeechQueueItem[]) => Promise<void>;
  /** Listen for user speech */
  listen: (timeoutMs?: number) => Promise<string>;
  /** Run a full turn (speak → listen → process → speak feedback) */
  runTurn: (config: Omit<TurnConfig, 'previousText'>) => Promise<TurnResult>;
  /** Interrupt current speech */
  interrupt: () => void;
  /** Parse voice command from transcript */
  parseCommand: (transcript: string) => VoiceCommand;

  // ── Session Lifecycle ───────────────────────────────
  /** Start a new audio session for this surface */
  startSession: () => void;
  /** End the current session cleanly */
  endSession: () => void;
  /** Whether an audio session is active */
  isActive: boolean;

  // ── Connectivity ────────────────────────────────────
  /** Current connectivity state */
  connectivity: ConnectivityState;
  /** Whether we're currently offline */
  isOffline: boolean;
  /** Queue a scoring operation for replay on reconnect */
  queueOperation: (execute: () => Promise<unknown>, label: string) => void;
  /** Number of queued operations */
  pendingOpsCount: number;

  // ── Session Buffer ──────────────────────────────────
  /** Update buffer position and surface state */
  updatePosition: (position: number, surfaceState?: Record<string, unknown>) => void;
  /** Record transcript entry in buffer */
  recordTranscript: (role: 'dave' | 'user', text: string) => void;
  /** Set pending transcript (user spoke but not yet scored) */
  setPendingTranscript: (transcript: string | null) => void;
  /** Get the current buffer state */
  buffer: VoiceSessionBuffer | null;

  // ── Prefetch ────────────────────────────────────────
  /** The prefetch cache for this session */
  prefetchCache: PrefetchCache;

  // ── Dave Messages ───────────────────────────────────
  /** Current Dave message (signal loss, recovery, etc.) */
  daveMessage: string | null;
}

export function useDaveAudioSession(config: DaveAudioSessionConfig): UseDaveAudioSession {
  const runtime = useDaveVoiceRuntime();
  const [connectivity, setConnectivity] = useState<ConnectivityState>({
    online: navigator.onLine,
    lastOnlineAt: Date.now(),
    lastOfflineAt: null,
    offlineDurationMs: 0,
    dropCount: 0,
  });
  const [daveMessage, setDaveMessage] = useState<string | null>(null);
  const [isActive, setIsActive] = useState(false);
  const [bufferState, setBufferState] = useState<VoiceSessionBuffer | null>(null);

  const opQueue = useRef(new OperationQueue());
  const prefetchCache = useMemo(() => new PrefetchCache(), []);
  const lastSpokenText = useRef<string>('');
  const messageTimerRef = useRef<ReturnType<typeof setTimeout>>();

  // ── Connectivity Monitoring ─────────────────────────
  useEffect(() => {
    if (!config.enableRecovery) return;

    const cleanup = monitorConnectivity((state) => {
      setConnectivity(state);

      if (!state.online) {
        const msg = getSignalLossMessage(state.dropCount);
        setDaveMessage(msg);
        // Speak the message if we're in audio mode and active
        if (isActive && runtime.isAudio) {
          speak(msg).catch(() => { /* offline, can't speak */ });
        }
      } else if (state.offlineDurationMs > 0) {
        // Signal restored — replay queued ops
        const restoredMsg = getSignalRestoredMessage();
        setDaveMessage(restoredMsg);

        if (isActive && runtime.isAudio) {
          speakWrapped(restoredMsg).then(() => {
            return opQueue.current.processAll();
          }).catch(() => { /* noop */ });
        } else {
          opQueue.current.processAll().catch(() => { /* noop */ });
        }

        // Clear message after a few seconds
        messageTimerRef.current = setTimeout(() => setDaveMessage(null), 5000);
      }
    });

    return () => {
      cleanup();
      if (messageTimerRef.current) clearTimeout(messageTimerRef.current);
    };
  }, [config.enableRecovery, isActive, runtime.isAudio]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-resume from buffer ─────────────────────────
  useEffect(() => {
    if (!config.autoResume) return;
    const saved = loadVoiceSessionBuffer();
    if (saved && saved.surface === config.surface) {
      setBufferState(saved);
      logger.info('Restored voice session buffer', {
        surface: saved.surface,
        position: saved.position,
      });
    }
  }, [config.autoResume, config.surface]);

  // ── Convenience wrappers with recovery ──────────────

  const speakWrapped = useCallback(async (text: string) => {
    runtime.updateState({ isSpeaking: true });
    try {
      runtime.playbackRef.current = await speakFn(
        text,
        runtime.ttsConfig,
        runtime.playbackRef.current,
        { previousText: lastSpokenText.current },
      );
      lastSpokenText.current = text;
    } catch {
      runtime.updateState({ ttsAvailable: false });
      logger.warn('TTS failed, text fallback', { text: text.slice(0, 60) });
    }
    runtime.updateState({ isSpeaking: false });
  }, [runtime]);

  const speakQueueWrapped = useCallback(async (items: SpeechQueueItem[]) => {
    runtime.updateState({ isSpeaking: true });
    await speakQueueFn(items, runtime.ttsConfig, runtime.playbackRef, {
      signal: runtime.abortRef.current.signal,
      onSegmentStart: () => runtime.updateState({ isSpeaking: true }),
      onSegmentEnd: (i) => {
        lastSpokenText.current = items[i]?.text ?? '';
      },
    });
    runtime.updateState({ isSpeaking: false });
  }, [runtime]);

  const listenWrapped = useCallback(async (timeoutMs = 30_000) => {
    runtime.updateState({ isListening: true });
    try {
      const transcript = await listenFn(runtime.ttsConfig, {
        timeoutMs,
        signal: runtime.abortRef.current.signal,
      });
      runtime.updateState({ isListening: false, lastTranscript: transcript });
      return transcript;
    } catch {
      runtime.updateState({ isListening: false, sttAvailable: false });
      return '';
    }
  }, [runtime]);

  const runTurnWrapped = useCallback(async (
    turnConfig: Omit<TurnConfig, 'previousText'>,
  ): Promise<TurnResult> => {
    const result = await runTurnFn(
      { ...turnConfig, previousText: lastSpokenText.current },
      runtime.ttsConfig,
      runtime.playbackRef,
      (patch) => runtime.updateState(patch),
    );
    if (result.transcript) lastSpokenText.current = result.feedback || result.transcript;
    return result;
  }, [runtime]);

  const interruptWrapped = useCallback(() => {
    runtime.interrupt();
  }, [runtime]);

  // ── Session Lifecycle ───────────────────────────────

  const startSession = useCallback(() => {
    const session = runtime.startSession(config.surface);
    const buffer = createEmptyBuffer(session.id, config.surface, runtime.mode);
    setBufferState(buffer);
    saveVoiceSessionBuffer(buffer);
    setIsActive(true);
    logger.info('Audio session started', { surface: config.surface });
  }, [runtime, config.surface]);

  const endSession = useCallback(() => {
    runtime.endSession();
    clearVoiceSessionBuffer();
    setBufferState(null);
    setIsActive(false);
    opQueue.current.clear();
    prefetchCache.clear();
    setDaveMessage(null);
    logger.info('Audio session ended', { surface: config.surface });
  }, [runtime, config.surface, prefetchCache]);

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

  const setPendingTranscript = useCallback((transcript: string | null) => {
    setBufferState(prev => {
      if (!prev) return prev;
      const updated = { ...prev, pendingTranscript: transcript };
      saveVoiceSessionBuffer(updated);
      return updated;
    });
  }, []);

  // ── Queue Operations ────────────────────────────────

  const queueOperation = useCallback((execute: () => Promise<unknown>, label: string) => {
    opQueue.current.enqueue('score', execute, label);
  }, []);

  return {
    runtime,
    speak: speakWrapped,
    speakQueue: speakQueueWrapped,
    listen: listenWrapped,
    runTurn: runTurnWrapped,
    interrupt: interruptWrapped,
    parseCommand: parseVoiceCommand,
    startSession,
    endSession,
    isActive,
    connectivity,
    isOffline: !connectivity.online,
    queueOperation,
    pendingOpsCount: opQueue.current.length,
    updatePosition,
    recordTranscript,
    setPendingTranscript,
    buffer: bufferState,
    prefetchCache,
    daveMessage,
  };
}

// Re-export the raw functions to avoid import conflicts
const speakFn = speak;
const speakQueueFn = speakQueue;
const listenFn = listen;
const runTurnFn = runTurn;
