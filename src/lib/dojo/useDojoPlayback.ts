/**
 * useDojoPlayback — React hook for Dave's audio delivery inside Sales Dojo.
 *
 * Wires together:
 * - dojoAudioController (pure state machine)
 * - elevenlabsTransport (ElevenLabs TTS I/O)
 * - dojoSessionSnapshot (crash-safe localStorage persistence)
 * - dojoSessionOwnership (multi-tab protection)
 * - dojoVisibilityGuard (tab backgrounding)
 * - Watchdog polling for hung playback
 *
 * Scoped to Sales Dojo only. Not a generic voice agent hook.
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import type { SpeechChunk } from './conversationEngine';
import { getInterChunkDelay } from './dojoChunkPacing';
import { markAudioUnlocked, isAudioUnlocked } from './dojoAutoplayGate';
import type { PlaybackState } from './playbackAdapter';
import type {
  AudioControllerState,
  ControllerDirective,
  ControllerResult,
  DeliveryMode,
  RestoreReason,
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
  onTabHidden,
  onTabVisible,
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
  claimSession,
  startOwnershipHeartbeat,
  releaseOwnership,
} from './dojoSessionOwnership';
import {
  startVisibilityGuard,
} from './dojoVisibilityGuard';
import {
  createMetrics,
  logChunkRequested,
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
  logOwnershipConflict,
  logTabHidden,
  logTabResume,
  logRestoreReason,
  logChunkFailedAudibility,
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
  wasRecovered: boolean;
  isOwner: boolean;
  restoreReason: RestoreReason;
  /** Whether another tab owns this session (for ownership conflict UX). */
  ownershipConflict: boolean;
  /** Whether autoplay is blocked and user gesture is needed. */
  autoplayBlocked: boolean;

  initialize: (dojo: PlaybackState, mode?: DeliveryMode) => void;
  startDelivery: () => void;
  interrupt: () => void;
  replay: () => void;
  skip: () => void;
  resume: () => void;
  degradeToText: (reason: string) => void;
  restoreVoice: (reason: string) => void;
  tryRecover: (sessionId: string) => boolean;
  retryOwnership: () => boolean;
  /** User tapped to unlock audio after autoplay block. */
  unlockAudio: () => void;
  destroy: () => void;
}

// ── Hook ───────────────────────────────────────────────────────────

export function useDojoPlayback(config: TransportConfig): DojoPlaybackControls {
  const [ctrlState, setCtrlState] = useState<AudioControllerState | null>(null);
  const [lastDirective, setLastDirective] = useState<ControllerDirective | null>(null);
  const [wasRecovered, setWasRecovered] = useState(false);
  const [isOwner, setIsOwner] = useState(false);
  const [ownershipConflict, setOwnershipConflict] = useState(false);
  const [restoreReason, setRestoreReason] = useState<RestoreReason>(null);
  const [autoplayBlocked, setAutoplayBlocked] = useState(false);

  const ctrlRef = useRef<AudioControllerState | null>(null);
  const handleRef = useRef<TransportHandle>(createTransportHandle());
  const watchdogRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const metricsRef = useRef<DojoAudioMetrics>(createMetrics());
  const ownershipCleanupRef = useRef<(() => void) | null>(null);
  const visibilityCleanupRef = useRef<(() => void) | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pacingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastChunkRoleRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  /** Throttle rapid user actions (replay/skip/interrupt) — min 200ms between actions. */
  const lastActionTimeRef = useRef(0);
  const ACTION_THROTTLE_MS = 200;

  // Keep ref in sync with state + track metrics
  const applyResult = useCallback((result: ControllerResult) => {
    ctrlRef.current = result.state;
    setCtrlState(result.state);
    setLastDirective(result.directive);

    // Update restore reason if present
    if (result.state.restoreReason) {
      setRestoreReason(result.state.restoreReason);
      metricsRef.current = logRestoreReason(metricsRef.current, result.state.restoreReason);
    }

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
        } else {
          metricsRef.current = logRecovery(metricsRef.current, result.directive.reason);
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
        // Track audibility in failure path
        if (result.state.chunkAudibleState === 'failed_before_audible' || result.state.chunkAudibleState === 'failed_after_audible') {
          metricsRef.current = logChunkFailedAudibility(metricsRef.current, result.state.chunkAudibleState);
        }
        break;
    }

    // Persist snapshot for crash recovery
    if (result.state.dojo.sessionId) {
      saveSnapshot(result.state, {
        replayedChunkIds: Array.from(result.state.replayedChunkIds),
        skippedChunkIds: Array.from(result.state.skippedChunkIds),
      });
    }
  }, []);

  // Transport callback — with conversational pacing
  const handleTransportEvent = useCallback((result: ControllerResult) => {
    applyResult(result);

    // Detect autoplay blocks from failure messages
    if (result.directive.kind === 'no_op' || result.directive.kind === 'mode_changed') {
      // Check if the last failure was autoplay-related
      const failedPhase = result.state.chunkAudibleState;
      if (failedPhase === 'failed_before_audible' && !isAudioUnlocked()) {
        setAutoplayBlocked(true);
      }
    }

    // Mark audio as unlocked when we first achieve audibility
    if (result.state.chunkAudibleState === 'audible' && !isAudioUnlocked()) {
      markAudioUnlocked();
      setAutoplayBlocked(false);
    }

    if (result.directive.kind === 'speak' || result.directive.kind === 'retry_speak') {
      const chunk = result.directive.chunk;
      const opts = result.directive.kind === 'speak'
        ? { previousText: result.directive.previousText, nextText: result.directive.nextText }
        : undefined;

      // CRITICAL: Pass getCtrl so transport callbacks read fresh state, not stale closure
      const getCtrl = () => ctrlRef.current;

      // Apply inter-chunk pacing delay for natural feel
      const isFirst = result.state.completedChunkIds.size === 0;
      const delay = getInterChunkDelay(chunk, lastChunkRoleRef.current, isFirst);
      lastChunkRoleRef.current = chunk.role;

      // Clear any previous pacing timer
      if (pacingTimerRef.current) clearTimeout(pacingTimerRef.current);

      if (delay > 150) {
        pacingTimerRef.current = setTimeout(() => {
          speakChunk(chunk, result.state, config, handleRef.current, handleTransportEvent, opts, getCtrl)
            .then((h) => { handleRef.current = h; });
        }, delay);
      } else {
        speakChunk(chunk, result.state, config, handleRef.current, handleTransportEvent, opts, getCtrl)
          .then((h) => { handleRef.current = h; });
      }
    }
  }, [config, applyResult]);

  // ── Ownership helper ────────────────────────────────────────────

  const acquireOwnership = useCallback((sessionId: string): boolean => {
    const claim = claimSession(sessionId);
    if (!claim.ok) {
      setIsOwner(false);
      setOwnershipConflict(true);
      metricsRef.current = logOwnershipConflict(metricsRef.current);
      return false;
    }
    setIsOwner(true);
    setOwnershipConflict(false);
    sessionIdRef.current = sessionId;
    ownershipCleanupRef.current = startOwnershipHeartbeat(sessionId);
    return true;
  }, []);

  // ── Visibility wiring ──────────────────────────────────────────

  const wireVisibility = useCallback(() => {
    if (visibilityCleanupRef.current) visibilityCleanupRef.current();

    visibilityCleanupRef.current = startVisibilityGuard(
      () => ctrlRef.current?.dojo.playback.currentPlayingChunkId ?? null,
      () => ctrlRef.current?.dojo.playback.currentPlayingChunkId !== null && ctrlRef.current?.chunkStartedAt !== null,
      () => ctrlRef.current?.chunkAudibleState === 'audible',
      {
        onHidden: () => {
          const ctrl = ctrlRef.current;
          if (!ctrl) return;
          metricsRef.current = logTabHidden(metricsRef.current);
          // INVARIANT #13: Interrupt playback to avoid ghost state
          if (ctrl.dojo.playback.currentPlayingChunkId) {
            handleRef.current = stopPlayback(handleRef.current);
          }
          applyResult(onTabHidden(ctrl));
        },
        onVisible: (_checkpoint, _hiddenDuration) => {
          const ctrl = ctrlRef.current;
          if (!ctrl) return;
          metricsRef.current = logTabResume(metricsRef.current);
          const result = onTabVisible(ctrl);
          // If tab was hidden during playback and now there's an interrupted chunk,
          // auto-resume instead of waiting for user
          if (result.directive.kind === 'no_op' && result.directive.reason === 'tab_visible_interrupted') {
            const resumed = resumeAfterInterruption(result.state);
            handleTransportEvent(resumed);
          } else {
            handleTransportEvent(result);
          }
        },
      }
    );
  }, [applyResult, handleTransportEvent]);

  // ── Public controls ──────────────────────────────────────────────

  const initialize = useCallback((dojo: PlaybackState, mode: DeliveryMode = 'voice') => {
    // Claim ownership
    if (!acquireOwnership(dojo.sessionId)) {
      // Another tab owns it — expose conflict state
      const ctrl = createAudioController(dojo, 'text_fallback');
      ctrl.restoreReason = 'owner_conflict';
      ctrlRef.current = ctrl;
      setCtrlState(ctrl);
      setLastDirective(null);
      setWasRecovered(false);
      setRestoreReason('owner_conflict');
      return;
    }

    const ctrl = createAudioController(dojo, mode);
    ctrlRef.current = ctrl;
    setCtrlState(ctrl);
    setLastDirective(null);
    setWasRecovered(false);
    setRestoreReason(null);
    wireVisibility();
  }, [acquireOwnership, wireVisibility]);

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
      state: { ...updated, chunkAudibleState: 'requested' },
      directive: { kind: 'speak', chunk, ...context },
    });

    const getCtrl = () => ctrlRef.current;
    speakChunk(chunk, updated, config, handleRef.current, handleTransportEvent, context, getCtrl)
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
      const getCtrl = () => ctrlRef.current;
      speakChunk(
        result.directive.chunk,
        result.state,
        config,
        handleRef.current,
        handleTransportEvent,
        { previousText: result.directive.previousText, nextText: result.directive.nextText },
        getCtrl
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
    metricsRef.current = logRecovery(metricsRef.current, reason);
    applyResult(switchToVoice(ctrl, reason));
  }, [applyResult]);

  const tryRecover = useCallback((sessionId: string): boolean => {
    const loaded = loadSnapshot(sessionId);
    if (!loaded.ok) {
      if ('reason' in loaded && loaded.reason === 'version_mismatch') {
        metricsRef.current = logAmbiguousResume(metricsRef.current);
        setRestoreReason('version_mismatch');
      }
      return false;
    }

    // Claim ownership before recovering
    if (!acquireOwnership(sessionId)) {
      setRestoreReason('owner_conflict');
      return false;
    }

    const snap = loaded.snapshot;
    const ctrl = restoreFromSnapshot(snap);
    const reason = loaded.restoreReason as RestoreReason;
    metricsRef.current = logCrashRecovery(metricsRef.current, `${reason}:${sessionId}`);
    metricsRef.current = logRestoreReason(metricsRef.current, reason);
    setWasRecovered(true);
    setRestoreReason(reason);

    // Use the controller's own recovery path
    const controllerSnap = snapshotController(ctrl);
    const result = recoverSession(controllerSnap, reason);
    handleTransportEvent(result);
    wireVisibility();
    return true;
  }, [handleTransportEvent, acquireOwnership, wireVisibility]);

  const retryOwnership = useCallback((): boolean => {
    const sessionId = sessionIdRef.current ?? ctrlRef.current?.dojo.sessionId;
    if (!sessionId) return false;
    if (acquireOwnership(sessionId)) {
      setOwnershipConflict(false);
      // Restore voice if we were in text-only due to conflict
      const ctrl = ctrlRef.current;
      if (ctrl && ctrl.restoreReason === 'owner_conflict') {
        applyResult(switchToVoice(ctrl, 'ownership_acquired'));
      }
      wireVisibility();
      return true;
    }
    return false;
  }, [acquireOwnership, applyResult, wireVisibility]);

  const unlockAudio = useCallback(() => {
    markAudioUnlocked();
    setAutoplayBlocked(false);
    // Resume delivery if we were blocked
    const ctrl = ctrlRef.current;
    if (ctrl && ctrl.deliveryMode === 'text_fallback' && ctrl.restoreReason !== 'owner_conflict') {
      applyResult(switchToVoice(ctrl, 'user_gesture_unlock'));
      // Restart delivery from current chunk
      const updated = ctrlRef.current;
      if (updated) {
        const result = resumeAfterInterruption(updated);
        handleTransportEvent(result);
      }
    }
  }, [applyResult, handleTransportEvent]);

  const destroy = useCallback(() => {
    if (watchdogRef.current) {
      clearInterval(watchdogRef.current);
      watchdogRef.current = null;
    }
    if (pacingTimerRef.current) {
      clearTimeout(pacingTimerRef.current);
      pacingTimerRef.current = null;
    }
    logSessionSummary(metricsRef.current);
    metricsRef.current = createMetrics();
    destroyTransport(handleRef.current);
    handleRef.current = createTransportHandle();

    if (sessionIdRef.current) {
      releaseOwnership(sessionIdRef.current);
      sessionIdRef.current = null;
    }
    if (ownershipCleanupRef.current) {
      ownershipCleanupRef.current();
      ownershipCleanupRef.current = null;
    }
    if (visibilityCleanupRef.current) {
      visibilityCleanupRef.current();
      visibilityCleanupRef.current = null;
    }
    setIsOwner(false);
    setOwnershipConflict(false);
    setAutoplayBlocked(false);
    lastChunkRoleRef.current = undefined;

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
      if (sessionIdRef.current) releaseOwnership(sessionIdRef.current);
      if (ownershipCleanupRef.current) ownershipCleanupRef.current();
      if (visibilityCleanupRef.current) visibilityCleanupRef.current();
    };
  }, []);

  return {
    controllerState: ctrlState,
    lastDirective,
    deliveryMode: ctrlState?.deliveryMode ?? 'voice',
    isPlaying: ctrlState?.dojo.playback.currentPlayingChunkId !== null,
    metrics: metricsRef.current,
    wasRecovered,
    isOwner,
    restoreReason,
    ownershipConflict,
    autoplayBlocked,

    initialize,
    startDelivery,
    interrupt,
    replay,
    skip,
    resume: resumeDelivery,
    degradeToText,
    restoreVoice,
    tryRecover,
    retryOwnership,
    unlockAudio,
    destroy,
  };
}
