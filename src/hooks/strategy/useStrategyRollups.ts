import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyRollup, MemorySuggestion } from '@/lib/strategy/workflowSchemas';

export function useStrategyRollups(threadId: string | null) {
  const { user } = useAuth();
  const [rollup, setRollup] = useState<StrategyRollup | null>(null);
  const [memorySuggestions, setMemorySuggestions] = useState<MemorySuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchRollup = useCallback(async () => {
    if (!threadId || !user) { setRollup(null); return; }
    
    // Get from strategy_threads.latest_rollup first
    const { data: thread } = await supabase
      .from('strategy_threads')
      .select('latest_rollup')
      .eq('id', threadId)
      .single();
    
    if (thread?.latest_rollup) {
      const r = thread.latest_rollup as any;
      setRollup({
        summary: r.summary || '',
        key_facts: r.key_facts || [],
        hypotheses: r.hypotheses || [],
        risks: r.risks || [],
        open_questions: r.open_questions || [],
        next_steps: r.next_steps || [],
        updated_at: r.updated_at || new Date().toISOString(),
      });
      if (r.memory_suggestions) {
        setMemorySuggestions(r.memory_suggestions);
      }
    }
  }, [threadId, user]);

  useEffect(() => { fetchRollup(); }, [fetchRollup]);

  const triggerRollup = useCallback(async () => {
    if (!threadId || !user) return;
    setIsLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/strategy-chat`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ action: 'rollup', threadId }),
        }
      );
      if (resp.ok) {
        const result = await resp.json();
        if (result.rollup) {
          setRollup(result.rollup);
          if (result.rollup.memory_suggestions) {
            setMemorySuggestions(result.rollup.memory_suggestions);
          }
        }
      }
    } catch (e) {
      console.error('Rollup trigger failed:', e);
    } finally {
      setIsLoading(false);
    }
  }, [threadId, user]);

  return { rollup, memorySuggestions, isLoading, triggerRollup, refetch: fetchRollup };
}
