import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyOutput } from '@/types/strategy';

export function useStrategyOutputs(threadId: string | null) {
  const { user } = useAuth();
  const [outputs, setOutputs] = useState<StrategyOutput[]>([]);

  const fetchOutputs = useCallback(async () => {
    if (!threadId || !user) { setOutputs([]); return; }
    const { data } = await supabase
      .from('strategy_outputs')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: false });
    if (data) setOutputs(data as StrategyOutput[]);
  }, [threadId, user]);

  useEffect(() => { fetchOutputs(); }, [fetchOutputs]);

  return { outputs, refetch: fetchOutputs };
}
