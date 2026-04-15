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

export function useStrategyMemory(
  objectType: 'account' | 'opportunity' | 'territory' | null,
  objectId: string | null,
) {
  const { user } = useAuth();
  const [memories, setMemories] = useState<StrategyMemoryEntry[]>([]);

  const tableName = objectType === 'account' ? 'account_strategy_memory'
    : objectType === 'opportunity' ? 'opportunity_strategy_memory'
    : objectType === 'territory' ? 'territory_strategy_memory'
    : null;

  const idColumn = objectType === 'account' ? 'account_id'
    : objectType === 'opportunity' ? 'opportunity_id'
    : objectType === 'territory' ? 'territory_id'
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
    sourceMessageId?: string,
  ) => {
    if (!tableName || !idColumn || !objectId || !user) {
      toast.error('No linked object to save memory to');
      return;
    }
    const payload: Record<string, any> = {
      user_id: user.id,
      [idColumn]: objectId,
      memory_type: memoryType,
      content,
      source_thread_id: sourceThreadId || null,
      source_message_id: sourceMessageId || null,
    };
    const { data, error } = await supabase.from(tableName).insert(payload).select().single();
    if (error) {
      toast.error('Failed to save memory');
      return;
    }
    setMemories(prev => [data as StrategyMemoryEntry, ...prev]);
    toast.success('Insight saved');
  }, [tableName, idColumn, objectId, user]);

  return { memories, saveMemory, refetch: fetchMemories };
}
