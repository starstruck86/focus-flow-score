/**
 * Dojo Audio Controller
 *
 * Pure orchestration contract for Dave's voice delivery inside Sales Dojo.
 * Sits between playbackAdapter (state) and a future ElevenLabs transport layer.
 *
 * Responsibilities:
 * - Maps controller events → playback adapter state transitions
 * - Manages explicit delivery mode (voice / text_fallback)
 * - Protects against duplicate events, stale chunks, and hung playback
 * - Guarantees text fallback path without session reset
 *
 * No SDK code. No UI. No side effects. Pure state-in → state-out.
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
}

// ── Controller Output ──────────────────────────────────────────────

export type ControllerDirective =
  | { kind: 'speak'; chunk: SpeechChunk; previousText?: string; nextText?: string }
  | { kind: 'show_text'; chunk: SpeechChunk }
  | { kind: 'retry_speak'; chunk: SpeechChunk }
  | { kind: 'mode_changed'; mode: DeliveryMode; reason: string }
  | { kind: 'delivery_complete' }
  | { kind: 'no_op'; reason: string };

export interface ControllerResult {
  state: AudioControllerState;
  directive: ControllerDirective;
}

// ── Constants ──────────────────────────────────────────────────────

/** If a chunk is playing longer than this, treat as hung. */
const CHUNK_TIMEOUT_MS = 45_000;

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
  };
}

// ── Stitching context helper ───────────────────────────────────────

function getStitchingContext(
  chunks: SpeechChunk[],
  currentIndex: number
): { previousText?: string; nextText?: string } {
  const prev = currentIndex > 0 ? chunks[currentIndex - 1]?.text : undefined;
  const next = currentIndex < chunks.length - 1 ? chunks[currentIndex + 1]?.text : undefined;
  return { previousText: prev, nextText: next };
}

// ── Helpers ────────────────────────────────────────────────────────

/** Preserve playback checkpoint when core engine returns ConversationState. */
function liftPlayback(base: ReturnType<typeof getNextMessage>['nextState'], pb: PlaybackState): PlaybackState {
  return { ...base, playback: (base as Partial<PlaybackState>).playback ?? pb.playback };
}

// ── Core: advance to next chunk ────────────────────────────────────

function advanceToNext(ctrl: AudioControllerState): ControllerResult {
  const { chunk, nextState: raw } = getNextMessage(ctrl.dojo);
  const nextState = liftPlayback(raw, ctrl.dojo);

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

/** TTS transport requests audio for a chunk. */
export function onTtsRequested(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  // Duplicate guard
  if (ctrl.dojo.playback.currentPlayingChunkId === chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'already_playing' } };
  }

  const dojo = markChunkStarted(ctrl.dojo, chunkId);
  return {
    state: { ...ctrl, dojo, chunkStartedAt: Date.now() },
    directive: { kind: 'no_op', reason: 'tts_requested_ack' },
  };
}

/** TTS playback has begun (audio is audible). */
export function onTtsStarted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  // Already tracked via onTtsRequested — just update timestamp if needed
  if (ctrl.dojo.playback.currentPlayingChunkId === chunkId && ctrl.chunkStartedAt) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'already_started' } };
  }

  const dojo = markChunkStarted(ctrl.dojo, chunkId);
  return {
    state: { ...ctrl, dojo, chunkStartedAt: Date.now() },
    directive: { kind: 'no_op', reason: 'tts_started_ack' },
  };
}

/** TTS playback finished successfully for a chunk. */
export function onTtsCompleted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  // Duplicate guard — never advance twice for same chunk
  if (ctrl.completedChunkIds.has(chunkId)) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'duplicate_completed' } };
  }

  // Stale guard — ignore if a different chunk is now playing
  if (ctrl.dojo.playback.currentPlayingChunkId && ctrl.dojo.playback.currentPlayingChunkId !== chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'stale_chunk_completed' } };
  }

  const completed = new Set(ctrl.completedChunkIds);
  completed.add(chunkId);
  const dojo = markChunkCompleted(ctrl.dojo, chunkId);

  const next = advanceToNext({ ...ctrl, dojo, completedChunkIds: completed, chunkStartedAt: null });
  return next;
}

/** TTS playback failed for a chunk. */
export function onTtsFailed(
  ctrl: AudioControllerState,
  chunkId: string,
  error: string
): ControllerResult {
  const dojo = markChunkFailed(ctrl.dojo, chunkId, error);
  const { action, nextState } = recoverFromPlaybackFailure(dojo);

  return applyRecovery({ ...ctrl, dojo: nextState, chunkStartedAt: null }, action);
}

/** User interrupted Dave mid-speech. */
export function onUserInterrupted(ctrl: AudioControllerState): ControllerResult {
  const playingId = ctrl.dojo.playback.currentPlayingChunkId;

  if (playingId) {
    const dojo = markChunkInterrupted(ctrl.dojo, playingId);
    return {
      state: { ...ctrl, dojo, chunkStartedAt: null },
      directive: { kind: 'no_op', reason: 'interrupted' },
    };
  }

  // Not currently playing — just cancel delivery if in progress
  const base = cancelDelivery(ctrl.dojo);
  const dojo: PlaybackState = { ...base, playback: ctrl.dojo.playback };
  return {
    state: { ...ctrl, dojo, chunkStartedAt: null },
    directive: { kind: 'no_op', reason: 'interrupted_idle' },
  };
}

/** User requested replay of the last chunk. */
export function onUserRequestedReplay(ctrl: AudioControllerState): ControllerResult {
  const { chunk, nextState } = replayWithChunk(ctrl.dojo);

  if (!chunk) {
    return {
      state: { ...ctrl, dojo: nextState },
      directive: { kind: 'no_op', reason: 'nothing_to_replay' },
    };
  }

  if (ctrl.deliveryMode === 'text_fallback') {
    return {
      state: { ...ctrl, dojo: nextState },
      directive: { kind: 'show_text', chunk },
    };
  }

  const context = getStitchingContext(nextState.chunks, chunk.index);
  return {
    state: { ...ctrl, dojo: nextState },
    directive: { kind: 'speak', chunk, ...context },
  };
}

/** User requested skip of current chunk. */
export function onUserRequestedSkip(ctrl: AudioControllerState): ControllerResult {
  const dojo = skipCurrentMessage(ctrl.dojo) as PlaybackState;
  return advanceToNext({ ...ctrl, dojo, chunkStartedAt: null });
}

// ── Timeout check ──────────────────────────────────────────────────

/**
 * Call periodically (e.g. every 5s). If the current chunk has been
 * "playing" longer than CHUNK_TIMEOUT_MS, treat it as a failure.
 */
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

// ── Resume after interruption ──────────────────────────────────────

/** Resume delivery after interruption/follow-up. */
export function resumeAfterInterruption(ctrl: AudioControllerState): ControllerResult {
  const dojo = resumeDeliveryStrict(ctrl.dojo);
  if (dojo.phase !== 'delivering') {
    return { state: { ...ctrl, dojo }, directive: { kind: 'no_op', reason: 'cannot_resume' } };
  }
  return advanceToNext({ ...ctrl, dojo });
}

// ── Explicit mode switch ───────────────────────────────────────────

/** Force switch to text fallback (e.g. user preference or manual trigger). */
export function switchToTextFallback(
  ctrl: AudioControllerState,
  reason: string
): ControllerResult {
  return {
    state: { ...ctrl, deliveryMode: 'text_fallback', chunkStartedAt: null },
    directive: { kind: 'mode_changed', mode: 'text_fallback', reason },
  };
}

/** Attempt to restore voice mode (e.g. after connectivity recovery). */
export function switchToVoice(
  ctrl: AudioControllerState,
  reason: string
): ControllerResult {
  return {
    state: {
      ...ctrl,
      deliveryMode: 'voice',
      dojo: {
        ...ctrl.dojo,
        playback: { ...ctrl.dojo.playback, consecutiveFailures: 0 },
      },
    },
    directive: { kind: 'mode_changed', mode: 'voice', reason },
  };
}

// ── Recovery routing ───────────────────────────────────────────────

function applyRecovery(
  ctrl: AudioControllerState,
  action: RecoveryAction
): ControllerResult {
  switch (action.kind) {
    case 'retry_chunk':
      if (ctrl.deliveryMode === 'text_fallback') {
        return {
          state: ctrl,
          directive: { kind: 'show_text', chunk: action.chunk },
        };
      }
      return {
        state: ctrl,
        directive: { kind: 'retry_speak', chunk: action.chunk },
      };

    case 'degrade_to_text': {
      const degraded: AudioControllerState = { ...ctrl, deliveryMode: 'text_fallback' };

      // Find the failed chunk to show immediately as text
      const failedId = ctrl.dojo.playback.lastFailedChunkId;
      const failedChunk = failedId ? ctrl.dojo.chunks.find((c) => c.id === failedId) : null;

      if (failedChunk) {
        return {
          state: degraded,
          directive: { kind: 'show_text', chunk: failedChunk },
        };
      }

      return {
        state: degraded,
        directive: { kind: 'mode_changed', mode: 'text_fallback', reason: action.reason },
      };
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
