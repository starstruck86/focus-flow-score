import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  getIncomingResources,
  updateBrainStatus,
  bulkUpdateBrainStatus,
  manualIngestUrl,
  type BrainStatus,
} from '@/lib/salesBrain/ingestion';
import { processPromotedResource } from '@/lib/salesBrain/transformationPipeline';
import { toast } from 'sonner';

export function useIncomingQueue(status: BrainStatus = 'pending') {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['incoming-queue', user?.id, status],
    queryFn: () => getIncomingResources(user!.id, status),
    enabled: !!user?.id,
  });
}

export function useUpdateBrainStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BrainStatus }) => {
      await updateBrainStatus(id, status);

      // When promoted → trigger transformation pipeline
      if (status === 'promoted') {
        try {
          const { data: resource } = await (supabase as any)
            .from('resources')
            .select('id, title, content, description, tags')
            .eq('id', id)
            .single();

          if (resource) {
            const result = processPromotedResource({
              resourceId: resource.id,
              title: resource.title,
              content: resource.content,
              description: resource.description,
              tags: resource.tags || [],
            });

            if (result.doctrineUpdates.length > 0) {
              toast.info(`${result.insights.length} insights extracted, ${result.doctrineUpdates.length} doctrine updates`);
            }
          }
        } catch {
          // Non-critical — pipeline failure doesn't block promote
        }
      }
    },
    onSuccess: (_, { status }) => {
      qc.invalidateQueries({ queryKey: ['incoming-queue'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      const labels: Record<string, string> = {
        promoted: 'Promoted',
        ignored: 'Ignored',
        archived: 'Archived',
      };
      toast.success(labels[status] || 'Updated');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useBulkBrainStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: BrainStatus }) =>
      bulkUpdateBrainStatus(ids, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incoming-queue'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      toast.success('Bulk update complete');
    },
    onError: (e: any) => toast.error(e.message),
  });
}

export function useManualIngest() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: ({ url, title }: { url: string; title: string }) =>
      manualIngestUrl(user!.id, url, title),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ['incoming-queue'] });
      if (result === 'created') toast.success('Resource ingested');
      else if (result === 'duplicate') toast.info('Already exists (duplicate)');
      else toast.error('Ingestion failed');
    },
    onError: (e: any) => toast.error(e.message),
  });
}
