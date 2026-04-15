import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyMessage } from '@/types/strategy';

export function useStrategyMessages(threadId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<StrategyMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

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

  const sendMessage = useCallback(async (content: string, role = 'user', messageType = 'chat') => {
    if (!threadId || !user) return;
    const contentJson = { text: content };
    const { data, error } = await supabase
      .from('strategy_messages')
      .insert({
        thread_id: threadId,
        user_id: user.id,
        role,
        message_type: messageType,
        content_json: contentJson,
      })
      .select()
      .single();
    if (!error && data) {
      setMessages(prev => [...prev, data as StrategyMessage]);
    }
    // Update thread updated_at
    await supabase.from('strategy_threads').update({ updated_at: new Date().toISOString() }).eq('id', threadId);
  }, [threadId, user]);

  return { messages, isLoading, sendMessage, refetch: fetchMessages };
}
