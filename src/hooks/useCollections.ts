/**
 * useCollections — hooks for resource_collections and memberships.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface ResourceCollection {
  id: string;
  name: string;
  collection_type: string;
  description: string | null;
  parent_resource_id: string | null;
  resource_count: number;
  created_at: string;
  updated_at: string;
}

export interface CollectionMember {
  id: string;
  collection_id: string;
  resource_id: string;
  position: number;
}

export function useCollections() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['resource-collections', user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('resource_collections')
        .select('*')
        .eq('user_id', user!.id)
        .order('name');
      if (error) throw error;
      return (data || []) as ResourceCollection[];
    },
    enabled: !!user,
  });
}

export function useCollectionMembers(collectionId: string | null) {
  return useQuery({
    queryKey: ['collection-members', collectionId],
    queryFn: async () => {
      if (!collectionId) return [];
      const { data, error } = await (supabase as any)
        .from('resource_collection_members')
        .select('*')
        .eq('collection_id', collectionId)
        .order('position');
      if (error) throw error;
      return (data || []) as CollectionMember[];
    },
    enabled: !!collectionId,
  });
}

export function useCreateCollection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { name: string; collection_type?: string; description?: string }) => {
      const { data, error } = await (supabase as any)
        .from('resource_collections')
        .insert({ ...input, user_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as ResourceCollection;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-collections'] }),
  });
}

export function useAddToCollection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ collectionId, resourceIds }: { collectionId: string; resourceIds: string[] }) => {
      const rows = resourceIds.map((rid, i) => ({
        collection_id: collectionId,
        resource_id: rid,
        user_id: user!.id,
        position: i,
      }));
      const { error } = await (supabase as any)
        .from('resource_collection_members')
        .upsert(rows, { onConflict: 'collection_id,resource_id' });
      if (error) throw error;
      // Update count
      await (supabase as any)
        .from('resource_collections')
        .update({ resource_count: resourceIds.length })
        .eq('id', collectionId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-collections'] });
      qc.invalidateQueries({ queryKey: ['collection-members'] });
    },
  });
}

export function useRemoveFromCollection() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ collectionId, resourceId }: { collectionId: string; resourceId: string }) => {
      const { error } = await (supabase as any)
        .from('resource_collection_members')
        .delete()
        .eq('collection_id', collectionId)
        .eq('resource_id', resourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['resource-collections'] });
      qc.invalidateQueries({ queryKey: ['collection-members'] });
    },
  });
}

export function useDeleteCollection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (collectionId: string) => {
      const { error } = await (supabase as any)
        .from('resource_collections')
        .delete()
        .eq('id', collectionId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['resource-collections'] }),
  });
}
