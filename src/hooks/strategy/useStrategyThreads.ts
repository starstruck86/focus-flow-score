import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';
import type { CreateThreadOpts } from '@/components/strategy/CreateThreadDialog';

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

  /** Legacy simple creation */
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

  /** Object-native thread creation */
  const createThreadWithOpts = useCallback(async (opts: CreateThreadOpts) => {
    if (!user) return;
    const insertData: Record<string, unknown> = {
      user_id: user.id,
      title: opts.title,
      lane: opts.lane,
      thread_type: opts.threadType,
    };
    if (opts.linkedAccountId) insertData.linked_account_id = opts.linkedAccountId;
    if (opts.linkedOpportunityId) insertData.linked_opportunity_id = opts.linkedOpportunityId;
    if (opts.linkedTerritoryId) insertData.linked_territory_id = opts.linkedTerritoryId;

    const { data, error } = await supabase
      .from('strategy_threads')
      .insert(insertData as any)
      .select()
      .single();
    if (!error && data) {
      const thread = data as StrategyThread;
      setThreads(prev => [thread, ...prev]);
      setActiveThreadId(thread.id);
    }
  }, [user]);

  const updateThread = useCallback(async (id: string, updates: Partial<StrategyThread>) => {
    const dbUpdates: Record<string, unknown> = { ...updates };
    const { error } = await supabase
      .from('strategy_threads')
      .update(dbUpdates as any)
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
    createThreadWithOpts,
    updateThread,
    isLoading,
    refetch: fetchThreads,
  };
}
