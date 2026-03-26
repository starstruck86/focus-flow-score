// Dave conversation memory — multi-turn context for voice commands
// Now with session recovery: persists last interaction state, enables resume after failure
import { useState, useCallback, useRef } from 'react';
import { createLogger } from '@/lib/logger';

const logger = createLogger('DaveConversation');

export interface DaveMessage {
  role: 'user' | 'dave';
  content: string;
  action?: string;
  timestamp: number;
}

export interface DaveInteractionState {
  /** Unique request ID for deduplication */
  requestId: string;
  /** Last user message that triggered the request */
  userMessage: string;
  /** Tool/context payload sent with the request */
  contextPayload: string;
  /** Partial response accumulated so far (for streaming resume) */
  partialResponse: string;
  /** Whether the response completed successfully */
  completed: boolean;
  /** Timestamp of this interaction */
  timestamp: number;
  /** Number of retry attempts so far */
  retryCount: number;
}

const MAX_HISTORY = 10;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity resets session
const STORAGE_KEY = 'dave-last-interaction';
const HISTORY_STORAGE_KEY = 'dave-conversation-history';

function generateRequestId(): string {
  return `dave-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLastInteraction(): DaveInteractionState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw) as DaveInteractionState;
    // Discard stale interactions (> 5 min)
    if (Date.now() - state.timestamp > SESSION_TIMEOUT_MS) return null;
    return state;
  } catch { return null; }
}

function saveLastInteraction(state: DaveInteractionState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function clearLastInteraction() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}

function loadPersistedHistory(): DaveMessage[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const msgs = JSON.parse(raw) as DaveMessage[];
    // Discard if last message is older than session timeout
    if (msgs.length > 0 && Date.now() - msgs[msgs.length - 1].timestamp > SESSION_TIMEOUT_MS) return [];
    return msgs.slice(-MAX_HISTORY);
  } catch { return []; }
}

function persistHistory(history: DaveMessage[]) {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {}
}

export function useDaveConversation() {
  const [history, setHistory] = useState<DaveMessage[]>(() => loadPersistedHistory());
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const lastActivityRef = useRef(Date.now());
  const lastInteractionRef = useRef<DaveInteractionState | null>(loadLastInteraction());
  /** Set of completed request IDs to prevent duplicate responses */
  const completedRequestIds = useRef<Set<string>>(new Set());

  const checkSession = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityRef.current > SESSION_TIMEOUT_MS) {
      setHistory([]);
      setSessionId(crypto.randomUUID());
      lastInteractionRef.current = null;
      clearLastInteraction();
      completedRequestIds.current.clear();
      persistHistory([]);
    }
    lastActivityRef.current = now;
  }, []);

  const addUserMessage = useCallback((content: string) => {
    checkSession();
    setHistory(prev => {
      const next = [...prev, { role: 'user' as const, content, timestamp: Date.now() }];
      const trimmed = next.slice(-MAX_HISTORY);
      persistHistory(trimmed);
      return trimmed;
    });
  }, [checkSession]);

  const addDaveResponse = useCallback((content: string, action?: string) => {
    checkSession();
    setHistory(prev => {
      const next = [...prev, { role: 'dave' as const, content, action, timestamp: Date.now() }];
      const trimmed = next.slice(-MAX_HISTORY);
      persistHistory(trimmed);
      return trimmed;
    });
  }, [checkSession]);

  /** Build context string for the edge function */
  const getConversationContext = useCallback((): string => {
    checkSession();
    if (history.length === 0) return '';
    
    return history.map(m => 
      m.role === 'user' ? `User: ${m.content}` : `Dave: ${m.content}${m.action ? ` [action: ${m.action}]` : ''}`
    ).join('\n');
  }, [history, checkSession]);

  const clearHistory = useCallback(() => {
    setHistory([]);
    setSessionId(crypto.randomUUID());
    lastInteractionRef.current = null;
    clearLastInteraction();
    completedRequestIds.current.clear();
    persistHistory([]);
  }, []);

  // ── Recovery infrastructure ──────────────────────────────────────

  /** Begin tracking a new interaction (call before sending request) */
  const beginInteraction = useCallback((userMessage: string, contextPayload: string): string => {
    checkSession();
    const requestId = generateRequestId();
    const state: DaveInteractionState = {
      requestId,
      userMessage,
      contextPayload,
      partialResponse: '',
      completed: false,
      timestamp: Date.now(),
      retryCount: 0,
    };
    lastInteractionRef.current = state;
    saveLastInteraction(state);
    logger.info('Interaction started', { requestId });
    return requestId;
  }, [checkSession]);

  /** Append partial streamed response content */
  const appendPartialResponse = useCallback((requestId: string, chunk: string) => {
    const current = lastInteractionRef.current;
    if (!current || current.requestId !== requestId) return;
    current.partialResponse += chunk;
    // Persist periodically (every ~500 chars) to avoid excessive writes
    if (current.partialResponse.length % 500 < chunk.length) {
      saveLastInteraction(current);
    }
  }, []);

  /** Mark interaction as successfully completed */
  const completeInteraction = useCallback((requestId: string) => {
    const current = lastInteractionRef.current;
    if (!current || current.requestId !== requestId) return;
    current.completed = true;
    completedRequestIds.current.add(requestId);
    saveLastInteraction(current);
    logger.info('Interaction completed', { requestId });
  }, []);

  /** Mark interaction as failed (preserves state for retry) */
  const failInteraction = useCallback((requestId: string) => {
    const current = lastInteractionRef.current;
    if (!current || current.requestId !== requestId) return;
    current.completed = false;
    saveLastInteraction(current);
    logger.warn('Interaction failed', { requestId, retryCount: current.retryCount });
  }, []);

  /** Check if a request ID was already completed (dedupe guard) */
  const isRequestCompleted = useCallback((requestId: string): boolean => {
    return completedRequestIds.current.has(requestId);
  }, []);

  /** Get the last failed (incomplete) interaction for resume */
  const getRecoverableInteraction = useCallback((): DaveInteractionState | null => {
    checkSession();
    const state = lastInteractionRef.current || loadLastInteraction();
    if (!state) return null;
    // Only return if incomplete and recent
    if (state.completed) return null;
    if (Date.now() - state.timestamp > SESSION_TIMEOUT_MS) {
      clearLastInteraction();
      return null;
    }
    return state;
  }, [checkSession]);

  /** Increment retry count for the current interaction */
  const incrementRetry = useCallback((requestId: string): number => {
    const current = lastInteractionRef.current;
    if (!current || current.requestId !== requestId) return 0;
    current.retryCount++;
    current.timestamp = Date.now(); // refresh timestamp on retry
    saveLastInteraction(current);
    return current.retryCount;
  }, []);

  /** Clear recovery state (after successful resume or explicit dismiss) */
  const dismissRecovery = useCallback(() => {
    lastInteractionRef.current = null;
    clearLastInteraction();
  }, []);

  return {
    history,
    sessionId,
    addUserMessage,
    addDaveResponse,
    getConversationContext,
    clearHistory,
    messageCount: history.length,
    // Recovery API
    beginInteraction,
    appendPartialResponse,
    completeInteraction,
    failInteraction,
    isRequestCompleted,
    getRecoverableInteraction,
    incrementRetry,
    dismissRecovery,
  };
}
