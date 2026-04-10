/**
 * Dojo Conversation Engine v2
 *
 * Pure, deterministic orchestration layer between scoring functions and UI/voice.
 * - Converts DojoScoreResult into ordered, speakable sub-chunks
 * - Manages versioned session state with typed user-input handling
 * - Prepares for audio-first delivery without coupling to any TTS provider
 *
 * All IDs are deterministic: `${sessionId}:${resultVersion}:${role}:${subIndex}`
 * All functions are pure (state-in → state-out). No side effects.
 */

import type { DojoScoreResult } from './types';

// ── Constants ──────────────────────────────────────────────────────

/** Approximate character count per speakable sub-chunk (~12-15 seconds of speech). */
const SUB_CHUNK_TARGET_LENGTH = 280;

// ── Chunk Types ────────────────────────────────────────────────────

export type ChunkRole = 'feedback' | 'improvedVersion' | 'worldClassResponse' | 'practiceCue';

export interface SpeechChunk {
  /** Deterministic: `${sessionId}:${resultVersion}:${role}:${subIndex}` */
  id: string;
  role: ChunkRole;
  label: string;
  text: string;
  /** Global delivery index across all chunks */
  index: number;
  /** Sub-index within the parent role (0 if not split) */
  subIndex: number;
  /** Total sub-chunks for this role */
  subTotal: number;
}

// ── User Input Types ───────────────────────────────────────────────

export type UserInputType =
  | 'retry_response'
  | 'followup_question'
  | 'interruption'
  | 'replay_request';

// ── Session Phases ─────────────────────────────────────────────────

export type SessionPhase =
  | 'awaiting_response'
  | 'scoring'
  | 'delivering'
  | 'awaiting_followup'
  | 'awaiting_retry'
  | 'awaiting_confirmation'
  | 'completed'
  | 'cancelled';

// ── History ────────────────────────────────────────────────────────

export type HistoryEventType =
  | 'delivered'
  | 'replayed'
  | 'skipped'
  | 'interrupted'
  | 'user_input'
  | 'scoring_started'
  | 'scoring_completed';

export interface HistoryEntry {
  turn: number;
  role: 'user' | 'coach' | 'system';
  eventType: HistoryEventType;
  chunkId?: string;
  chunkRole?: ChunkRole;
  inputType?: UserInputType;
  text: string;
  timestamp: number;
}

// ── Session State ──────────────────────────────────────────────────

export interface ConversationState {
  sessionId: string;
  phase: SessionPhase;
  resultVersion: number;
  retryCount: number;
  activeFocusPattern: string | null;
  chunks: SpeechChunk[];
  currentChunkIndex: number;
  lastDeliveredChunkId: string | null;
  history: HistoryEntry[];
}

// ── Chunk Building ─────────────────────────────────────────────────

const CHUNK_ORDER: { role: ChunkRole; label: string; field: keyof DojoScoreResult }[] = [
  { role: 'feedback', label: 'Coaching Feedback', field: 'feedback' },
  { role: 'improvedVersion', label: 'Stronger Answer', field: 'improvedVersion' },
  { role: 'worldClassResponse', label: 'World-Class Standard', field: 'worldClassResponse' },
  { role: 'practiceCue', label: 'Practice Cue', field: 'practiceCue' },
];

/**
 * Split a long text into sub-chunks at sentence boundaries,
 * targeting SUB_CHUNK_TARGET_LENGTH characters each.
 */
function splitIntoSubChunks(text: string): string[] {
  if (text.length <= SUB_CHUNK_TARGET_LENGTH) return [text];

  const sentences = text.match(/[^.!?]+[.!?]+\s*/g);
  if (!sentences || sentences.length <= 1) return [text];

  const subs: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if (current.length + sentence.length > SUB_CHUNK_TARGET_LENGTH && current.length > 0) {
      subs.push(current.trim());
      current = sentence;
    } else {
      current += sentence;
    }
  }
  if (current.trim()) subs.push(current.trim());

  return subs;
}

function buildChunks(
  sessionId: string,
  resultVersion: number,
  result: DojoScoreResult
): SpeechChunk[] {
  const chunks: SpeechChunk[] = [];
  let globalIndex = 0;

  for (const spec of CHUNK_ORDER) {
    const fullText = result[spec.field] as string;
    if (!fullText) continue;

    const subs = splitIntoSubChunks(fullText);
    for (let si = 0; si < subs.length; si++) {
      chunks.push({
        id: `${sessionId}:${resultVersion}:${spec.role}:${si}`,
        role: spec.role,
        label: subs.length > 1 ? `${spec.label} (${si + 1}/${subs.length})` : spec.label,
        text: subs[si],
        index: globalIndex++,
        subIndex: si,
        subTotal: subs.length,
      });
    }
  }

  return chunks;
}

// ── History helpers ────────────────────────────────────────────────

function pushHistory(
  history: HistoryEntry[],
  entry: Omit<HistoryEntry, 'turn' | 'timestamp'>
): HistoryEntry[] {
  return [
    ...history,
    { ...entry, turn: history.length, timestamp: Date.now() },
  ];
}

// ── Engine: Core ───────────────────────────────────────────────────

/** Create a fresh session. */
export function createSession(sessionId: string): ConversationState {
  return {
    sessionId,
    phase: 'awaiting_response',
    resultVersion: 0,
    retryCount: 0,
    activeFocusPattern: null,
    chunks: [],
    currentChunkIndex: 0,
    lastDeliveredChunkId: null,
    history: [],
  };
}

/** Load a scoring result, versioning it and producing ordered sub-chunks. */
export function loadResult(
  state: ConversationState,
  result: DojoScoreResult
): ConversationState {
  const nextVersion = state.resultVersion + 1;
  const chunks = buildChunks(state.sessionId, nextVersion, result);

  return {
    ...state,
    resultVersion: nextVersion,
    phase: chunks.length > 0 ? 'delivering' : 'completed',
    activeFocusPattern: result.focusPattern || null,
    chunks,
    currentChunkIndex: 0,
    lastDeliveredChunkId: null,
    history: pushHistory(state.history, {
      role: 'system',
      eventType: 'scoring_completed',
      text: `Score result v${nextVersion} loaded (${chunks.length} chunks, score=${result.score})`,
    }),
  };
}

// ── Engine: Delivery ───────────────────────────────────────────────

/** Get the next chunk to deliver. Returns null when delivery is complete. */
export function getNextMessage(state: ConversationState): {
  chunk: SpeechChunk | null;
  nextState: ConversationState;
} {
  if (state.phase !== 'delivering' || state.currentChunkIndex >= state.chunks.length) {
    const nextPhase: SessionPhase =
      state.phase === 'delivering' ? 'awaiting_retry' : state.phase;
    return { chunk: null, nextState: { ...state, phase: nextPhase } };
  }

  const chunk = state.chunks[state.currentChunkIndex];
  const isLast = state.currentChunkIndex + 1 >= state.chunks.length;

  return {
    chunk,
    nextState: {
      ...state,
      currentChunkIndex: state.currentChunkIndex + 1,
      lastDeliveredChunkId: chunk.id,
      phase: isLast ? 'awaiting_retry' : 'delivering',
      history: pushHistory(state.history, {
        role: 'coach',
        eventType: 'delivered',
        chunkId: chunk.id,
        chunkRole: chunk.role,
        text: chunk.text,
      }),
    },
  };
}

/** Deliver all remaining chunks at once (text-only fast path). */
export function deliverAll(state: ConversationState): {
  chunks: SpeechChunk[];
  nextState: ConversationState;
} {
  const delivered: SpeechChunk[] = [];
  let current = state;

  while (current.phase === 'delivering') {
    const { chunk, nextState } = getNextMessage(current);
    if (!chunk) break;
    delivered.push(chunk);
    current = nextState;
  }

  return { chunks: delivered, nextState: current };
}

// ── Engine: User Input ─────────────────────────────────────────────

/** Handle typed user input. Only retry_response increments retryCount. */
export function handleUserInput(
  input: string,
  inputType: UserInputType,
  state: ConversationState
): ConversationState {
  // Replay request is handled separately
  if (inputType === 'replay_request') {
    return replayLastMessage(state).nextState;
  }

  // Interruption during delivery
  if (inputType === 'interruption' && state.phase === 'delivering') {
    return {
      ...state,
      phase: 'awaiting_followup',
      history: pushHistory(state.history, {
        role: 'user',
        eventType: 'user_input',
        inputType: 'interruption',
        text: input,
      }),
    };
  }

  const isRetry = inputType === 'retry_response';

  return {
    ...state,
    phase: 'scoring',
    retryCount: state.retryCount + (isRetry ? 1 : 0),
    history: pushHistory(state.history, {
      role: 'user',
      eventType: 'user_input',
      inputType,
      text: input,
    }),
  };
}

/** Notify engine that scoring has started (for history tracking). */
export function markScoringStarted(state: ConversationState): ConversationState {
  return {
    ...state,
    phase: 'scoring',
    history: pushHistory(state.history, {
      role: 'system',
      eventType: 'scoring_started',
      text: 'Scoring initiated',
    }),
  };
}

// ── Engine: Interruption ───────────────────────────────────────────

/** Cancel current delivery. */
export function cancelDelivery(state: ConversationState): ConversationState {
  if (state.phase !== 'delivering') return state;
  return {
    ...state,
    phase: 'awaiting_followup',
    history: pushHistory(state.history, {
      role: 'system',
      eventType: 'interrupted',
      text: `Delivery interrupted at chunk ${state.currentChunkIndex}/${state.chunks.length}`,
    }),
  };
}

/** Skip the current chunk and advance to the next. */
export function skipCurrentMessage(state: ConversationState): ConversationState {
  if (state.phase !== 'delivering' || state.currentChunkIndex >= state.chunks.length) {
    return state;
  }

  const skipped = state.chunks[state.currentChunkIndex];
  const isLast = state.currentChunkIndex + 1 >= state.chunks.length;

  return {
    ...state,
    currentChunkIndex: state.currentChunkIndex + 1,
    phase: isLast ? 'awaiting_retry' : 'delivering',
    history: pushHistory(state.history, {
      role: 'system',
      eventType: 'skipped',
      chunkId: skipped.id,
      chunkRole: skipped.role,
      text: `Skipped: ${skipped.label}`,
    }),
  };
}

// ── Engine: Recovery ───────────────────────────────────────────────

/** Replay the last delivered chunk without changing delivery position. */
export function replayLastMessage(state: ConversationState): {
  chunk: SpeechChunk | null;
  nextState: ConversationState;
} {
  if (!state.lastDeliveredChunkId) return { chunk: null, nextState: state };

  const lastChunk = state.chunks.find((c) => c.id === state.lastDeliveredChunkId) ?? null;
  if (!lastChunk) return { chunk: null, nextState: state };

  return {
    chunk: lastChunk,
    nextState: {
      ...state,
      history: pushHistory(state.history, {
        role: 'system',
        eventType: 'replayed',
        chunkId: lastChunk.id,
        chunkRole: lastChunk.role,
        text: lastChunk.text,
      }),
    },
  };
}

/** Resume from persisted/rehydrated state. */
export function resumeFromState(state: ConversationState): ConversationState {
  if (state.phase === 'delivering' && state.currentChunkIndex >= state.chunks.length) {
    return { ...state, phase: 'awaiting_retry' };
  }
  return state;
}

/** Mark session completed. */
export function completeSession(state: ConversationState): ConversationState {
  return { ...state, phase: 'completed' };
}

/** Transition from awaiting_followup to awaiting_retry (e.g. after answering a question). */
export function transitionToRetry(state: ConversationState): ConversationState {
  if (state.phase !== 'awaiting_followup' && state.phase !== 'awaiting_confirmation') {
    return state;
  }
  return { ...state, phase: 'awaiting_retry' };
}

// ── Queries ────────────────────────────────────────────────────────

export function isDelivering(state: ConversationState): boolean {
  return state.phase === 'delivering';
}

export function isAwaitingRetry(state: ConversationState): boolean {
  return state.phase === 'awaiting_retry';
}

export function getRemainingChunks(state: ConversationState): number {
  return Math.max(0, state.chunks.length - state.currentChunkIndex);
}

export function getDeliveryProgress(state: ConversationState): {
  delivered: number;
  total: number;
  percent: number;
} {
  const total = state.chunks.length;
  const delivered = Math.min(state.currentChunkIndex, total);
  return { delivered, total, percent: total > 0 ? Math.round((delivered / total) * 100) : 0 };
}
