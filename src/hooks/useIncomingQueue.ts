import { useEffect, useRef, useState, useCallback } from 'react';
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

export const QUEUE_KEY = 'incoming-queue';

// ── Realtime hook with connection status ─────────────────────────

export function useIncomingQueueRealtime() {
  const qc = useQueryClient();
  const [realtimeConnected, setRealtimeConnected] = useState(false);

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
      .subscribe((status) => {
        setRealtimeConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return { realtimeConnected };
}

// ── Sync tracker ─────────────────────────────────────────────────

export function useSyncTracker(dataUpdatedAt: number) {
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);
  const prevUpdatedAt = useRef(dataUpdatedAt);

  useEffect(() => {
    if (dataUpdatedAt > 0 && dataUpdatedAt !== prevUpdatedAt.current) {
      setLastSyncedAt(new Date());
      prevUpdatedAt.current = dataUpdatedAt;
    }
  }, [dataUpdatedAt]);

  return lastSyncedAt;
}

// ── Main query ───────────────────────────────────────────────────

export function useIncomingQueue(status: BrainStatus = 'pending') {
  const { user } = useAuth();
  return useQuery({
    queryKey: [QUEUE_KEY, user?.id, status],
    queryFn: () => getIncomingResources(user!.id, status),
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
    staleTime: 5_000,
  });
}

// ── Manual refresh ───────────────────────────────────────────────

export function useManualRefresh() {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await qc.refetchQueries({ queryKey: [QUEUE_KEY] });
    setRefreshing(false);
    toast.success('Queue refreshed');
  }, [qc]);

  return { refresh, refreshing };
}

// ── Mutations ────────────────────────────────────────────────────

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

    onMutate: async ({ id, status: newStatus }) => {
      await qc.cancelQueries({ queryKey: [QUEUE_KEY] });

      const allStatuses: BrainStatus[] = ['pending', 'promoted', 'ignored', 'archived'];
      const snapshots: Record<string, IncomingResource[] | undefined> = {};

      for (const s of allStatuses) {
        const key = [QUEUE_KEY, user?.id, s];
        snapshots[s] = qc.getQueryData<IncomingResource[]>(key);

        if (s !== newStatus && snapshots[s]) {
          qc.setQueryData<IncomingResource[]>(key, (old) =>
            (old || []).filter((item) => item.id !== id),
          );
        }
      }

      return { snapshots };
    },

    onError: (_err, _vars, context) => {
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
