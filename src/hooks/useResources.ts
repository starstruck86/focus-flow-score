import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { useCallback } from 'react';
import type { EnrichmentStatus } from '@/lib/resourceEligibility';
import { autoOperationalizeResource } from '@/lib/autoOperationalize';

export type ResourceFolder = {
  id: string;
  user_id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Resource = {
  id: string;
  user_id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  resource_type: string;
  content: string | null;
  is_template: boolean | null;
  template_category: string | null;
  account_id: string | null;
  opportunity_id: string | null;
  file_url: string | null;
  tags: string[] | null;
  current_version: number | null;
  created_at: string;
  updated_at: string;
  // Legacy field (still populated but not authoritative)
  content_status?: string;
  // Canonical lifecycle fields
  enrichment_status: EnrichmentStatus;
  enriched_at?: string | null;
  content_length?: number | null;
  last_enrichment_attempt_at?: string | null;
  last_status_change_at?: string | null;
  enrichment_version: number;
  validation_version: number;
  failure_reason?: string | null;
  failure_count: number;
  last_quality_score?: number | null;
  last_quality_tier?: string | null;
  enrichment_audit_log?: any[];
  // Advanced extraction fields
  advanced_extraction_status?: string | null;
  advanced_extraction_attempts?: number;
  last_advanced_extraction_at?: string | null;
  resolution_method?: string | null;
  platform_status?: string | null;
  // Recovery fields
  recovery_status?: string | null;
  recovery_reason?: string | null;
  next_best_action?: string | null;
  recovery_queue_bucket?: string | null;
  manual_input_required?: boolean;
  recovery_attempt_count?: number;
  last_recovery_error?: string | null;
  access_type?: string | null;
  content_classification?: string | null;
  extraction_method?: string | null;
  re_extract_status?: string;
  re_extract_at?: string | null;
};

export type ResourceVersion = {
  id: string;
  resource_id: string;
  user_id: string;
  version_number: number;
  title: string;
  content: string | null;
  change_summary: string | null;
  file_url: string | null;
  created_at: string;
};

export function useResourceFolders() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resource-folders', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_folders')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return data as ResourceFolder[];
    },
    enabled: !!user,
  });
}

export function useResources(folderId?: string | null) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resources', user?.id, folderId],
    queryFn: async () => {
      let query = supabase.from('resources').select('*').order('updated_at', { ascending: false });
      if (folderId === null) {
        query = query.is('folder_id', null);
      } else if (folderId) {
        query = query.eq('folder_id', folderId);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data as Resource[];
    },
    enabled: !!user,
  });
}

export function useAllResources() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resources', user?.id, 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resources')
        .select('*')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Resource[];
    },
    enabled: !!user,
  });
}

export function useResourceVersions(resourceId: string) {
  return useQuery({
    queryKey: ['resource-versions', resourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_versions')
        .select('*')
        .eq('resource_id', resourceId)
        .order('version_number', { ascending: false });
      if (error) throw error;
      return data as ResourceVersion[];
    },
    enabled: !!resourceId,
  });
}

export function useCreateFolder() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (data: { name: string; parent_id?: string | null; icon?: string; color?: string }) => {
      const { data: result, error } = await supabase
        .from('resource_folders')
        .insert({ ...data, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return result;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      toast.success('Folder created');
    },
    onError: () => toast.error('Failed to create folder'),
  });
}

export function useCreateResource() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (data: {
      title: string;
      folder_id?: string | null;
      resource_type?: string;
      content?: string;
      is_template?: boolean;
      template_category?: string;
      description?: string;
      tags?: string[];
    }) => {
      const { data: result, error } = await supabase
        .from('resources')
        .insert({ ...data, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      // Create initial version
      await supabase.from('resource_versions').insert({
        resource_id: result.id,
        user_id: user!.id,
        version_number: 1,
        title: data.title,
        content: data.content || '',
        change_summary: 'Initial version',
      });
      return result;
    },
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success('Resource created');
      // Fire-and-forget auto-operationalization
      if (data?.id) {
        autoOperationalizeResource(data.id).then(result => {
          qc.invalidateQueries({ queryKey: ['knowledge-items'] });
          if (result.operationalized) {
            toast.success(`Auto-operationalized — ${result.knowledgeExtracted} extracted, ${result.knowledgeActivated} activated`);
          }
        }).catch(() => {});
      }
    },
    onError: () => toast.error('Failed to create resource'),
  });
}

export function useUpdateResource() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ id, updates, createVersion }: {
      id: string;
      updates: Partial<Pick<Resource, 'title' | 'content' | 'description' | 'folder_id' | 'is_template' | 'template_category' | 'tags' | 'resource_type' | 'account_id' | 'opportunity_id'>>;
      createVersion?: { change_summary?: string };
    }) => {
      if (createVersion) {
        const { data: current } = await supabase.from('resources').select('current_version').eq('id', id).single();
        const nextVersion = (current?.current_version || 0) + 1;
        updates = { ...updates };
        await supabase.from('resources').update({ ...updates, current_version: nextVersion }).eq('id', id);
        await supabase.from('resource_versions').insert({
          resource_id: id,
          user_id: user!.id,
          version_number: nextVersion,
          title: updates.title || '',
          content: updates.content || '',
          change_summary: createVersion.change_summary || `Version ${nextVersion}`,
        });
      } else {
        const { error } = await supabase.from('resources').update(updates).eq('id', id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['resource-versions'] });
    },
    onError: () => toast.error('Failed to update resource'),
  });
}

/** Update the enrichment_status of a resource (manual lifecycle control) */
export function useUpdateEnrichmentStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enrichment_status, failure_reason }: {
      id: string;
      enrichment_status: string;
      failure_reason?: string | null;
    }) => {
      const { error } = await supabase
        .from('resources')
        .update({
          enrichment_status,
          last_status_change_at: new Date().toISOString(),
          ...(failure_reason !== undefined ? { failure_reason } : {}),
        } as any)
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: () => toast.error('Failed to update status'),
  });
}

export function useDeleteResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { deleteResourceWithCleanup } = await import('@/lib/resourceDelete');
      return deleteResourceWithCleanup(id);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['incoming-queue'] });
      qc.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
      const kiMsg = result.kiDeleted > 0 ? ` and ${result.kiDeleted} knowledge items` : '';
      toast.success(`Resource${kiMsg} deleted`);
    },
    onError: (err: Error) => toast.error(`Delete failed: ${err.message}`),
  });
}

export function useBulkDeleteResources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { bulkDeleteResources } = await import('@/lib/resourceDelete');
      return bulkDeleteResources(ids);
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['incoming-queue'] });
      qc.invalidateQueries({ queryKey: ['canonical-lifecycle'] });
      if (result.errors.length > 0) {
        toast.error(`Deleted ${result.deleted}, ${result.errors.length} failed: ${result.errors[0]}`);
      } else {
        const kiMsg = result.kiDeleted > 0 ? ` and ${result.kiDeleted} knowledge items` : '';
        toast.success(`${result.deleted} resources${kiMsg} deleted`);
      }
    },
    onError: (err: Error) => toast.error(`Bulk delete failed: ${err.message}`),
  });
}

export function useDeleteFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('resource_folders').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success('Folder deleted');
    },
    onError: () => toast.error('Failed to delete folder'),
  });
}

export function useRenameFolder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase.from('resource_folders').update({ name }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-folders'] });
      toast.success('Folder renamed');
    },
  });
}

export function useTemplates() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resources', user?.id, 'templates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resources')
        .select('*')
        .eq('is_template', true)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data as Resource[];
    },
    enabled: !!user,
  });
}

export type TemplateSuggestion = {
  id: string;
  user_id: string;
  source_resource_id: string | null;
  title: string;
  description: string;
  template_category: string;
  suggested_content: string | null;
  status: string;
  created_at: string;
  updated_at: string;
};

export function useTemplateSuggestions() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['template-suggestions', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('template_suggestions')
        .select('*')
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(3);
      if (error) throw error;
      return data as TemplateSuggestion[];
    },
    enabled: !!user,
  });
}

export function useDismissSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('template_suggestions')
        .update({ status: 'dismissed' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['template-suggestions'] });
    },
  });
}

export function useConfirmSuggestion() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (suggestion: TemplateSuggestion) => {
      if (!user) throw new Error('Not authenticated');
      const { data: resource, error } = await supabase
        .from('resources')
        .insert({
          user_id: user.id,
          title: suggestion.title,
          description: suggestion.description,
          resource_type: 'template',
          content: suggestion.suggested_content || '',
          is_template: true,
          template_category: suggestion.template_category,
          source_resource_id: suggestion.source_resource_id,
        })
        .select()
        .single();
      if (error) throw error;

      await supabase.from('resource_versions').insert({
        resource_id: resource.id,
        user_id: user.id,
        version_number: 1,
        title: suggestion.title,
        content: suggestion.suggested_content || '',
        change_summary: 'Created from AI suggestion',
      });

      await supabase
        .from('template_suggestions')
        .update({ status: 'confirmed' })
        .eq('id', suggestion.id);

      return resource;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['template-suggestions'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success('Template created from suggestion');
    },
    onError: () => toast.error('Failed to create template'),
  });
}

// --- Resource Digest / Operationalize ---

export type ResourceDigest = {
  id: string;
  resource_id: string;
  user_id: string;
  takeaways: string[];
  summary: string;
  use_cases: string[];
  grading_criteria: { category: string; description: string; weight: number }[] | null;
  content_hash: string;
  created_at: string;
};

export function useOperationalizeResource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (resourceId: string) => {
      const { data, error } = await trackedInvoke<any>('operationalize-resource', {
        body: { resource_id: resourceId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { digest: ResourceDigest; suggested_tasks: { title: string; description: string }[]; skipped: boolean };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['resource-digests'] });
      if (data.skipped) {
        toast.info('Resource already operationalized (content unchanged)');
      } else {
        const taskCount = data.suggested_tasks?.length || 0;
        const criteriaCount = data.digest?.grading_criteria?.length || 0;
        toast.success(
          `Operationalized! ${data.digest.takeaways.length} takeaways${criteriaCount ? `, ${criteriaCount} grading criteria` : ''}${taskCount ? `, ${taskCount} suggested tasks` : ''}`
        );
      }
    },
    onError: (e: any) => toast.error(e.message || 'Failed to operationalize resource'),
  });
}

export type ResourceSuggestion = {
  description: string;
  action_type: 'transform' | 'combine' | 'templatize';
  source_resource_ids: string[];
  target_type: string;
  deal_context?: string;
};

export function useResourceSuggestions(enabled = false) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resource-suggestions', user?.id],
    queryFn: async () => {
      const { data, error } = await trackedInvoke<any>('suggest-resource-uses');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.suggestions || []) as ResourceSuggestion[];
    },
    enabled: !!user && enabled,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

export function useResourceDigest(resourceId: string) {
  return useQuery({
    queryKey: ['resource-digests', resourceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('resource_digests')
        .select('*')
        .eq('resource_id', resourceId)
        .single();
      if (error && error.code !== 'PGRST116') throw error;
      return data as ResourceDigest | null;
    },
    enabled: !!resourceId,
  });
}
