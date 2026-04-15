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

/** Normalize text for dedup comparison */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Check if two strings are near-duplicates via substring containment */
function isNearDuplicate(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return true;
  // Substring containment (one fully contains the other)
  if (na.length > 20 && nb.length > 20) {
    if (na.includes(nb) || nb.includes(na)) return true;
  }
  return false;
}

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
    if (!objectType || !objectId || !user) { setMemories([]); return; }
    
    let data: any[] | null = null;
    if (objectType === 'account') {
      const res = await supabase.from('account_strategy_memory').select('*').eq('account_id', objectId).order('created_at', { ascending: false });
      data = res.data;
    } else if (objectType === 'opportunity') {
      const res = await supabase.from('opportunity_strategy_memory').select('*').eq('opportunity_id', objectId).order('created_at', { ascending: false });
      data = res.data;
    } else if (objectType === 'territory') {
      const res = await supabase.from('territory_strategy_memory').select('*').eq('territory_id', objectId).order('created_at', { ascending: false });
      data = res.data;
    }
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

    // ── Dedup check against local state ──
    const duplicate = memories.find(m => isNearDuplicate(m.content, content));
    if (duplicate) {
      toast('Similar insight already exists', {
        description: duplicate.content.slice(0, 80) + (duplicate.content.length > 80 ? '…' : ''),
      });
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
  }, [objectType, objectId, user, memories]);

  const deleteMemory = useCallback(async (memoryId: string) => {
    if (!objectType || !user) return;

    let error: any = null;
    if (objectType === 'account') {
      ({ error } = await supabase.from('account_strategy_memory').delete().eq('id', memoryId).eq('user_id', user.id));
    } else if (objectType === 'opportunity') {
      ({ error } = await supabase.from('opportunity_strategy_memory').delete().eq('id', memoryId).eq('user_id', user.id));
    } else if (objectType === 'territory') {
      ({ error } = await supabase.from('territory_strategy_memory').delete().eq('id', memoryId).eq('user_id', user.id));
    }

    if (error) {
      toast.error('Failed to remove memory');
      return;
    }

    setMemories(prev => prev.filter(m => m.id !== memoryId));
    toast.success('Memory removed');
  }, [objectType, user]);

  return { memories, saveMemory, deleteMemory, refetch: fetchMemories };
}
