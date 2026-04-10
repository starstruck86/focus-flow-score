/**
 * useDojoPlayback — React hook for Dave's audio delivery inside Sales Dojo.
 *
 * Wires together:
 * - dojoAudioController (pure state machine)
 * - elevenlabsTransport (ElevenLabs TTS I/O)
 * - Watchdog polling for hung playback
 * - Session recovery from sessionStorage
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
  ControllerSnapshot,
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
  restoreController,
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
  createMetrics,
  logChunkRequested,
  logChunkStarted,
  logChunkCompleted,
  logChunkFailed,
  logChunkTimedOut,
  logChunkSkipped,
  logRetryAttempt,
  logDegradation,
  logRecovery,
  logReplay,
  logSkip,
  logInterruption,
  logSessionSummary,
  type DojoAudioMetrics,
} from './dojoAudioAnalytics';

// ── Storage key ────────────────────────────────────────────────────

const STORAGE_KEY_PREFIX = 'dojo_playback_';

function storageKey(sessionId: string): string {
  return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

// ── Hook return type ───────────────────────────────────────────────

export interface DojoPlaybackControls {
  /** Current controller state. */
  controllerState: AudioControllerState | null;
  /** Last directive emitted — UI should react to this. */
  lastDirective: ControllerDirective | null;
  /** Current delivery mode. */
  deliveryMode: DeliveryMode;
  /** Whether audio is actively playing. */
  isPlaying: boolean;
  /** Current audio metrics snapshot. */
  metrics: DojoAudioMetrics;

  /** Initialize controller for a Dojo session. */
  initialize: (dojo: PlaybackState, mode?: DeliveryMode) => void;
  /** Start delivering chunks (voice or text based on mode). */
  startDelivery: () => void;
  /** User interrupted Dave. */
  interrupt: () => void;
  /** User requested replay. */
  replay: () => void;
  /** User requested skip. */
  skip: () => void;
  /** Resume after interruption / follow-up. */
  resume: () => void;
  /** Force text fallback. */
  degradeToText: (reason: string) => void;
  /** Restore voice mode. */
  restoreVoice: (reason: string) => void;
  /** Try to recover from sessionStorage. Returns true if recovered. */
  tryRecover: (sessionId: string) => boolean;
  /** Full teardown. */
  destroy: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useDojoPlayback(config: TransportConfig): DojoPlaybackControls {
  const [ctrlState, setCtrlState] = useState<AudioControllerState | null>(null);
  const [lastDirective, setLastDirective] = useState<ControllerDirective | null>(null);

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
        }
        break;
      case 'chunk_skipped_max_retries':
        metricsRef.current = logChunkSkipped(m, result.directive.chunkId);
        break;
    }

    // Persist snapshot for recovery
    if (result.state.dojo.sessionId) {
      try {
        const snap = snapshotController(result.state);
        sessionStorage.setItem(
          storageKey(result.state.dojo.sessionId),
          JSON.stringify(snap)
        );
      } catch { /* sessionStorage full or unavailable */ }
    }
  }, []);

  // Transport callback — called by elevenlabsTransport on audio events
  const handleTransportEvent = useCallback((result: ControllerResult) => {
    applyResult(result);

    // If directive says speak/retry_speak, trigger transport
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
  }, []);

  const startDelivery = useCallback(() => {
    const ctrl = ctrlRef.current;
    if (!ctrl || ctrl.dojo.phase !== 'delivering') return;

    // Get first chunk via advanceToNext (triggered by onTtsCompleted-like flow)
    // We simulate by calling the controller's internal advance
    const { chunk, nextState } = getNextMessage(ctrl.dojo);
    if (!chunk) return;

    const liftedState = { ...nextState, playback: ctrl.dojo.playback };
    const updated: AudioControllerState = { ...ctrl, dojo: liftedState as PlaybackState };

    if (ctrl.deliveryMode === 'text_fallback') {
      applyResult({ state: updated, directive: { kind: 'show_text', chunk } });
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
    const chunkId = ctrl.dojo.playback.currentPlayingChunkId;
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
    try {
      const raw = sessionStorage.getItem(storageKey(sessionId));
      if (!raw) return false;

      const snap: ControllerSnapshot = JSON.parse(raw);
      const result = recoverSession(snap);
      metricsRef.current = logRecovery(metricsRef.current, `refresh_recovery:${sessionId}`);
      handleTransportEvent(result);
      return true;
    } catch {
      return false;
    }
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
