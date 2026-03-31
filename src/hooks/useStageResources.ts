/**
 * Hook to manage stage-resource associations and keystone toggles.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface StageResource {
  id: string;
  stage_id: string;
  resource_id: string;
  is_keystone: boolean;
  created_at: string;
  // Joined resource fields
  resource_title?: string;
  resource_type?: string;
  resource_source_type?: string;
}

export function useStageResources(stageId: string) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const queryKey = ['stage-resources', user?.id, stageId];

  const { data: stageResources = [], isLoading } = useQuery({
    queryKey,
    enabled: !!user && !!stageId,
    queryFn: async () => {
      // Fetch stage_resources joined with resource metadata
      const { data: links, error } = await supabase
        .from('stage_resources' as any)
        .select('id, stage_id, resource_id, is_keystone, created_at')
        .eq('user_id', user!.id)
        .eq('stage_id', stageId)
        .order('is_keystone', { ascending: false })
        .order('created_at', { ascending: true });

      if (error) throw error;

      if (!links || links.length === 0) return [] as StageResource[];

      // Fetch resource titles
      const resourceIds = (links as any[]).map((l: any) => l.resource_id);
      const { data: resources } = await supabase
        .from('resources')
        .select('id, title, resource_type')
        .in('id', resourceIds);

      const resourceMap = new Map((resources || []).map(r => [r.id, r]));

      return (links as any[]).map((l: any) => ({
        id: l.id,
        stage_id: l.stage_id,
        resource_id: l.resource_id,
        is_keystone: l.is_keystone,
        created_at: l.created_at,
        resource_title: resourceMap.get(l.resource_id)?.title || 'Untitled',
        resource_type: resourceMap.get(l.resource_id)?.resource_type || '',
      })) as StageResource[];
    },
  });

  const keystoneResources = stageResources.filter(r => r.is_keystone);
  const supportingResources = stageResources.filter(r => !r.is_keystone);

  const addResource = useMutation({
    mutationFn: async (resourceId: string) => {
      const { error } = await supabase
        .from('stage_resources' as any)
        .insert({ user_id: user!.id, stage_id: stageId, resource_id: resourceId } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('Resource added to stage');
    },
    onError: (err: any) => {
      if (err?.code === '23505') {
        toast.info('Resource already associated with this stage');
      } else {
        toast.error('Failed to add resource');
      }
    },
  });

  const removeResource = useMutation({
    mutationFn: async (resourceId: string) => {
      const { error } = await supabase
        .from('stage_resources' as any)
        .delete()
        .eq('user_id', user!.id)
        .eq('stage_id', stageId)
        .eq('resource_id', resourceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      toast.success('Resource removed from stage');
    },
    onError: () => toast.error('Failed to remove resource'),
  });

  const toggleKeystone = useMutation({
    mutationFn: async ({ resourceId, isKeystone }: { resourceId: string; isKeystone: boolean }) => {
      const { error } = await supabase
        .from('stage_resources' as any)
        .update({ is_keystone: isKeystone } as any)
        .eq('user_id', user!.id)
        .eq('stage_id', stageId)
        .eq('resource_id', resourceId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey });
      toast.success(vars.isKeystone ? 'Marked as Keystone' : 'Moved to Supporting');
    },
    onError: () => toast.error('Failed to update resource'),
  });

  return {
    stageResources,
    keystoneResources,
    supportingResources,
    isLoading,
    addResource,
    removeResource,
    toggleKeystone,
  };
}
