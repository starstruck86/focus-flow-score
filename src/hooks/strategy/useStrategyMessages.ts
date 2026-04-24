import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyMessage } from '@/types/strategy';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-chat`;

/**
 * Map a raw send/streaming error into a friendly user-facing message.
 * Pure function — exported for unit tests. Never returns the literal
 * "Failed to fetch" or "TypeError" strings.
 */
export function mapSendErrorToFriendlyMessage(e: unknown): string {
  const err = e as { message?: unknown; name?: unknown } | null | undefined;
  const raw = String(err?.message ?? '');
  const name = String(err?.name ?? '');

  const isNetworkError =
    /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(raw)
    || name === 'TypeError';
  if (isNetworkError) {
    return "Connection hiccup — Strategy couldn't reach the AI provider. Check your network and try again.";
  }

  // Provider/server-side failures: our throw site formats these as "Error 5xx"
  // (see resp.ok branch), but also catch raw "5xx" / "Internal Server Error".
  const isProviderError =
    /\berror\s*5\d{2}\b/i.test(raw)
    || /\b5\d{2}\b/.test(raw)
    || /internal server error|bad gateway|service unavailable|gateway timeout/i.test(raw);
  if (isProviderError) {
    return 'The AI provider is having a moment. Please retry — usually clears in a few seconds.';
  }

  if (raw.trim()) return raw;
  return 'Something went wrong sending your message. Please try again.';
}

interface UseStrategyMessagesOpts {
  /** Called after an assistant streamed response completes. Receives the final text. */
  onAssistantComplete?: (assistantText: string) => void;
}

export function useStrategyMessages(threadId: string | null, opts?: UseStrategyMessagesOpts) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<StrategyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);

  const fetchMessages = useCallback(async () => {
    if (!threadId || !user) { setMessages([]); return; }
    setIsLoading(true);
    const { data, error } = await supabase
      .from('strategy_messages')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });
    if (!error && data) setMessages(data as StrategyMessage[]);
    setIsLoading(false);
  }, [threadId, user]);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const sendMessage = useCallback(async (
    content: string,
    options?: { depth?: string; pickedResourceIds?: string[] }
  ) => {
    if (!threadId || !user || !content.trim() || isSending) return;
    setIsSending(true);

    const optimisticId = `opt-${Date.now()}`;
    const userMsg: StrategyMessage = {
      id: optimisticId, thread_id: threadId, user_id: user.id,
      role: 'user', message_type: 'chat',
      content_json: { text: content }, citations_json: null,
      created_at: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMsg]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          action: 'chat',
          threadId,
          content,
          depth: options?.depth,
          // Sidecar: resource IDs the user explicitly picked from /library this turn.
          // Backend resolves these by ID before any fuzzy title matching so grounding
          // never depends on title-string coincidence.
          pickedResourceIds: Array.isArray(options?.pickedResourceIds) && options.pickedResourceIds.length > 0
            ? options.pickedResourceIds
            : undefined,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      if (!resp.body) throw new Error('No response body');

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = `ast-${Date.now()}`;
      let textBuffer = '';

      const updateAssistant = (text: string) => {
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.id === assistantId) {
            return prev.map((m, i) => i === prev.length - 1
              ? { ...m, content_json: { text } } : m);
          }
          return [...prev, {
            id: assistantId, thread_id: threadId, user_id: user.id,
            role: 'assistant', message_type: 'chat',
            content_json: { text }, citations_json: null,
            created_at: new Date().toISOString(),
          }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { assistantText += delta; updateAssistant(assistantText); }
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Flush remaining buffer
      if (textBuffer.trim()) {
        for (let raw of textBuffer.split('\n')) {
          if (!raw) continue;
          if (raw.endsWith('\r')) raw = raw.slice(0, -1);
          if (!raw.startsWith('data: ')) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) { assistantText += delta; updateAssistant(assistantText); }
          } catch { /* partial leftover */ }
        }
      }

      setTimeout(() => fetchMessages(), 500);

      // Phase 3: fire detector once assistant message is fully streamed.
      // Non-blocking — failures here must never break chat.
      if (assistantText.trim().length > 200 && opts?.onAssistantComplete) {
        try { opts.onAssistantComplete(assistantText); } catch (e) { console.warn('[chat] detector hook failed', e); }
      }
    } catch (e: any) {
      // Translate raw network/provider errors into something a user can act on.
      // "Failed to fetch" / "Load failed" / TypeError mean the request never
      // reached our backend (offline, blocked, transient). Anything else falls
      // through to the original message.
      const raw = String(e?.message || '');
      const isNetworkError = /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(raw)
        || e?.name === 'TypeError';
      const friendly = isNetworkError
        ? 'Connection hiccup — Strategy couldn\'t reach the AI provider. Check your network and try again.'
        : raw.includes('Error 5')
          ? 'The AI provider is having a moment. Please retry — usually clears in a few seconds.'
          : raw || 'Something went wrong sending your message. Please try again.';
      toast.error(friendly);
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } finally {
      setIsSending(false);
    }
  }, [threadId, user, fetchMessages, isSending, opts]);

  const runWorkflow = useCallback(async (
    workflowType: string,
    options?: { content?: string }
  ) => {
    if (!threadId || !user || isSending) return null;
    setIsSending(true);

    setMessages(prev => [...prev, {
      id: `wf-${Date.now()}`, thread_id: threadId, user_id: user.id,
      role: 'system', message_type: 'workflow_update',
      content_json: { text: `Running ${workflowType.replace(/_/g, ' ')}…` },
      citations_json: null, created_at: new Date().toISOString(),
    }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: 'workflow', threadId, workflowType, content: options?.content }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      const result = await resp.json();
      await fetchMessages();
      return result;
    } catch (e: any) {
      toast.error(e.message || 'Workflow failed');
      return null;
    } finally {
      setIsSending(false);
    }
  }, [threadId, user, fetchMessages, isSending]);

  return { messages, isLoading, isSending, sendMessage, runWorkflow, refetch: fetchMessages };
}
