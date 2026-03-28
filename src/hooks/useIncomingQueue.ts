import { useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  getIncomingResources,
  updateBrainStatus,
  bulkUpdateBrainStatus,
  manualIngestUrl,
  type BrainStatus,
  type IncomingResource,
} from '@/lib/salesBrain/ingestion';
import { processPromotedResource } from '@/lib/salesBrain/transformationPipeline';
import { toast } from 'sonner';

const QUEUE_KEY = 'incoming-queue';

/** Realtime subscription — invalidates queue on any resources row change */
export function useIncomingQueueRealtime() {
  const qc = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel('incoming-queue-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'resources' },
        () => {
          qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);
}

export function useIncomingQueue(status: BrainStatus = 'pending') {
  const { user } = useAuth();
  return useQuery({
    queryKey: [QUEUE_KEY, user?.id, status],
    queryFn: () => getIncomingResources(user!.id, status),
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
    staleTime: 5_000, // 5s — keeps it fresh
  });
}

export function useUpdateBrainStatus() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: BrainStatus }) => {
      await updateBrainStatus(id, status);

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
          // Non-critical
        }
      }
    },

    // Optimistic update: remove item from current tab instantly
    onMutate: async ({ id, status: newStatus }) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await qc.cancelQueries({ queryKey: [QUEUE_KEY] });

      // Snapshot all queue caches for rollback
      const allStatuses: BrainStatus[] = ['pending', 'promoted', 'ignored', 'archived'];
      const snapshots: Record<string, IncomingResource[] | undefined> = {};

      for (const s of allStatuses) {
        const key = [QUEUE_KEY, user?.id, s];
        snapshots[s] = qc.getQueryData<IncomingResource[]>(key);

        if (s === newStatus && snapshots[s]) {
          // We don't know the full item shape, so just invalidate the target tab
        } else if (snapshots[s]) {
          // Remove item from this tab's cache
          qc.setQueryData<IncomingResource[]>(key, (old) =>
            (old || []).filter((item) => item.id !== id),
          );
        }
      }

      return { snapshots };
    },

    onError: (_err, _vars, context) => {
      // Rollback all tabs
      if (context?.snapshots) {
        const allStatuses: BrainStatus[] = ['pending', 'promoted', 'ignored', 'archived'];
        for (const s of allStatuses) {
          if (context.snapshots[s] !== undefined) {
            qc.setQueryData([QUEUE_KEY, user?.id, s], context.snapshots[s]);
          }
        }
      }
      toast.error('Failed to update status');
    },

    onSettled: () => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
    },

    onSuccess: (_, { status }) => {
      const labels: Record<string, string> = {
        promoted: 'Promoted',
        ignored: 'Ignored',
        archived: 'Archived',
        pending: 'Moved to Pending',
      };
      toast.success(labels[status] || 'Updated');
    },
  });
}

export function useBulkBrainStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: BrainStatus }) =>
      bulkUpdateBrainStatus(ids, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
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
      qc.invalidateQueries({ queryKey: [QUEUE_KEY] });
      qc.invalidateQueries({ queryKey: ['resources'] });
      if (result === 'created') toast.success('Resource ingested');
      else if (result === 'duplicate') toast.info('Already exists (duplicate)');
      else toast.error('Ingestion failed');
    },
    onError: (e: any) => toast.error(e.message),
  });
}
