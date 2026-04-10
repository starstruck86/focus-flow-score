/**
 * Dojo Conversation Engine
 * Converts DojoScoreResult into ordered speech chunks and manages
 * turn-by-turn session state for text-only conversational delivery.
 */

import type { DojoScoreResult } from './types';

// ── Chunk Types ────────────────────────────────────────────────────

export type ChunkRole = 'feedback' | 'improvedVersion' | 'worldClassResponse' | 'practiceCue';

export interface SpeechChunk {
  id: string;
  role: ChunkRole;
  label: string;
  text: string;
  index: number;
}

// ── Session State ──────────────────────────────────────────────────

export type SessionPhase =
  | 'awaiting_response'
  | 'scoring'
  | 'delivering'
  | 'waiting_for_retry'
  | 'completed'
  | 'cancelled';

export interface ConversationState {
  sessionId: string;
  phase: SessionPhase;
  retryCount: number;
  activeFocusPattern: string | null;
  chunks: SpeechChunk[];
  currentChunkIndex: number;
  lastDeliveredChunkId: string | null;
  history: HistoryEntry[];
}

export interface HistoryEntry {
  turn: number;
  role: 'user' | 'coach';
  chunkRole?: ChunkRole;
  text: string;
  timestamp: number;
}

// ── Chunk ordering ─────────────────────────────────────────────────

const CHUNK_ORDER: { role: ChunkRole; label: string; field: keyof DojoScoreResult }[] = [
  { role: 'feedback', label: 'Coaching Feedback', field: 'feedback' },
  { role: 'improvedVersion', label: 'Stronger Answer', field: 'improvedVersion' },
  { role: 'worldClassResponse', label: 'World-Class Standard', field: 'worldClassResponse' },
  { role: 'practiceCue', label: 'Practice Cue', field: 'practiceCue' },
];

function buildChunks(result: DojoScoreResult): SpeechChunk[] {
  return CHUNK_ORDER
    .map((spec, i) => {
      const text = result[spec.field] as string;
      if (!text) return null;
      return {
        id: `${spec.role}-${Date.now()}-${i}`,
        role: spec.role,
        label: spec.label,
        text,
        index: i,
      };
    })
    .filter((c): c is SpeechChunk => c !== null);
}

// ── Engine ─────────────────────────────────────────────────────────

export function createSession(sessionId: string): ConversationState {
  return {
    sessionId,
    phase: 'awaiting_response',
    retryCount: 0,
    activeFocusPattern: null,
    chunks: [],
    currentChunkIndex: 0,
    lastDeliveredChunkId: null,
    history: [],
  };
}

/** Load scoring result into the engine, producing ordered chunks. */
export function loadResult(
  state: ConversationState,
  result: DojoScoreResult
): ConversationState {
  const chunks = buildChunks(result);
  return {
    ...state,
    phase: chunks.length > 0 ? 'delivering' : 'completed',
    activeFocusPattern: result.focusPattern || null,
    chunks,
    currentChunkIndex: 0,
    lastDeliveredChunkId: null,
  };
}

/** Get the next message to deliver. Returns null when all chunks are delivered. */
export function getNextMessage(state: ConversationState): {
  chunk: SpeechChunk | null;
  nextState: ConversationState;
} {
  if (state.phase !== 'delivering' || state.currentChunkIndex >= state.chunks.length) {
    const nextPhase: SessionPhase =
      state.phase === 'delivering' ? 'waiting_for_retry' : state.phase;
    return { chunk: null, nextState: { ...state, phase: nextPhase } };
  }

  const chunk = state.chunks[state.currentChunkIndex];
  const entry: HistoryEntry = {
    turn: state.history.length,
    role: 'coach',
    chunkRole: chunk.role,
    text: chunk.text,
    timestamp: Date.now(),
  };

  return {
    chunk,
    nextState: {
      ...state,
      currentChunkIndex: state.currentChunkIndex + 1,
      lastDeliveredChunkId: chunk.id,
      phase:
        state.currentChunkIndex + 1 >= state.chunks.length
          ? 'waiting_for_retry'
          : 'delivering',
      history: [...state.history, entry],
    },
  };
}

/** Record user input (their drill/retry response). */
export function handleUserInput(
  input: string,
  state: ConversationState
): ConversationState {
  const entry: HistoryEntry = {
    turn: state.history.length,
    role: 'user',
    text: input,
    timestamp: Date.now(),
  };
  return {
    ...state,
    phase: 'scoring',
    retryCount: state.retryCount + (state.phase === 'waiting_for_retry' ? 1 : 0),
    history: [...state.history, entry],
  };
}

/** Resume delivery from persisted state (e.g. after page reload). */
export function resumeFromState(state: ConversationState): ConversationState {
  if (state.phase === 'delivering' && state.currentChunkIndex < state.chunks.length) {
    return state; // ready to continue delivering
  }
  if (state.phase === 'delivering') {
    return { ...state, phase: 'waiting_for_retry' };
  }
  return state;
}

// ── Interruption ───────────────────────────────────────────────────

/** Cancel current delivery and move to waiting_for_retry. */
export function cancelDelivery(state: ConversationState): ConversationState {
  if (state.phase !== 'delivering') return state;
  return { ...state, phase: 'waiting_for_retry' };
}

// ── Recovery ───────────────────────────────────────────────────────

/** Replay the last delivered chunk by rewinding one step. */
export function replayLastMessage(state: ConversationState): {
  chunk: SpeechChunk | null;
  nextState: ConversationState;
} {
  if (!state.lastDeliveredChunkId) return { chunk: null, nextState: state };

  const lastChunk = state.chunks.find((c) => c.id === state.lastDeliveredChunkId) ?? null;
  return { chunk: lastChunk, nextState: state }; // state unchanged — replay only
}

/** Mark session completed. */
export function completeSession(state: ConversationState): ConversationState {
  return { ...state, phase: 'completed' };
}

// ── Helpers ────────────────────────────────────────────────────────

export function isDelivering(state: ConversationState): boolean {
  return state.phase === 'delivering';
}

export function isAwaitingRetry(state: ConversationState): boolean {
  return state.phase === 'waiting_for_retry';
}

export function getRemainingChunks(state: ConversationState): number {
  return Math.max(0, state.chunks.length - state.currentChunkIndex);
}
