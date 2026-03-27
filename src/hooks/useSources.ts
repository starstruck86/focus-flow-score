import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  getSources,
  insertSource,
  updateSourceStatus,
  deleteSource,
  type SourceRegistryRow,
  type SourceRegistryInsert,
  type SourceType,
} from '@/data/source-registry';
import { toast } from 'sonner';

export function useSources() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['source-registry', user?.id],
    queryFn: () => getSources(user!.id),
    enabled: !!user?.id,
  });
}

export function useAddSource() {
  const qc = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: (source: Omit<SourceRegistryInsert, 'user_id'>) =>
      insertSource({ ...source, user_id: user!.id }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['source-registry'] });
      toast.success('Source added');
    },
    onError: (e: any) => toast.error(`Failed to add source: ${e.message}`),
  });
}

export function useDeleteSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSource,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['source-registry'] });
      toast.success('Source removed');
    },
    onError: (e: any) => toast.error(`Failed: ${e.message}`),
  });
}

export function useToggleSourceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      updateSourceStatus(id, status),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['source-registry'] }),
  });
}

export type { SourceRegistryRow, SourceType };
