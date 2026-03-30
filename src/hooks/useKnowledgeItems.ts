import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface KnowledgeItem {
  id: string;
  user_id: string;
  source_resource_id: string | null;
  source_doctrine_id: string | null;
  title: string;
  knowledge_type: 'skill' | 'product' | 'competitive';
  chapter: string;
  sub_chapter: string | null;
  competitor_name: string | null;
  product_area: string | null;
  applies_to_contexts: string[];
  tactic_summary: string | null;
  why_it_matters: string | null;
  when_to_use: string | null;
  when_not_to_use: string | null;
  example_usage: string | null;
  confidence_score: number;
  status: 'extracted' | 'review_needed' | 'approved' | 'active' | 'stale';
  active: boolean;
  user_edited: boolean;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export type KnowledgeItemInsert = Omit<KnowledgeItem, 'id' | 'created_at' | 'updated_at'>;

const TABLE = 'knowledge_items' as any;

export function useKnowledgeItems(chapter?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['knowledge-items', user?.id, chapter],
    queryFn: async () => {
      let q = supabase.from(TABLE).select('*').order('confidence_score', { ascending: false });
      if (chapter) q = q.eq('chapter', chapter);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as KnowledgeItem[];
    },
    enabled: !!user,
  });
}

export function useKnowledgeStats() {
  const { data: items = [] } = useKnowledgeItems();
  const total = items.length;
  const active = items.filter(i => i.active).length;
  const extracted = items.filter(i => i.status === 'extracted').length;
  const reviewNeeded = items.filter(i => i.status === 'review_needed').length;
  const stale = items.filter(i => i.status === 'stale').length;
  const approved = items.filter(i => i.status === 'approved' || i.status === 'active').length;

  const byChapter = new Map<string, KnowledgeItem[]>();
  for (const item of items) {
    if (!byChapter.has(item.chapter)) byChapter.set(item.chapter, []);
    byChapter.get(item.chapter)!.push(item);
  }

  return { total, active, extracted, reviewNeeded, stale, approved, byChapter, items };
}

export function useActiveKnowledgeByChapter(chapter: string) {
  const { data: items = [] } = useKnowledgeItems(chapter);
  return items.filter(i => i.active);
}

export function useActiveKnowledge() {
  const { data: items = [] } = useKnowledgeItems();
  return items.filter(i => i.active);
}

export function useUpdateKnowledgeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<KnowledgeItem> & { id: string }) => {
      const { error } = await supabase.from(TABLE).update({ ...updates, updated_at: new Date().toISOString() } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge-items'] }),
  });
}

export function useDeleteKnowledgeItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(TABLE).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      toast.success('Knowledge item deleted');
    },
  });
}

export function useInsertKnowledgeItems() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (items: KnowledgeItemInsert[]) => {
      const { data, error } = await supabase.from(TABLE).insert(items as any).select();
      if (error) throw error;
      return (data ?? []) as unknown as KnowledgeItem[];
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      toast.success(`${data.length} knowledge item${data.length === 1 ? '' : 's'} extracted`);
    },
  });
}
