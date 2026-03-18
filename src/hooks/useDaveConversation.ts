// Dave conversation memory — multi-turn context for voice commands
import { useState, useCallback, useRef } from 'react';

export interface DaveMessage {
  role: 'user' | 'dave';
  content: string;
  action?: string;
  timestamp: number;
}

const MAX_HISTORY = 10;
const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes of inactivity resets session

export function useDaveConversation() {
  const [history, setHistory] = useState<DaveMessage[]>([]);
  const [sessionId, setSessionId] = useState(() => crypto.randomUUID());
  const lastActivityRef = useRef(Date.now());

  const checkSession = useCallback(() => {
    const now = Date.now();
    if (now - lastActivityRef.current > SESSION_TIMEOUT_MS) {
      // Session expired — reset
      setHistory([]);
      setSessionId(crypto.randomUUID());
    }
    lastActivityRef.current = now;
  }, []);

  const addUserMessage = useCallback((content: string) => {
    checkSession();
    setHistory(prev => {
      const next = [...prev, { role: 'user' as const, content, timestamp: Date.now() }];
      return next.slice(-MAX_HISTORY);
    });
  }, [checkSession]);

  const addDaveResponse = useCallback((content: string, action?: string) => {
    checkSession();
    setHistory(prev => {
      const next = [...prev, { role: 'dave' as const, content, action, timestamp: Date.now() }];
      return next.slice(-MAX_HISTORY);
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
  }, []);

  return {
    history,
    sessionId,
    addUserMessage,
    addDaveResponse,
    getConversationContext,
    clearHistory,
    messageCount: history.length,
  };
}
