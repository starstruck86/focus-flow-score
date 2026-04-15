import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';

export function useStrategyThreads() {
  const { user } = useAuth();
  const [threads, setThreads] = useState<StrategyThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchThreads = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const { data, error } = await supabase
      .from('strategy_threads')
      .select('*')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false });
    if (!error && data) {
      setThreads(data as StrategyThread[]);
      if (!activeThreadId && data.length > 0) {
        setActiveThreadId(data[0].id);
      }
    }
    setIsLoading(false);
  }, [user, activeThreadId]);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  const createThread = useCallback(async (title?: string, lane?: string, threadType?: string) => {
    if (!user) return;
    const { data, error } = await supabase
      .from('strategy_threads')
      .insert({
        user_id: user.id,
        title: title || 'Untitled Thread',
        lane: lane || 'research',
        thread_type: threadType || 'freeform',
      })
      .select()
      .single();
    if (!error && data) {
      const thread = data as StrategyThread;
      setThreads(prev => [thread, ...prev]);
      setActiveThreadId(thread.id);
    }
  }, [user]);

  const updateThread = useCallback(async (id: string, updates: Partial<StrategyThread>) => {
    const { error } = await supabase
      .from('strategy_threads')
      .update(updates)
      .eq('id', id);
    if (!error) {
      setThreads(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }
  }, []);

  const activeThread = threads.find(t => t.id === activeThreadId) ?? null;

  return {
    threads,
    activeThread,
    activeThreadId,
    setActiveThreadId,
    createThread,
    updateThread,
    isLoading,
    refetch: fetchThreads,
  };
}
