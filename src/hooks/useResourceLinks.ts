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
  category: string;
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
        .from('resource_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.accountId) query = query.eq('account_id', filters.accountId);
      if (filters?.opportunityId) query = query.eq('opportunity_id', filters.opportunityId);
      if (filters?.renewalId) query = query.eq('renewal_id', filters.renewalId);
      if (filters?.category) query = query.eq('category', filters.category);

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!user && !!filters,
  });
}

// Fetch links for a specific record + also its parent account links for opps/renewals
export function useResourceLinksForRecord(
  recordType: 'account' | 'opportunity' | 'renewal',
  recordId?: string,
  parentAccountId?: string
) {
  const filters: Filters = {};
  if (recordType === 'account') filters.accountId = recordId;
  if (recordType === 'opportunity') filters.opportunityId = recordId;
  if (recordType === 'renewal') filters.renewalId = recordId;

  const directLinks = useResourceLinks(recordId ? filters : undefined);

  const accountFilters: Filters | undefined =
    parentAccountId && recordType !== 'account' ? { accountId: parentAccountId } : undefined;
  const accountLinks = useResourceLinks(accountFilters);

  return {
    data: [
      ...(directLinks.data || []),
      ...(accountLinks.data || []).map(l => ({ ...l, _inherited: true as const })),
    ],
    isLoading: directLinks.isLoading || accountLinks.isLoading,
  };
}

export function useAllResourceLinks() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resource-links', 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_links')
        .select('*')
        .order('category', { ascending: true })
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });
}

export function useResourceLinksForAccount(accountId?: string) {
  return useResourceLinks(accountId ? { accountId } : undefined);
}

export function useAddResourceLink() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (link: Omit<ResourceLink, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      const { error } = await supabase
        .from('resource_links')
        .insert({ ...link, user_id: user!.id });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}

export function useUpdateResourceLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ResourceLink> & { id: string }) => {
      const { error } = await supabase
        .from('resource_links')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id);
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
        .from('resource_links')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}

// --- Utility: Auto-detect info from URL ---

export interface UrlMeta {
  suggestedLabel: string;
  suggestedCategory: ResourceCategory;
  docType: 'google-doc' | 'google-sheet' | 'google-slides' | 'google-form' | 'google-drive' | 'notion' | 'figma' | 'miro' | 'generic';
  favicon?: string;
}

export function detectUrlMeta(url: string): UrlMeta {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();

    if (host.includes('docs.google.com')) {
      if (path.includes('/document/')) return { suggestedLabel: 'Google Doc', suggestedCategory: 'template', docType: 'google-doc' };
      if (path.includes('/spreadsheets/')) return { suggestedLabel: 'Google Sheet', suggestedCategory: 'reference', docType: 'google-sheet' };
      if (path.includes('/presentation/')) return { suggestedLabel: 'Google Slides', suggestedCategory: 'framework', docType: 'google-slides' };
      if (path.includes('/forms/')) return { suggestedLabel: 'Google Form', suggestedCategory: 'other', docType: 'google-form' };
    }
    if (host.includes('drive.google.com')) return { suggestedLabel: 'Google Drive', suggestedCategory: 'reference', docType: 'google-drive' };
    if (host.includes('notion.so') || host.includes('notion.site')) return { suggestedLabel: 'Notion Page', suggestedCategory: 'playbook', docType: 'notion' };
    if (host.includes('figma.com')) return { suggestedLabel: 'Figma Design', suggestedCategory: 'template', docType: 'figma' };
    if (host.includes('miro.com')) return { suggestedLabel: 'Miro Board', suggestedCategory: 'framework', docType: 'miro' };

    return { suggestedLabel: host.replace('www.', ''), suggestedCategory: 'reference', docType: 'generic' };
  } catch {
    return { suggestedLabel: 'Link', suggestedCategory: 'other', docType: 'generic' };
  }
}

export function isValidUrl(str: string): boolean {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
