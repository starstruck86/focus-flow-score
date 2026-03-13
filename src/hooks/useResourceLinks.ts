import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ResourceCategory = 'template' | 'framework' | 'playbook' | 'reference' | 'other';

export interface ResourceLink {
  id: string;
  user_id: string;
  account_id: string | null;
  opportunity_id: string | null;
  renewal_id: string | null;
  url: string;
  label: string;
  category: ResourceCategory;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface Filters {
  accountId?: string;
  opportunityId?: string;
  renewalId?: string;
  category?: ResourceCategory;
}

export function useResourceLinks(filters?: Filters) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resource-links', filters],
    queryFn: async () => {
      let query = supabase
        .from('resource_links' as any)
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.accountId) query = query.eq('account_id', filters.accountId);
      if (filters?.opportunityId) query = query.eq('opportunity_id', filters.opportunityId);
      if (filters?.renewalId) query = query.eq('renewal_id', filters.renewalId);
      if (filters?.category) query = query.eq('category', filters.category);

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as unknown as ResourceLink[];
    },
    enabled: !!user,
  });
}

export function useResourceLinksForRecord(recordType: 'account' | 'opportunity' | 'renewal', recordId?: string) {
  const filters: Filters = {};
  if (recordType === 'account') filters.accountId = recordId;
  if (recordType === 'opportunity') filters.opportunityId = recordId;
  if (recordType === 'renewal') filters.renewalId = recordId;
  return useResourceLinks(recordId ? filters : undefined);
}

export function useAddResourceLink() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (link: Omit<ResourceLink, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { error } = await supabase
        .from('resource_links' as any)
        .insert({ ...link, user_id: user!.id } as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}

export function useDeleteResourceLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('resource_links' as any)
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}
