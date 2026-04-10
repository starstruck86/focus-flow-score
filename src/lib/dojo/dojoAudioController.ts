/**
 * Dojo Audio Controller v3.1
 *
 * Pure orchestration contract for Dave's voice delivery inside Sales Dojo.
 * Sits between playbackAdapter (state) and elevenlabsTransport (I/O).
 *
 * EXACT-ONCE DELIVERY INVARIANTS:
 * ────────────────────────────────
 * 1. completedChunkIds is the SOLE source of truth for "was this chunk delivered?"
 * 2. A chunk cannot enter completedChunkIds twice (Set enforced).
 * 3. A chunk cannot be spoken twice UNLESS it is an intentional replay
 *    (replay goes through onUserRequestedReplay, not advanceToNext).
 * 4. advanceToNext() ALWAYS skips past any chunk already in completedChunkIds.
 * 5. Duplicate 'ended' callbacks are suppressed by checking completedChunkIds FIRST.
 * 6. Stale callbacks (for a chunk that is no longer currentPlayingChunkId) are no-ops.
 * 7. Recovery after refresh never replays completed chunks (restoreFromSnapshot
 *    advances past completedChunkIds before emitting any directive).
 * 8. Text fallback counts a chunk as completed when show_text is emitted.
 * 9. Skip marks the chunk as completed + advances (never creates ghost replay).
 * 10. chunkStartedAt is NEVER restored from persistence — always null on recovery.
 * 11. Ownership conflicts must not produce duplicate playback.
 * 12. Requested audio is not the same as audible audio.
 * 13. Backgrounding should never strand Dave in a fake active state.
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

// ── Degradation Level ──────────────────────────────────────────────

/** Distinguishes chunk-level issues from session-wide voice failure. */
export type DegradationLevel = 'none' | 'chunk' | 'session';

// ── Audible State ──────────────────────────────────────────────────

/**
 * INVARIANT #12: Tracks whether audio actually became audible.
 * requested != audible. started != necessarily meaningfully audible.
 */
export type ChunkAudibleState =
  | 'none'           // no chunk active
  | 'requested'      // TTS request sent
  | 'blob_received'  // audio blob received from transport
  | 'play_attempted' // audio.play() called
  | 'audible'        // browser 'playing' event fired
  | 'ended'          // completed playback
  | 'failed_before_audible'  // failed before reaching audible
  | 'failed_after_audible';  // failed after audible started

// ── Restore Reason ────────────────────────────────────────────────

export type RestoreReason =
  | 'crash_recovery'
  | 'refresh_recovery'
  | 'resumed_text_fallback'
  | 'version_mismatch'
  | 'corrupt_snapshot'
  | 'stale_snapshot'
  | 'owner_conflict'
  | 'ambiguous_resume'
  | 'tab_resume'
  | null;

// ── Controller State ───────────────────────────────────────────────

export interface AudioControllerState {
  dojo: PlaybackState;
  deliveryMode: DeliveryMode;
  /** Timestamp (ms) when the current chunk started playing. null if idle. */
  chunkStartedAt: number | null;
  /**
   * INVARIANT #1: This Set is the SOLE source of truth for delivery completion.
   */
  completedChunkIds: Set<string>;
  /** Per-chunk attempt counts — prevents infinite retry loops. */
  chunkAttempts: Map<string, number>;
  /** Current degradation level. */
  degradation: DegradationLevel;
  /** IDs of chunks intentionally replayed (separate accounting from normal delivery). */
  replayedChunkIds: Set<string>;
  /** IDs of chunks intentionally skipped. */
  skippedChunkIds: Set<string>;
  /** Audible state for the current chunk. */
  chunkAudibleState: ChunkAudibleState;
  /** Last chunk that actually became audible. */
  lastAudibleChunkId: string | null;
  /** Why this session was restored, if applicable. */
  restoreReason: RestoreReason;
  /** Tab visibility state. */
  tabVisible: boolean;
}

/** Max attempts per individual chunk before giving up on it. */
const MAX_CHUNK_ATTEMPTS = 3;

/** Consecutive session-level failures before full session degradation. */
const SESSION_DEGRADE_THRESHOLD = 5;

/** If a chunk is playing longer than this, treat as hung. */
const CHUNK_TIMEOUT_MS = 45_000;

// ── Controller Output ──────────────────────────────────────────────

export type ControllerDirective =
  | { kind: 'speak'; chunk: SpeechChunk; previousText?: string; nextText?: string }
  | { kind: 'show_text'; chunk: SpeechChunk }
  | { kind: 'retry_speak'; chunk: SpeechChunk; attempt: number }
  | { kind: 'mode_changed'; mode: DeliveryMode; reason: string; level: DegradationLevel }
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
  degradation: DegradationLevel;
  replayedChunkIds: string[];
  skippedChunkIds: string[];
  restoreReason?: RestoreReason;
}

export function snapshotController(ctrl: AudioControllerState): ControllerSnapshot {
  return {
    dojo: ctrl.dojo,
    deliveryMode: ctrl.deliveryMode,
    completedChunkIds: Array.from(ctrl.completedChunkIds),
    chunkAttempts: Array.from(ctrl.chunkAttempts.entries()),
    degradation: ctrl.degradation,
    replayedChunkIds: Array.from(ctrl.replayedChunkIds),
    skippedChunkIds: Array.from(ctrl.skippedChunkIds),
    restoreReason: ctrl.restoreReason,
  };
}

export function restoreController(snap: ControllerSnapshot): AudioControllerState {
  return {
    dojo: snap.dojo,
    deliveryMode: snap.deliveryMode,
    chunkStartedAt: null, // INVARIANT #10: never restore mid-playback timestamp
    completedChunkIds: new Set(snap.completedChunkIds),
    chunkAttempts: new Map(snap.chunkAttempts),
    degradation: snap.degradation ?? 'none',
    replayedChunkIds: new Set(snap.replayedChunkIds ?? []),
    skippedChunkIds: new Set(snap.skippedChunkIds ?? []),
    chunkAudibleState: 'none',
    lastAudibleChunkId: null,
    restoreReason: snap.restoreReason ?? null,
    tabVisible: true,
  };
}

/**
 * Recover session from snapshot after refresh/crash.
 *
 * INVARIANT #7: Advances past all completedChunkIds before emitting directive.
 * If ambiguous, fails safe to text_fallback.
 */
export function recoverSession(snap: ControllerSnapshot, reason: RestoreReason = 'crash_recovery'): ControllerResult {
  const ctrl = restoreController(snap);

  // INVARIANT #4: Skip past completed chunks
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
    restoreReason: reason,
    dojo: {
      ...dojo,
      phase: hasRemaining ? 'delivering' : dojo.postDeliveryPhase,
      playback: {
        ...dojo.playback,
        currentPlayingChunkId: null, // INVARIANT #10
        interruptedChunkId: null,
      },
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
    degradation: mode === 'text_fallback' ? 'session' : 'none',
    replayedChunkIds: new Set(),
    skippedChunkIds: new Set(),
    chunkAudibleState: 'none',
    lastAudibleChunkId: null,
    restoreReason: null,
    tabVisible: true,
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

/**
 * INVARIANT #4: Always skips past completedChunkIds before fetching next.
 */
function advanceToNext(ctrl: AudioControllerState): ControllerResult {
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
      state: { ...ctrl, dojo: nextState, chunkStartedAt: null, chunkAudibleState: 'none' },
      directive: { kind: 'delivery_complete' },
    };
  }

  if (ctrl.deliveryMode === 'text_fallback') {
    // INVARIANT #8: text fallback counts chunk as completed when show_text emitted
    const completed = new Set(ctrl.completedChunkIds);
    completed.add(chunk.id);
    return {
      state: { ...ctrl, dojo: nextState, chunkStartedAt: null, completedChunkIds: completed, chunkAudibleState: 'none' },
      directive: { kind: 'show_text', chunk },
    };
  }

  const context = getStitchingContext(nextState.chunks, chunk.index);
  return {
    state: { ...ctrl, dojo: nextState, chunkStartedAt: null, chunkAudibleState: 'requested' },
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
      chunkAudibleState: 'requested',
    },
    directive: { kind: 'no_op', reason: 'tts_requested_ack' },
  };
}

/** Called when the audio blob has been received from transport. */
export function onTtsBlobReceived(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.dojo.playback.currentPlayingChunkId !== chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'stale_blob' } };
  }
  return {
    state: { ...ctrl, chunkAudibleState: 'blob_received' },
    directive: { kind: 'no_op', reason: 'blob_received_ack' },
  };
}

/** Called when audio.play() has been called (but not necessarily audible yet). */
export function onTtsPlayAttempted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.dojo.playback.currentPlayingChunkId !== chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'stale_play_attempt' } };
  }
  return {
    state: { ...ctrl, chunkAudibleState: 'play_attempted' },
    directive: { kind: 'no_op', reason: 'play_attempted_ack' },
  };
}

/**
 * Called when browser fires 'playing' event — audio is actually audible.
 * INVARIANT #12: Only after this should we consider the chunk "audible."
 */
export function onTtsStarted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  if (ctrl.dojo.playback.currentPlayingChunkId === chunkId && ctrl.chunkAudibleState === 'audible') {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'already_started' } };
  }
  const dojo = markChunkStarted(ctrl.dojo, chunkId);
  return {
    state: { ...ctrl, dojo, chunkStartedAt: Date.now(), chunkAudibleState: 'audible', lastAudibleChunkId: chunkId },
    directive: { kind: 'no_op', reason: 'tts_started_ack' },
  };
}

/**
 * INVARIANT #5: Checks completedChunkIds FIRST to suppress duplicate 'ended' callbacks.
 * INVARIANT #6: Rejects callbacks for chunks that aren't currently playing (stale).
 * INVARIANT #2: Adds to completedChunkIds exactly once via Set.add().
 */
export function onTtsCompleted(
  ctrl: AudioControllerState,
  chunkId: string
): ControllerResult {
  // INVARIANT #5: Suppress duplicate completed callback
  if (ctrl.completedChunkIds.has(chunkId)) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'duplicate_completed' } };
  }
  // INVARIANT #6: Suppress stale callback
  if (ctrl.dojo.playback.currentPlayingChunkId && ctrl.dojo.playback.currentPlayingChunkId !== chunkId) {
    return { state: ctrl, directive: { kind: 'no_op', reason: 'stale_chunk_completed' } };
  }

  // INVARIANT #2: Mark completed exactly once
  const completed = new Set(ctrl.completedChunkIds);
  completed.add(chunkId);
  const dojo = markChunkCompleted(ctrl.dojo, chunkId);

  return advanceToNext({
    ...ctrl,
    dojo,
    completedChunkIds: completed,
    chunkStartedAt: null,
    chunkAudibleState: 'ended',
    degradation: ctrl.degradation === 'chunk' ? 'none' : ctrl.degradation,
  });
}

export function onTtsFailed(
  ctrl: AudioControllerState,
  chunkId: string,
  error: string
): ControllerResult {
  const wasAudible = ctrl.chunkAudibleState === 'audible';
  const failedAudibleState: ChunkAudibleState = wasAudible ? 'failed_after_audible' : 'failed_before_audible';
  const dojo = markChunkFailed(ctrl.dojo, chunkId, error);
  const attempts = ctrl.chunkAttempts.get(chunkId) ?? 0;

  // Per-chunk limit reached → chunk-level degradation
  if (attempts >= MAX_CHUNK_ATTEMPTS) {
    const chunk = dojo.chunks.find((c) => c.id === chunkId);
    if (chunk) {
      // INVARIANT #9: Mark completed + add to skippedChunkIds
      const completed = new Set(ctrl.completedChunkIds);
      completed.add(chunkId);
      const skipped = new Set(ctrl.skippedChunkIds);
      skipped.add(chunkId);
      const advanced = advanceToNext({
        ...ctrl, dojo, completedChunkIds: completed,
        skippedChunkIds: skipped, chunkStartedAt: null,
        degradation: 'chunk', chunkAudibleState: failedAudibleState,
      });
      return {
        state: advanced.state,
        directive: { kind: 'chunk_skipped_max_retries', chunkId, chunk },
      };
    }
  }

  // Check for session-level degradation
  if (dojo.playback.consecutiveFailures >= SESSION_DEGRADE_THRESHOLD) {
    return {
      state: { ...ctrl, dojo, deliveryMode: 'text_fallback', degradation: 'session', chunkStartedAt: null, chunkAudibleState: failedAudibleState },
      directive: { kind: 'mode_changed', mode: 'text_fallback', reason: `${dojo.playback.consecutiveFailures} consecutive failures`, level: 'session' },
    };
  }

  // Global recovery (retry or degrade)
  const { action, nextState } = recoverFromPlaybackFailure(dojo);
  return applyRecovery({ ...ctrl, dojo: nextState, chunkStartedAt: null, chunkAudibleState: failedAudibleState }, action);
}

export function onUserInterrupted(ctrl: AudioControllerState): ControllerResult {
  const playingId = ctrl.dojo.playback.currentPlayingChunkId;
  if (playingId) {
    const dojo = markChunkInterrupted(ctrl.dojo, playingId);
    return {
      state: { ...ctrl, dojo, chunkStartedAt: null, chunkAudibleState: 'none' },
      directive: { kind: 'no_op', reason: 'interrupted' },
    };
  }
  const base = cancelDelivery(ctrl.dojo);
  const dojo: PlaybackState = { ...base, playback: ctrl.dojo.playback };
  return {
    state: { ...ctrl, dojo, chunkStartedAt: null, chunkAudibleState: 'none' },
    directive: { kind: 'no_op', reason: 'interrupted_idle' },
  };
}

/**
 * INVARIANT #3: Replay goes through this path, NOT advanceToNext.
 */
export function onUserRequestedReplay(ctrl: AudioControllerState): ControllerResult {
  const { chunk, nextState } = replayWithChunk(ctrl.dojo);
  if (!chunk) {
    return { state: { ...ctrl, dojo: nextState }, directive: { kind: 'no_op', reason: 'nothing_to_replay' } };
  }

  const replayed = new Set(ctrl.replayedChunkIds);
  replayed.add(chunk.id);

  if (ctrl.deliveryMode === 'text_fallback') {
    return { state: { ...ctrl, dojo: nextState, replayedChunkIds: replayed }, directive: { kind: 'show_text', chunk } };
  }
  const context = getStitchingContext(nextState.chunks, chunk.index);
  return { state: { ...ctrl, dojo: nextState, replayedChunkIds: replayed, chunkAudibleState: 'requested' }, directive: { kind: 'speak', chunk, ...context } };
}

/**
 * INVARIANT #9: Skip marks the chunk as completed AND adds to skippedChunkIds.
 */
export function onUserRequestedSkip(ctrl: AudioControllerState): ControllerResult {
  const currentChunkId = ctrl.dojo.chunks[ctrl.dojo.currentChunkIndex]?.id;
  const base = skipCurrentMessage(ctrl.dojo);
  const dojo = liftPlayback(base, ctrl.dojo);

  const completed = new Set(ctrl.completedChunkIds);
  const skipped = new Set(ctrl.skippedChunkIds);
  if (currentChunkId) {
    completed.add(currentChunkId);
    skipped.add(currentChunkId);
  }

  return advanceToNext({ ...ctrl, dojo, completedChunkIds: completed, skippedChunkIds: skipped, chunkStartedAt: null, chunkAudibleState: 'none' });
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

// ── Tab visibility ────────────────────────────────────────────────

/**
 * INVARIANT #13: When tab becomes hidden, checkpoint the state.
 * If playing, the browser may suspend audio silently.
 */
export function onTabHidden(ctrl: AudioControllerState): ControllerResult {
  const updated = { ...ctrl, tabVisible: false };
  // If actively playing, interrupt to prevent ghost state
  if (ctrl.dojo.playback.currentPlayingChunkId && ctrl.chunkStartedAt) {
    return onUserInterrupted(updated);
  }
  return { state: updated, directive: { kind: 'no_op', reason: 'tab_hidden_idle' } };
}

/**
 * When tab becomes visible, resume safely.
 * INVARIANT #4: Never re-deliver completed chunks.
 */
export function onTabVisible(ctrl: AudioControllerState): ControllerResult {
  const updated = { ...ctrl, tabVisible: true };
  // If there was an interrupted chunk, let the user decide to resume
  if (updated.dojo.playback.interruptedChunkId) {
    return { state: updated, directive: { kind: 'no_op', reason: 'tab_visible_interrupted' } };
  }
  // If idle and delivering, try advancing
  if (updated.dojo.phase === 'delivering' && !updated.dojo.playback.currentPlayingChunkId) {
    return advanceToNext(updated);
  }
  return { state: updated, directive: { kind: 'no_op', reason: 'tab_visible_ok' } };
}

// ── Mode switching ─────────────────────────────────────────────────

export function switchToTextFallback(ctrl: AudioControllerState, reason: string): ControllerResult {
  return {
    state: { ...ctrl, deliveryMode: 'text_fallback', chunkStartedAt: null, degradation: 'session', chunkAudibleState: 'none' },
    directive: { kind: 'mode_changed', mode: 'text_fallback', reason, level: 'session' },
  };
}

export function switchToVoice(ctrl: AudioControllerState, reason: string): ControllerResult {
  return {
    state: {
      ...ctrl,
      deliveryMode: 'voice',
      degradation: 'none',
      chunkAudibleState: 'none',
      dojo: { ...ctrl.dojo, playback: { ...ctrl.dojo.playback, consecutiveFailures: 0 } },
    },
    directive: { kind: 'mode_changed', mode: 'voice', reason, level: 'none' },
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
      const degraded: AudioControllerState = { ...ctrl, deliveryMode: 'text_fallback', degradation: 'session' };
      const failedId = ctrl.dojo.playback.lastFailedChunkId;
      const failedChunk = failedId ? ctrl.dojo.chunks.find((c) => c.id === failedId) : null;

      if (failedChunk) {
        return { state: degraded, directive: { kind: 'show_text', chunk: failedChunk } };
      }
      return { state: degraded, directive: { kind: 'mode_changed', mode: 'text_fallback', reason: action.reason, level: 'session' } };
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
