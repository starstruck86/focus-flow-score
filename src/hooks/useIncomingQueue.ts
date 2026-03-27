import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  getIncomingResources,
  updateBrainStatus,
  bulkUpdateBrainStatus,
  manualIngestUrl,
  type BrainStatus,
} from '@/lib/salesBrain/ingestion';
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
    mutationFn: ({ id, status }: { id: string; status: BrainStatus }) =>
      updateBrainStatus(id, status),
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
