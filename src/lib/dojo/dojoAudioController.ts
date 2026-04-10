/**
 * Dojo Audio Controller v2
 *
 * Pure orchestration contract for Dave's voice delivery inside Sales Dojo.
 * Sits between playbackAdapter (state) and elevenlabsTransport (I/O).
 *
 * v2 additions over v1:
 * - Per-chunk retry tracking (chunkAttempts map)
 * - Serializable state for reconnect/refresh recovery
 * - Richer UI directives (voice_degraded, voice_restored, chunk_skipped_max_retries)
 * - All state remains pure (state-in → state-out), no side effects
 */

import type { SpeechChunk } from './conversationEngine';
import type { PlaybackState, RecoveryAction } from './playbackAdapter';
import {
  markChunkStarted,
  markChunkCompleted,
  markChunkFailed,
  markChunkInterrupted,
  recoverFromPlaybackFailure,
  replayWithChunk,
  resumeDeliveryStrict,
  getNextMessage,
  skipCurrentMessage,
  cancelDelivery,
} from './playbackAdapter';

// ── Delivery Mode ──────────────────────────────────────────────────

export type DeliveryMode = 'voice' | 'text_fallback';

// ── Controller State ───────────────────────────────────────────────

export interface AudioControllerState {
  dojo: PlaybackState;
  deliveryMode: DeliveryMode;
  /** Timestamp (ms) when the current chunk started playing. null if idle. */
  chunkStartedAt: number | null;
  /** Set of chunk IDs already completed — prevents duplicate advancement. */
  completedChunkIds: Set<string>;
  /** Per-chunk attempt counts — prevents infinite retry loops. */
  chunkAttempts: Map<string, number>;
}

/** Max attempts per individual chunk before giving up on it. */
const MAX_CHUNK_ATTEMPTS = 3;

/** If a chunk is playing longer than this, treat as hung. */
const CHUNK_TIMEOUT_MS = 45_000;

// ── Controller Output ──────────────────────────────────────────────

export type ControllerDirective =
  | { kind: 'speak'; chunk: SpeechChunk; previousText?: string; nextText?: string }
  | { kind: 'show_text'; chunk: SpeechChunk }
  | { kind: 'retry_speak'; chunk: SpeechChunk; attempt: number }
  | { kind: 'mode_changed'; mode: DeliveryMode; reason: string }
  | { kind: 'chunk_skipped_max_retries'; chunkId: string; chunk: SpeechChunk }
  | { kind: 'delivery_complete' }
  | { kind: 'no_op'; reason: string };

export interface ControllerResult {
  state: AudioControllerState;
  directive: ControllerDirective;
}

// ── Serializable snapshot for recovery ─────────────────────────────

export interface ControllerSnapshot {
  dojo: PlaybackState;
  deliveryMode: DeliveryMode;
  completedChunkIds: string[];
  chunkAttempts: [string, number][];
}

export function snapshotController(ctrl: AudioControllerState): ControllerSnapshot {
  return {
    dojo: ctrl.dojo,
    deliveryMode: ctrl.deliveryMode,
    completedChunkIds: Array.from(ctrl.completedChunkIds),
    chunkAttempts: Array.from(ctrl.chunkAttempts.entries()),
  };
}

export function restoreController(snap: ControllerSnapshot): AudioControllerState {
  return {
    dojo: snap.dojo,
    deliveryMode: snap.deliveryMode,
    chunkStartedAt: null, // never restore mid-playback timestamp
    completedChunkIds: new Set(snap.completedChunkIds),
    chunkAttempts: new Map(snap.chunkAttempts),
  };
}

/**
 * Decide delivery mode on restore:
 * - If was voice and no recent failures → stay voice
 * - If degraded → stay text_fallback
 * - Skip already-completed chunks by advancing currentChunkIndex
 */
export function recoverSession(snap: ControllerSnapshot): ControllerResult {
  const ctrl = restoreController(snap);

  // Advance past completed chunks
  let { dojo } = ctrl;
  while (
    dojo.currentChunkIndex < dojo.chunks.length &&
    ctrl.completedChunkIds.has(dojo.chunks[dojo.currentChunkIndex].id)
  ) {
    dojo = { ...dojo, currentChunkIndex: dojo.currentChunkIndex + 1 };
  }

  const hasRemaining = dojo.currentChunkIndex < dojo.chunks.length;
  const recovered: AudioControllerState = {
    ...ctrl,
    dojo: {
      ...dojo,
      phase: hasRemaining ? 'delivering' : dojo.postDeliveryPhase,
    },
  };

  if (!hasRemaining) {
    return { state: recovered, directive: { kind: 'delivery_complete' } };
  }

  return advanceToNext(recovered);
}

// ── Initialisation ─────────────────────────────────────────────────

export function createAudioController(
  dojo: PlaybackState,
  mode: DeliveryMode = 'voice'
): AudioControllerState {
  return {
    dojo,
    deliveryMode: mode,
    chunkStartedAt: null,
    completedChunkIds: new Set(),
    chunkAttempts: new Map(),
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function getStitchingContext(
  chunks: SpeechChunk[],
  currentIndex: number
): { previousText?: string; nextText?: string } {
  const prev = currentIndex > 0 ? chunks[currentIndex - 1]?.text : undefined;
  const next = currentIndex < chunks.length - 1 ? chunks[currentIndex + 1]?.text : undefined;
  return { previousText: prev, nextText: next };
}

function liftPlayback(
  base: ReturnType<typeof getNextMessage>['nextState'],
  pb: PlaybackState
): PlaybackState {
  return { ...base, playback: (base as Partial<PlaybackState>).playback ?? pb.playback };
}

function incrementAttempts(map: Map<string, number>, chunkId: string): Map<string, number> {
  const next = new Map(map);
  next.set(chunkId, (next.get(chunkId) ?? 0) + 1);
  return next;
}

// ── Core: advance to next chunk ────────────────────────────────────

function advanceToNext(ctrl: AudioControllerState): ControllerResult {
  // Skip past any already-completed chunks before fetching next
  let dojo = ctrl.dojo;
  while (
    dojo.phase === 'delivering' &&
    dojo.currentChunkIndex < dojo.chunks.length &&
    ctrl.completedChunkIds.has(dojo.chunks[dojo.currentChunkIndex].id)
  ) {
    dojo = { ...dojo, currentChunkIndex: dojo.currentChunkIndex + 1 };
  }

  const { chunk, nextState: raw } = getNextMessage(dojo);
  const nextState = liftPlayback(raw, dojo);

  if (!chunk) {
    return {
      state: { ...ctrl, dojo: nextState, chunkStartedAt: null },
      directive: { kind: 'delivery_complete' },
    };
  }

  if (ctrl.deliveryMode === 'text_fallback') {
    return {
      state: { ...ctrl, dojo: nextState, chunkStartedAt: null },
      directive: { kind: 'show_text', chunk },
    };
  }

  const context = getStitchingContext(nextState.chunks, chunk.index);
  return {
    state: { ...ctrl, dojo: nextState, chunkStartedAt: null },
    directive: { kind: 'speak', chunk, ...context },
  };
}

// ── Event Handlers ─────────────────────────────────────────────────

export function onTtsRequested(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.dojo.playback.currentPlayingChunkId === chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'already_playing' } };
  }
  const dojo = markChunkStarted(ctrl.dojo, chunkId);
  return {
    state: {
      ...ctrl,
      dojo,
      chunkStartedAt: Date.now(),
      chunkAttempts: incrementAttempts(ctrl.chunkAttempts, chunkId),
    },
    directive: { kind: 'no_op', reason: 'tts_requested_ack' },
  };
}

export function onTtsStarted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.dojo.playback.currentPlayingChunkId === chunkId && ctrl.chunkStartedAt) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'already_started' } };
  }
  const dojo = markChunkStarted(ctrl.dojo, chunkId);
  return {
    state: { ...ctrl, dojo, chunkStartedAt: Date.now() },
    directive: { kind: 'no_op', reason: 'tts_started_ack' },
  };
}

export function onTtsCompleted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.completedChunkIds.has(chunkId)) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'duplicate_completed' } };
  }
  if (ctrl.dojo.playback.currentPlayingChunkId && ctrl.dojo.playback.currentPlayingChunkId !== chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'stale_chunk_completed' } };
  }

  const completed = new Set(ctrl.completedChunkIds);
  completed.add(chunkId);
  const dojo = markChunkCompleted(ctrl.dojo, chunkId);

  return advanceToNext({ ...ctrl, dojo, completedChunkIds: completed, chunkStartedAt: null });
}

export function onTtsFailed(
  ctrl: AudioControllerState,
  chunkId: string,
  error: string
): ControllerResult {
  const dojo = markChunkFailed(ctrl.dojo, chunkId, error);
  const attempts = ctrl.chunkAttempts.get(chunkId) ?? 0;

  // Per-chunk limit reached → skip this chunk, show as text, continue
  if (attempts >= MAX_CHUNK_ATTEMPTS) {
    const chunk = dojo.chunks.find((c) => c.id === chunkId);
    if (chunk) {
      // Mark completed so we don't retry, then advance
      const completed = new Set(ctrl.completedChunkIds);
      completed.add(chunkId);
      const advanced = advanceToNext({ ...ctrl, dojo, completedChunkIds: completed, chunkStartedAt: null });
      return {
        state: advanced.state,
        directive: { kind: 'chunk_skipped_max_retries', chunkId, chunk },
      };
    }
  }

  // Global recovery (retry or degrade)
  const { action, nextState } = recoverFromPlaybackFailure(dojo);
  return applyRecovery({ ...ctrl, dojo: nextState, chunkStartedAt: null }, action);
}

export function onUserInterrupted(ctrl: AudioControllerState): ControllerResult {
  const playingId = ctrl.dojo.playback.currentPlayingChunkId;
  if (playingId) {
    const dojo = markChunkInterrupted(ctrl.dojo, playingId);
    return {
      state: { ...ctrl, dojo, chunkStartedAt: null },
      directive: { kind: 'no_op', reason: 'interrupted' },
    };
  }
  const base = cancelDelivery(ctrl.dojo);
  const dojo: PlaybackState = { ...base, playback: ctrl.dojo.playback };
  return {
    state: { ...ctrl, dojo, chunkStartedAt: null },
    directive: { kind: 'no_op', reason: 'interrupted_idle' },
  };
}

export function onUserRequestedReplay(ctrl: AudioControllerState): ControllerResult {
  const { chunk, nextState } = replayWithChunk(ctrl.dojo);
  if (!chunk) {
    return { state: { ...ctrl, dojo: nextState }, directive: { kind: 'no_op', reason: 'nothing_to_replay' } };
  }
  if (ctrl.deliveryMode === 'text_fallback') {
    return { state: { ...ctrl, dojo: nextState }, directive: { kind: 'show_text', chunk } };
  }
  const context = getStitchingContext(nextState.chunks, chunk.index);
  return { state: { ...ctrl, dojo: nextState }, directive: { kind: 'speak', chunk, ...context } };
}

export function onUserRequestedSkip(ctrl: AudioControllerState): ControllerResult {
  const base = skipCurrentMessage(ctrl.dojo);
  const dojo = liftPlayback(base, ctrl.dojo);
  return advanceToNext({ ...ctrl, dojo, chunkStartedAt: null });
}

// ── Timeout ────────────────────────────────────────────────────────

export function checkForTimeout(ctrl: AudioControllerState): ControllerResult {
  if (!ctrl.chunkStartedAt || !ctrl.dojo.playback.currentPlayingChunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'no_active_playback' } };
  }
  const elapsed = Date.now() - ctrl.chunkStartedAt;
  if (elapsed < CHUNK_TIMEOUT_MS) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'within_timeout' } };
  }
  return onTtsFailed(ctrl, ctrl.dojo.playback.currentPlayingChunkId, `Chunk timed out after ${elapsed}ms`);
}

// ── Resume ─────────────────────────────────────────────────────────

export function resumeAfterInterruption(ctrl: AudioControllerState): ControllerResult {
  const dojo = resumeDeliveryStrict(ctrl.dojo);
  if (dojo.phase !== 'delivering') {
    return { state: { ...ctrl, dojo }, directive: { kind: 'no_op', reason: 'cannot_resume' } };
  }
  return advanceToNext({ ...ctrl, dojo });
}

// ── Mode switching ─────────────────────────────────────────────────

export function switchToTextFallback(ctrl: AudioControllerState, reason: string): ControllerResult {
  return {
    state: { ...ctrl, deliveryMode: 'text_fallback', chunkStartedAt: null },
    directive: { kind: 'mode_changed', mode: 'text_fallback', reason },
  };
}

export function switchToVoice(ctrl: AudioControllerState, reason: string): ControllerResult {
  return {
    state: {
      ...ctrl,
      deliveryMode: 'voice',
      dojo: { ...ctrl.dojo, playback: { ...ctrl.dojo.playback, consecutiveFailures: 0 } },
    },
    directive: { kind: 'mode_changed', mode: 'voice', reason },
  };
}

// ── Recovery routing ───────────────────────────────────────────────

function applyRecovery(ctrl: AudioControllerState, action: RecoveryAction): ControllerResult {
  switch (action.kind) {
    case 'retry_chunk': {
      const attempt = ctrl.chunkAttempts.get(action.chunkId) ?? 0;
      if (ctrl.deliveryMode === 'text_fallback') {
        return { state: ctrl, directive: { kind: 'show_text', chunk: action.chunk } };
      }
      return { state: ctrl, directive: { kind: 'retry_speak', chunk: action.chunk, attempt } };
    }

    case 'degrade_to_text': {
      const degraded: AudioControllerState = { ...ctrl, deliveryMode: 'text_fallback' };
      const failedId = ctrl.dojo.playback.lastFailedChunkId;
      const failedChunk = failedId ? ctrl.dojo.chunks.find((c) => c.id === failedId) : null;

      if (failedChunk) {
        return { state: degraded, directive: { kind: 'show_text', chunk: failedChunk } };
      }
      return { state: degraded, directive: { kind: 'mode_changed', mode: 'text_fallback', reason: action.reason } };
    }

    case 'no_action':
      return { state: ctrl, directive: { kind: 'no_op', reason: 'no_recovery_needed' } };
  }
}

// ── Queries ────────────────────────────────────────────────────────

export function isVoiceMode(ctrl: AudioControllerState): boolean {
  return ctrl.deliveryMode === 'voice';
}

export function isTextFallback(ctrl: AudioControllerState): boolean {
  return ctrl.deliveryMode === 'text_fallback';
}

export function isChunkPlaying(ctrl: AudioControllerState): boolean {
  return ctrl.dojo.playback.currentPlayingChunkId !== null;
}

export function getChunkAttempts(ctrl: AudioControllerState, chunkId: string): number {
  return ctrl.chunkAttempts.get(chunkId) ?? 0;
}
