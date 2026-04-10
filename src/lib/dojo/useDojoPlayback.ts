/**
 * useDojoPlayback — React hook for Dave's audio delivery inside Sales Dojo.
 *
 * Wires together:
 * - dojoAudioController (pure state machine)
 * - elevenlabsTransport (ElevenLabs TTS I/O)
 * - dojoSessionSnapshot (crash-safe localStorage persistence)
 * - Watchdog polling for hung playback
 *
 * CRASH RESILIENCE:
 * - Snapshots are saved to localStorage after every state transition
 * - On mount, tryRecover() checks for an existing snapshot and resumes
 * - Recovery advances past completed chunks and never replays them
 * - Ambiguous states (requested-but-not-completed) are retried safely
 *
 * Scoped to Sales Dojo only. Not a generic voice agent hook.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import type { SpeechChunk } from './conversationEngine';
import type { PlaybackState } from './playbackAdapter';
import type {
  AudioControllerState,
  ControllerDirective,
  ControllerResult,
  DeliveryMode,
} from './dojoAudioController';
import {
  createAudioController,
  checkForTimeout,
  onTtsCompleted,
  onTtsFailed,
  onTtsStarted,
  onTtsRequested,
  onUserInterrupted,
  onUserRequestedReplay,
  onUserRequestedSkip,
  resumeAfterInterruption,
  switchToTextFallback,
  switchToVoice,
  snapshotController,
  recoverSession,
} from './dojoAudioController';
import type { TransportConfig, TransportHandle } from './elevenlabsTransport';
import {
  createTransportHandle,
  speakChunk,
  stopPlayback,
  destroyTransport,
} from './elevenlabsTransport';
import { getNextMessage } from './conversationEngine';
import {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  restoreFromSnapshot,
} from './dojoSessionSnapshot';
import {
  createMetrics,
  logChunkRequested,
  logChunkStarted,
  logChunkCompleted,
  logChunkFailed,
  logChunkTimedOut,
  logChunkSkipped,
  logRetryAttempt,
  logDegradation,
  logChunkLevelDegrade,
  logSessionLevelDegrade,
  logRecovery,
  logCrashRecovery,
  logAmbiguousResume,
  logReplay,
  logSkip,
  logInterruption,
  logDuplicateSuppressed,
  logStaleSuppressed,
  logSessionSummary,
  type DojoAudioMetrics,
} from './dojoAudioAnalytics';

// ── Hook return type ───────────────────────────────────────────────

export interface DojoPlaybackControls {
  controllerState: AudioControllerState | null;
  lastDirective: ControllerDirective | null;
  deliveryMode: DeliveryMode;
  isPlaying: boolean;
  metrics: DojoAudioMetrics;
  /** Whether this session was recovered from a crash/refresh. */
  wasRecovered: boolean;

  initialize: (dojo: PlaybackState, mode?: DeliveryMode) => void;
  startDelivery: () => void;
  interrupt: () => void;
  replay: () => void;
  skip: () => void;
  resume: () => void;
  degradeToText: (reason: string) => void;
  restoreVoice: (reason: string) => void;
  /** Try to recover from localStorage snapshot. Returns true if recovered. */
  tryRecover: (sessionId: string) => boolean;
  destroy: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useDojoPlayback(config: TransportConfig): DojoPlaybackControls {
  const [ctrlState, setCtrlState] = useState<AudioControllerState | null>(null);
  const [lastDirective, setLastDirective] = useState<ControllerDirective | null>(null);
  const [wasRecovered, setWasRecovered] = useState(false);

  const ctrlRef = useRef<AudioControllerState | null>(null);
  const handleRef = useRef<TransportHandle>(createTransportHandle());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricsRef = useRef<DojoAudioMetrics>(createMetrics());

  // Keep ref in sync with state + track metrics
  const applyResult = useCallback((result: ControllerResult) => {
    ctrlRef.current = result.state;
    setCtrlState(result.state);
    setLastDirective(result.directive);

    // Track metrics based on directive
    const m = metricsRef.current;
    switch (result.directive.kind) {
      case 'speak':
        metricsRef.current = logChunkRequested(m, result.directive.chunk.id);
        break;
      case 'retry_speak':
        metricsRef.current = logRetryAttempt(m, result.directive.chunk.id, result.directive.attempt);
        break;
      case 'show_text':
        metricsRef.current = logChunkCompleted(m, result.directive.chunk.id, 0);
        break;
      case 'mode_changed':
        if (result.directive.mode === 'text_fallback') {
          metricsRef.current = logDegradation(m, result.directive.reason);
          if (result.directive.level === 'session') {
            metricsRef.current = logSessionLevelDegrade(metricsRef.current, result.directive.reason);
          }
        }
        break;
      case 'chunk_skipped_max_retries':
        metricsRef.current = logChunkSkipped(m, result.directive.chunkId);
        metricsRef.current = logChunkLevelDegrade(metricsRef.current, result.directive.chunkId);
        break;
      case 'no_op':
        if (result.directive.reason === 'duplicate_completed') {
          metricsRef.current = logDuplicateSuppressed(m, '');
        } else if (result.directive.reason === 'stale_chunk_completed') {
          metricsRef.current = logStaleSuppressed(m, '');
        }
        break;
    }

    // Persist snapshot for crash recovery (localStorage)
    if (result.state.dojo.sessionId) {
      saveSnapshot(result.state, {
        replayedChunkIds: Array.from(result.state.replayedChunkIds),
        skippedChunkIds: Array.from(result.state.skippedChunkIds),
      });
    }
  }, []);

  // Transport callback
  const handleTransportEvent = useCallback((result: ControllerResult) => {
    applyResult(result);

    if (result.directive.kind === 'speak' || result.directive.kind === 'retry_speak') {
      const chunk = result.directive.chunk;
      const opts = result.directive.kind === 'speak'
        ? { previousText: result.directive.previousText, nextText: result.directive.nextText }
        : undefined;

      speakChunk(chunk, result.state, config, handleRef.current, handleTransportEvent, opts)
        .then((h) => { handleRef.current = h; });
    }
  }, [config, applyResult]);

  // ── Public controls ──────────────────────────────────────────────

  const initialize = useCallback((dojo: PlaybackState, mode: DeliveryMode = 'voice') => {
    const ctrl = createAudioController(dojo, mode);
    ctrlRef.current = ctrl;
    setCtrlState(ctrl);
    setLastDirective(null);
    setWasRecovered(false);
  }, []);

  const startDelivery = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl || ctrl.dojo.phase !== 'delivering') return;

    const { chunk, nextState } = getNextMessage(ctrl.dojo);
    if (!chunk) return;

    const liftedState = { ...nextState, playback: ctrl.dojo.playback };
    const updated: AudioControllerState = { ...ctrl, dojo: liftedState as PlaybackState };

    if (ctrl.deliveryMode === 'text_fallback') {
      const completed = new Set(ctrl.completedChunkIds);
      completed.add(chunk.id);
      applyResult({ state: { ...updated, completedChunkIds: completed }, directive: { kind: 'show_text', chunk } });
      return;
    }

    const context = {
      previousText: chunk.index > 0 ? ctrl.dojo.chunks[chunk.index - 1]?.text : undefined,
      nextText: chunk.index < ctrl.dojo.chunks.length - 1 ? ctrl.dojo.chunks[chunk.index + 1]?.text : undefined,
    };

    applyResult({
      state: updated,
      directive: { kind: 'speak', chunk, ...context },
    });

    speakChunk(chunk, updated, config, handleRef.current, handleTransportEvent, context)
      .then((h) => { handleRef.current = h; });
  }, [config, applyResult, handleTransportEvent]);

  const interrupt = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    handleRef.current = stopPlayback(handleRef.current);
    metricsRef.current = logInterruption(metricsRef.current);
    applyResult(onUserInterrupted(ctrl));
  }, [applyResult]);

  const replay = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const result = onUserRequestedReplay(ctrl);
    if (result.directive.kind === 'speak') {
      metricsRef.current = logReplay(metricsRef.current, result.directive.chunk.id);
    }
    applyResult(result);

    if (result.directive.kind === 'speak') {
      speakChunk(
        result.directive.chunk,
        result.state,
        config,
        handleRef.current,
        handleTransportEvent,
        { previousText: result.directive.previousText, nextText: result.directive.nextText }
      ).then((h) => { handleRef.current = h; });
    }
  }, [config, applyResult, handleTransportEvent]);

  const skip = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    handleRef.current = stopPlayback(handleRef.current);
    const chunkId = ctrl.dojo.playback.currentPlayingChunkId ?? ctrl.dojo.chunks[ctrl.dojo.currentChunkIndex]?.id;
    if (chunkId) metricsRef.current = logSkip(metricsRef.current, chunkId);
    const result = onUserRequestedSkip(ctrl);
    handleTransportEvent(result);
  }, [handleTransportEvent]);

  const resumeDelivery = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    const result = resumeAfterInterruption(ctrl);
    handleTransportEvent(result);
  }, [handleTransportEvent]);

  const degradeToText = useCallback((reason: string) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    handleRef.current = stopPlayback(handleRef.current);
    applyResult(switchToTextFallback(ctrl, reason));
  }, [applyResult]);

  const restoreVoice = useCallback((reason: string) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    applyResult(switchToVoice(ctrl, reason));
  }, [applyResult]);

  const tryRecover = useCallback((sessionId: string): boolean => {
    const loaded = loadSnapshot(sessionId);
    if (!loaded.ok) {
      if (loaded.reason === 'version_mismatch') {
        metricsRef.current = logAmbiguousResume(metricsRef.current);
      }
      return false;
    }

    const snap = loaded.snapshot;
    const ctrl = restoreFromSnapshot(snap);
    metricsRef.current = logCrashRecovery(metricsRef.current, `crash_recovery:${sessionId}`);
    setWasRecovered(true);

    // Use the controller's own recovery path to get the right directive
    const controllerSnap = snapshotController(ctrl);
    const result = recoverSession(controllerSnap);
    handleTransportEvent(result);
    return true;
  }, [handleTransportEvent]);

  const destroy = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    logSessionSummary(metricsRef.current);
    metricsRef.current = createMetrics();
    destroyTransport(handleRef.current);
    handleRef.current = createTransportHandle();
    ctrlRef.current = null;
    setCtrlState(null);
    setLastDirective(null);
  }, []);

  // ── Watchdog: poll for hung playback every 5s ────────────────────

  useEffect(() => {
    watchdogRef.current = setInterval(() => {
      const ctrl = ctrlRef.current;
      if (!ctrl) return;

      const result = checkForTimeout(ctrl);
      if (result.directive.kind !== 'no_op') {
        metricsRef.current = logChunkTimedOut(metricsRef.current, ctrl.dojo.playback.currentPlayingChunkId ?? '');
        handleTransportEvent(result);
      }
    }, 5_000);

    return () => {
      if (watchdogRef.current) clearInterval(watchdogRef.current);
    };
  }, [handleTransportEvent]);

  // ── Cleanup on unmount ───────────────────────────────────────────

  useEffect(() => {
    return () => {
      destroyTransport(handleRef.current);
      if (watchdogRef.current) clearInterval(watchdogRef.current);
    };
  }, []);

  return {
    controllerState: ctrlState,
    lastDirective,
    deliveryMode: ctrlState?.deliveryMode ?? 'voice',
    isPlaying: ctrlState?.dojo.playback.currentPlayingChunkId !== null,
    metrics: metricsRef.current,
    wasRecovered,

    initialize,
    startDelivery,
    interrupt,
    replay,
    skip,
    resume: resumeDelivery,
    degradeToText,
    restoreVoice,
    tryRecover,
    destroy,
  };
}
