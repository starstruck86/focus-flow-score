/**
 * Dojo Playback Adapter
 *
 * Thin, pure layer on top of conversationEngine.ts that adds:
 * - Chunk-level playback lifecycle (started / completed / failed / interrupted)
 * - Delivery checkpoint fields for TTS recovery
 * - Failure recovery path (retry-same-chunk or degrade gracefully)
 * - Unified replay helper that logs + returns the chunk in one call
 *
 * No UI. No ElevenLabs. No side effects outside state/history.
 */

import type {
  ConversationState,
  SpeechChunk,
  HistoryEntry,
  HistoryEventType,
  ChunkRole,
  PostDeliveryPhase,
} from './conversationEngine';

// Re-export everything from the core engine so consumers can import from one place
export * from './conversationEngine';

// ── Playback event types (extend core history) ─────────────────────

export type PlaybackEventType =
  | HistoryEventType
  | 'chunk_started'
  | 'chunk_completed'
  | 'chunk_failed'
  | 'chunk_interrupted'
  | 'playback_recovered';

// ── Playback checkpoint fields ─────────────────────────────────────

export interface PlaybackCheckpoint {
  currentPlayingChunkId: string | null;
  lastCompletedChunkId: string | null;
  lastFailedChunkId: string | null;
  interruptedChunkId: string | null;
  consecutiveFailures: number;
}

/** Extended state with playback tracking. */
export interface PlaybackState extends ConversationState {
  playback: PlaybackCheckpoint;
}

// ── Constants ──────────────────────────────────────────────────────

/** Max consecutive TTS failures before degrading to text-only. */
const MAX_CONSECUTIVE_FAILURES = 3;

/** Phases from which resumeDelivery is allowed. */
const RESUMABLE_PHASES = new Set<string>([
  'awaiting_followup',
  'awaiting_confirmation',
]);

// ── History helper ─────────────────────────────────────────────────

function pushPlaybackEvent(
  history: HistoryEntry[],
  eventType: PlaybackEventType,
  opts: {
    chunkId?: string;
    chunkRole?: ChunkRole;
    text: string;
    role?: 'user' | 'coach' | 'system';
  }
): HistoryEntry[] {
  return [
    ...history,
    {
      turn: history.length,
      timestamp: Date.now(),
      role: opts.role ?? 'system',
      eventType: eventType as HistoryEventType, // safe: superset stored as string
      chunkId: opts.chunkId,
      chunkRole: opts.chunkRole,
      text: opts.text,
    },
  ];
}

// ── Initialisation ─────────────────────────────────────────────────

/** Wrap a ConversationState with playback checkpoint fields. */
export function withPlayback(state: ConversationState): PlaybackState {
  return {
    ...state,
    playback: {
      currentPlayingChunkId: null,
      lastCompletedChunkId: null,
      lastFailedChunkId: null,
      interruptedChunkId: null,
      consecutiveFailures: 0,
    },
  };
}

// ── Chunk lifecycle helpers ────────────────────────────────────────

export function markChunkStarted(state: PlaybackState, chunkId: string): PlaybackState {
  const chunk = state.chunks.find((c) => c.id === chunkId);
  return {
    ...state,
    playback: { ...state.playback, currentPlayingChunkId: chunkId },
    history: pushPlaybackEvent(state.history, 'chunk_started', {
      chunkId,
      chunkRole: chunk?.role,
      text: `Playback started: ${chunk?.label ?? chunkId}`,
    }),
  };
}

export function markChunkCompleted(state: PlaybackState, chunkId: string): PlaybackState {
  const chunk = state.chunks.find((c) => c.id === chunkId);
  return {
    ...state,
    playback: {
      ...state.playback,
      currentPlayingChunkId: null,
      lastCompletedChunkId: chunkId,
      consecutiveFailures: 0, // reset on success
    },
    history: pushPlaybackEvent(state.history, 'chunk_completed', {
      chunkId,
      chunkRole: chunk?.role,
      text: `Playback completed: ${chunk?.label ?? chunkId}`,
    }),
  };
}

export function markChunkFailed(
  state: PlaybackState,
  chunkId: string,
  error: string
): PlaybackState {
  const chunk = state.chunks.find((c) => c.id === chunkId);
  return {
    ...state,
    playback: {
      ...state.playback,
      currentPlayingChunkId: null,
      lastFailedChunkId: chunkId,
      consecutiveFailures: state.playback.consecutiveFailures + 1,
    },
    history: pushPlaybackEvent(state.history, 'chunk_failed', {
      chunkId,
      chunkRole: chunk?.role,
      text: `Playback failed: ${error}`,
    }),
  };
}

export function markChunkInterrupted(state: PlaybackState, chunkId: string): PlaybackState {
  const chunk = state.chunks.find((c) => c.id === chunkId);
  return {
    ...state,
    playback: {
      ...state.playback,
      currentPlayingChunkId: null,
      interruptedChunkId: chunkId,
    },
    phase: 'awaiting_followup',
    history: pushPlaybackEvent(state.history, 'chunk_interrupted', {
      chunkId,
      chunkRole: chunk?.role,
      text: `Playback interrupted: ${chunk?.label ?? chunkId}`,
    }),
  };
}

// ── Tightened resumeDelivery ───────────────────────────────────────

/**
 * Resume delivery only from safe phases.
 * Refuses to resume from scoring, completed, awaiting_response, or cancelled.
 */
export function resumeDeliveryStrict(state: PlaybackState): PlaybackState {
  if (!RESUMABLE_PHASES.has(state.phase)) return state;
  if (state.currentChunkIndex >= state.chunks.length) return state;

  return {
    ...state,
    phase: 'delivering',
    playback: { ...state.playback, interruptedChunkId: null },
    history: pushPlaybackEvent(state.history, 'delivery_resumed' as PlaybackEventType, {
      text: `Resumed at chunk ${state.currentChunkIndex + 1}/${state.chunks.length}`,
    }),
  };
}

// ── Unified replay ─────────────────────────────────────────────────

/**
 * Single helper: logs the replay_request user event, logs the replayed
 * system event, and returns the chunk payload — all in one call.
 */
export function replayWithChunk(state: PlaybackState): {
  chunk: SpeechChunk | null;
  nextState: PlaybackState;
} {
  // Log user request
  let history = pushPlaybackEvent(state.history, 'user_input' as PlaybackEventType, {
    role: 'user',
    text: 'Replay requested',
  });

  const targetId = state.playback.interruptedChunkId ?? state.lastDeliveredChunkId;
  if (!targetId) return { chunk: null, nextState: { ...state, history } };

  const chunk = state.chunks.find((c) => c.id === targetId) ?? null;
  if (!chunk) return { chunk: null, nextState: { ...state, history } };

  // Log replayed event
  history = pushPlaybackEvent(history, 'replayed' as PlaybackEventType, {
    chunkId: chunk.id,
    chunkRole: chunk.role,
    text: chunk.text,
  });

  return { chunk, nextState: { ...state, history } };
}

// ── TTS failure recovery ───────────────────────────────────────────

export type RecoveryAction =
  | { kind: 'retry_chunk'; chunkId: string; chunk: SpeechChunk }
  | { kind: 'degrade_to_text'; reason: string }
  | { kind: 'no_action' };

/**
 * Decide recovery action after a playback failure.
 * - If under the failure threshold → retry the same chunk
 * - If at/above threshold → degrade to text-only delivery
 */
export function recoverFromPlaybackFailure(state: PlaybackState): {
  action: RecoveryAction;
  nextState: PlaybackState;
} {
  const failedId = state.playback.lastFailedChunkId;
  if (!failedId) {
    return { action: { kind: 'no_action' }, nextState: state };
  }

  const chunk = state.chunks.find((c) => c.id === failedId);
  if (!chunk) {
    return { action: { kind: 'no_action' }, nextState: state };
  }

  // Too many failures → degrade
  if (state.playback.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
    return {
      action: {
        kind: 'degrade_to_text',
        reason: `${state.playback.consecutiveFailures} consecutive TTS failures`,
      },
      nextState: {
        ...state,
        history: pushPlaybackEvent(state.history, 'playback_recovered', {
          chunkId: failedId,
          text: `Degraded to text after ${state.playback.consecutiveFailures} failures`,
        }),
      },
    };
  }

  // Under threshold → retry same chunk
  return {
    action: { kind: 'retry_chunk', chunkId: failedId, chunk },
    nextState: {
      ...state,
      playback: { ...state.playback, lastFailedChunkId: null },
      history: pushPlaybackEvent(state.history, 'playback_recovered', {
        chunkId: failedId,
        text: `Retrying chunk after failure (attempt ${state.playback.consecutiveFailures + 1})`,
      }),
    },
  };
}

// ── Queries ────────────────────────────────────────────────────────

export function isPlaybackDegraded(state: PlaybackState): boolean {
  return state.playback.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES;
}

export function hasInterruptedChunk(state: PlaybackState): boolean {
  return state.playback.interruptedChunkId !== null;
}
