import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyMessage } from '@/types/strategy';
import { toast } from 'sonner';

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-chat`;

export function useStrategyMessages(threadId: string | null) {
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
    options?: {
      linkedContext?: any;
      uploadedResources?: any[];
      depth?: string;
    }
  ) => {
    if (!threadId || !user || !content.trim()) return;
    setIsSending(true);

    // Optimistic user message
    const optimisticId = `opt-${Date.now()}`;
    const userMsg: StrategyMessage = {
      id: optimisticId,
      thread_id: threadId,
      user_id: user.id,
      role: 'user',
      message_type: 'chat',
      content_json: { text: content },
      citations_json: null,
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
          linkedContext: options?.linkedContext,
          uploadedResources: options?.uploadedResources,
          depth: options?.depth,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(err.error || `Error ${resp.status}`);
      }

      // Stream response
      if (!resp.body) throw new Error('No response body');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      const assistantId = `ast-${Date.now()}`;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
          try {
            const parsed = JSON.parse(line.slice(6));
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantText += delta;
              setMessages(prev => {
                const last = prev[prev.length - 1];
                if (last?.id === assistantId) {
                  return prev.map((m, i) => i === prev.length - 1
                    ? { ...m, content_json: { text: assistantText } }
                    : m
                  );
                }
                return [...prev, {
                  id: assistantId,
                  thread_id: threadId,
                  user_id: user.id,
                  role: 'assistant',
                  message_type: 'chat',
                  content_json: { text: assistantText },
                  citations_json: null,
                  created_at: new Date().toISOString(),
                }];
              });
            }
          } catch {}
        }
      }

      // Refetch to get real IDs
      setTimeout(() => fetchMessages(), 500);
    } catch (e: any) {
      toast.error(e.message || 'Failed to send message');
      // Remove optimistic message on error
      setMessages(prev => prev.filter(m => m.id !== optimisticId));
    } finally {
      setIsSending(false);
    }
  }, [threadId, user, fetchMessages]);

  const runWorkflow = useCallback(async (
    workflowType: string,
    options?: {
      content?: string;
      linkedContext?: any;
      uploadedResources?: any[];
    }
  ) => {
    if (!threadId || !user) return null;
    setIsSending(true);

    // Optimistic workflow message
    setMessages(prev => [...prev, {
      id: `wf-${Date.now()}`,
      thread_id: threadId,
      user_id: user.id,
      role: 'system',
      message_type: 'workflow_update',
      content_json: { text: `Running ${workflowType}…` },
      citations_json: null,
      created_at: new Date().toISOString(),
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
        body: JSON.stringify({
          action: 'workflow',
          threadId,
          workflowType,
          content: options?.content,
          linkedContext: options?.linkedContext,
          uploadedResources: options?.uploadedResources,
        }),
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
  }, [threadId, user, fetchMessages]);

  return { messages, isLoading, isSending, sendMessage, runWorkflow, refetch: fetchMessages };
}
