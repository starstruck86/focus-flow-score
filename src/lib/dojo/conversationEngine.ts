/**
 * Dojo Conversation Engine v3
 *
 * Pure, deterministic orchestration layer between scoring functions and UI/voice.
 * - Converts DojoScoreResult into ordered, speakable sub-chunks
 * - Manages versioned session state with typed user-input handling
 * - Prepares for audio-first delivery without coupling to any TTS provider
 *
 * All IDs are deterministic: `${sessionId}:v${resultVersion}:${globalIndex}`
 * All functions are pure (state-in → state-out). No side effects.
 */

import type { DojoScoreResult } from './types';

// ── Constants ──────────────────────────────────────────────────────

/** Approximate character count per speakable sub-chunk (~12-15s of speech). */
const SUB_CHUNK_TARGET_LENGTH = 280;

// ── Chunk Types ────────────────────────────────────────────────────

export type ChunkRole = 'feedback' | 'improvedVersion' | 'worldClassResponse' | 'practiceCue';

export interface SpeechChunk {
  /** Deterministic, collision-free: `${sessionId}:v${resultVersion}:${globalIndex}` */
  id: string;
  role: ChunkRole;
  label: string;
  text: string;
  /** Global delivery index across all chunks (unique per result load) */
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

export type PostDeliveryPhase =
  | 'awaiting_retry'
  | 'awaiting_followup'
  | 'awaiting_confirmation';

export type SessionPhase =
  | 'awaiting_response'
  | 'scoring'
  | 'delivering'
  | PostDeliveryPhase
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
  | 'scoring_completed'
  | 'delivery_resumed';

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
  postDeliveryPhase: PostDeliveryPhase;
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
 * Split long text into sub-chunks at sentence boundaries,
 * targeting SUB_CHUNK_TARGET_LENGTH characters each.
 * Preserves clean spacing between sentences.
 */
function splitIntoSubChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= SUB_CHUNK_TARGET_LENGTH) return [trimmed];

  // Split on sentence-ending punctuation followed by whitespace
  const sentences = trimmed.match(/[^.!?]*[.!?]+(?:\s+|$)/g);
  if (!sentences || sentences.length <= 1) return [trimmed];

  const subs: string[] = [];
  let current = '';

  for (const raw of sentences) {
    const sentence = raw.trimEnd();
    if (current.length > 0 && current.length + 1 + sentence.length > SUB_CHUNK_TARGET_LENGTH) {
      subs.push(current.trim());
      current = sentence;
    } else {
      current = current.length > 0 ? `${current} ${sentence}` : sentence;
    }
  }
  const final = current.trim();
  if (final) subs.push(final);

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
        id: `${sessionId}:v${resultVersion}:${globalIndex}`,
        role: spec.role,
        label: subs.length > 1 ? `${spec.label} (${si + 1}/${subs.length})` : spec.label,
        text: subs[si],
        index: globalIndex,
        subIndex: si,
        subTotal: subs.length,
      });
      globalIndex++;
    }
  }

  return chunks;
}

// ── History helpers ────────────────────────────────────────────────

function pushHistory(
  history: HistoryEntry[],
  entry: Omit<HistoryEntry, 'turn' | 'timestamp'>
): HistoryEntry[] {
  return [...history, { ...entry, turn: history.length, timestamp: Date.now() }];
}

function pushHistoryMulti(
  history: HistoryEntry[],
  entries: Omit<HistoryEntry, 'turn' | 'timestamp'>[]
): HistoryEntry[] {
  let h = history;
  for (const e of entries) {
    h = pushHistory(h, e);
  }
  return h;
}

// ── Engine: Core ───────────────────────────────────────────────────

/** Create a fresh session. */
export function createSession(
  sessionId: string,
  options?: { postDeliveryPhase?: PostDeliveryPhase }
): ConversationState {
  return {
    sessionId,
    phase: 'awaiting_response',
    resultVersion: 0,
    retryCount: 0,
    activeFocusPattern: null,
    chunks: [],
    currentChunkIndex: 0,
    lastDeliveredChunkId: null,
    postDeliveryPhase: options?.postDeliveryPhase ?? 'awaiting_retry',
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

/** Set the phase the engine transitions to after all chunks are delivered. */
export function setPostDeliveryPhase(
  state: ConversationState,
  phase: PostDeliveryPhase
): ConversationState {
  return { ...state, postDeliveryPhase: phase };
}

// ── Engine: Delivery ───────────────────────────────────────────────

/** Get the next chunk to deliver. Returns null when delivery is complete. */
export function getNextMessage(state: ConversationState): {
  chunk: SpeechChunk | null;
  nextState: ConversationState;
} {
  if (state.phase !== 'delivering' || state.currentChunkIndex >= state.chunks.length) {
    const nextPhase: SessionPhase =
      state.phase === 'delivering' ? state.postDeliveryPhase : state.phase;
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
      phase: isLast ? state.postDeliveryPhase : 'delivering',
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
  const userEvent: Omit<HistoryEntry, 'turn' | 'timestamp'> = {
    role: 'user',
    eventType: 'user_input',
    inputType,
    text: input,
  };

  // Replay: log user action, then perform replay
  if (inputType === 'replay_request') {
    const lastChunk = state.lastDeliveredChunkId
      ? state.chunks.find((c) => c.id === state.lastDeliveredChunkId) ?? null
      : null;

    const events: Omit<HistoryEntry, 'turn' | 'timestamp'>[] = [userEvent];
    if (lastChunk) {
      events.push({
        role: 'system',
        eventType: 'replayed',
        chunkId: lastChunk.id,
        chunkRole: lastChunk.role,
        text: lastChunk.text,
      });
    }

    return { ...state, history: pushHistoryMulti(state.history, events) };
  }

  // Interruption during delivery
  if (inputType === 'interruption' && state.phase === 'delivering') {
    return {
      ...state,
      phase: 'awaiting_followup',
      history: pushHistory(state.history, userEvent),
    };
  }

  const isRetry = inputType === 'retry_response';

  return {
    ...state,
    phase: 'scoring',
    retryCount: state.retryCount + (isRetry ? 1 : 0),
    history: pushHistory(state.history, userEvent),
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
    phase: isLast ? state.postDeliveryPhase : 'delivering',
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

/**
 * Resume delivery from current position after interruption or follow-up.
 * Only transitions if there are remaining chunks to deliver.
 */
export function resumeDelivery(state: ConversationState): ConversationState {
  if (state.currentChunkIndex >= state.chunks.length) return state;
  if (state.phase === 'delivering') return state; // already delivering

  return {
    ...state,
    phase: 'delivering',
    history: pushHistory(state.history, {
      role: 'system',
      eventType: 'delivery_resumed',
      text: `Resumed at chunk ${state.currentChunkIndex + 1}/${state.chunks.length}`,
    }),
  };
}

/** Resume from persisted/rehydrated state. */
export function resumeFromState(state: ConversationState): ConversationState {
  if (state.phase === 'delivering' && state.currentChunkIndex >= state.chunks.length) {
    return { ...state, phase: state.postDeliveryPhase };
  }
  return state;
}

/** Mark session completed. */
export function completeSession(state: ConversationState): ConversationState {
  return { ...state, phase: 'completed' };
}

/** Transition from a waiting phase to awaiting_retry. */
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
