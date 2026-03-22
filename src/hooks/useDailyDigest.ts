import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface DigestItem {
  id: string;
  userId: string;
  accountId: string | null;
  accountName: string;
  digestDate: string;
  category: string;
  headline: string;
  summary: string | null;
  sourceUrl: string | null;
  relevanceScore: number;
  isRead: boolean;
  isActionable: boolean;
  suggestedAction: string | null;
  rawData: any;
  createdAt: string;
}

function mapRow(row: any): DigestItem {
  return {
    id: row.id,
    userId: row.user_id,
    accountId: row.account_id,
    accountName: row.account_name,
    digestDate: row.digest_date,
    category: row.category,
    headline: row.headline,
    summary: row.summary,
    sourceUrl: row.source_url,
    relevanceScore: row.relevance_score,
    isRead: row.is_read,
    isActionable: row.is_actionable,
    suggestedAction: row.suggested_action,
    rawData: row.raw_data,
    createdAt: row.created_at,
  };
}

export function useDailyDigest(date?: string) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const targetDate = date || new Date().toISOString().slice(0, 10);

  const query = useQuery({
    queryKey: ['daily-digest', targetDate],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_digest_items')
        .select('*')
        .eq('digest_date', targetDate)
        .order('relevance_score', { ascending: false });

      if (error) throw error;
      return (data || []).map(mapRow);
    },
    enabled: !!user,
  });

  const markRead = useMutation({
    mutationFn: async (itemId: string) => {
      const { error } = await supabase
        .from('daily_digest_items')
        .update({ is_read: true })
        .eq('id', itemId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-digest'] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('daily_digest_items')
        .update({ is_read: true })
        .eq('digest_date', targetDate)
        .eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['daily-digest'] });
    },
  });

  const triggerDigest = useMutation({
    mutationFn: async () => {
      const { data, error } = await trackedInvoke<any>('daily-digest', {
        body: { userId: user?.id },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['daily-digest'] });
      queryClient.invalidateQueries({ queryKey: ['accounts'] });
      const updates = data?.accountsUpdated || 0;
      toast.success(`Digest generated`, {
        description: `${data?.itemsCreated || 0} updates found${updates > 0 ? `, ${updates} accounts enriched` : ''}`,
      });
    },
    onError: (err) => {
      toast.error('Failed to generate digest', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    },
  });

  const unreadCount = (query.data || []).filter(i => !i.isRead).length;

  return {
    items: query.data || [],
    isLoading: query.isLoading,
    unreadCount,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
    triggerDigest: triggerDigest.mutate,
    isGenerating: triggerDigest.isPending,
  };
}
