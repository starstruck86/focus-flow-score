import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  getResourceLinks,
  getAllResourceLinks,
  insertResourceLink,
  updateResourceLink as updateResourceLinkQuery,
  deleteResourceLink as deleteResourceLinkQuery,
  type ResourceLinkRow,
  type ResourceLinkFilters,
} from '@/data/resource-links';

export type ResourceCategory = 'template' | 'framework' | 'playbook' | 'reference' | 'other';

export type ResourceLink = ResourceLinkRow;

type Filters = ResourceLinkFilters & { category?: ResourceCategory };

export function useResourceLinks(filters?: Filters) {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resource-links', filters],
    queryFn: () => getResourceLinks(filters),
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
    queryFn: () => getAllResourceLinks(),
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
    mutationFn: async (link: Omit<ResourceLinkRow, 'id' | 'user_id' | 'created_at' | 'updated_at'>) => {
      return insertResourceLink({ ...link, user_id: user!.id });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}

export function useUpdateResourceLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<ResourceLinkRow> & { id: string }) => {
      return updateResourceLinkQuery(id, updates);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-links'] }),
  });
}

export function useDeleteResourceLink() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: deleteResourceLinkQuery,
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
