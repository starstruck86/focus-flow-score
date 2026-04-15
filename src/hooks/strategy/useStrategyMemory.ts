import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface StrategyMemoryEntry {
  id: string;
  memory_type: string;
  content: string;
  confidence: number | null;
  is_pinned: boolean;
  source_thread_id: string | null;
  created_at: string;
}

type MemoryTable = 'account_strategy_memory' | 'opportunity_strategy_memory' | 'territory_strategy_memory';

export function useStrategyMemory(
  objectType: 'account' | 'opportunity' | 'territory' | null,
  objectId: string | null,
) {
  const { user } = useAuth();
  const [memories, setMemories] = useState<StrategyMemoryEntry[]>([]);

  const tableName: MemoryTable | null = objectType === 'account' ? 'account_strategy_memory'
    : objectType === 'opportunity' ? 'opportunity_strategy_memory'
    : objectType === 'territory' ? 'territory_strategy_memory'
    : null;

  const idColumn = objectType === 'account' ? 'account_id' as const
    : objectType === 'opportunity' ? 'opportunity_id' as const
    : objectType === 'territory' ? 'territory_id' as const
    : null;

  const fetchMemories = useCallback(async () => {
    if (!tableName || !idColumn || !objectId || !user) { setMemories([]); return; }
    const { data } = await supabase
      .from(tableName)
      .select('*')
      .eq(idColumn, objectId)
      .order('created_at', { ascending: false });
    if (data) setMemories(data as StrategyMemoryEntry[]);
  }, [tableName, idColumn, objectId, user]);

  useEffect(() => { fetchMemories(); }, [fetchMemories]);

  const saveMemory = useCallback(async (
    memoryType: string,
    content: string,
    sourceThreadId?: string,
  ) => {
    if (!objectType || !objectId || !user) {
      toast.error('No linked object to save memory to');
      return;
    }

    // Use specific table inserts to satisfy type checker
    let result: any;
    if (objectType === 'account') {
      const { data, error } = await supabase.from('account_strategy_memory').insert({
        user_id: user.id,
        account_id: objectId,
        memory_type: memoryType,
        content,
        source_thread_id: sourceThreadId || null,
      }).select().single();
      if (error) { toast.error('Failed to save memory'); return; }
      result = data;
    } else if (objectType === 'opportunity') {
      const { data, error } = await supabase.from('opportunity_strategy_memory').insert({
        user_id: user.id,
        opportunity_id: objectId,
        memory_type: memoryType,
        content,
        source_thread_id: sourceThreadId || null,
      }).select().single();
      if (error) { toast.error('Failed to save memory'); return; }
      result = data;
    } else if (objectType === 'territory') {
      const { data, error } = await supabase.from('territory_strategy_memory').insert({
        user_id: user.id,
        territory_id: objectId,
        memory_type: memoryType,
        content,
        source_thread_id: sourceThreadId || null,
      }).select().single();
      if (error) { toast.error('Failed to save memory'); return; }
      result = data;
    }

    if (result) {
      setMemories(prev => [result as StrategyMemoryEntry, ...prev]);
      toast.success('Insight saved');
    }
  }, [objectType, objectId, user]);

  return { memories, saveMemory, refetch: fetchMemories };
}
