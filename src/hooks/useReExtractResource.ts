/**
 * Hook to trigger single-resource KI re-extraction via the stabilized edge function.
 * Persists status to the resources table so it survives refresh/navigation.
 */
import { useState, useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAllResources } from '@/hooks/useResources';
import { toast } from 'sonner';

export type ReExtractStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ReExtractResult {
  kis: number;
  preservedUserEdited: number;
  error?: string;
}

const TABLE = 'resources' as any;

export function useReExtractResource() {
  const qc = useQueryClient();
  const { data: resources = [] } = useAllResources();
  // Local overrides while a request is in-flight (before DB roundtrip)
  const [localOverrides, setLocalOverrides] = useState<Record<string, ReExtractStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, ReExtractResult>>({});

  const getStatus = useCallback((resourceId: string): ReExtractStatus => {
    // Prefer local in-flight override, then fall back to persisted DB value
    if (localOverrides[resourceId]) return localOverrides[resourceId];
    const res = resources.find(r => r.id === resourceId);
    return ((res as any)?.re_extract_status as ReExtractStatus) || 'idle';
  }, [localOverrides, resources]);

  const getResult = useCallback((resourceId: string): ReExtractResult | undefined => {
    return resultMap[resourceId];
  }, [resultMap]);

  const persistStatus = async (resourceId: string, status: ReExtractStatus) => {
    await supabase
      .from(TABLE)
      .update({
        re_extract_status: status,
        re_extract_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as any)
      .eq('id', resourceId);
  };

  const reExtract = useCallback(async (resourceId: string, resourceTitle: string) => {
    setLocalOverrides(prev => ({ ...prev, [resourceId]: 'running' }));
    await persistStatus(resourceId, 'running');

    try {
      const { data, error } = await supabase.functions.invoke('batch-extract-kis', {
        body: { resourceId },
      });

      if (error) throw new Error(error.message || 'Edge function error');
      if (data?.error) throw new Error(data.error);

      const result: ReExtractResult = {
        kis: data?.kis ?? 0,
        preservedUserEdited: data?.preservedUserEdited ?? 0,
      };

      setResultMap(prev => ({ ...prev, [resourceId]: result }));
      setLocalOverrides(prev => ({ ...prev, [resourceId]: 'succeeded' }));
      await persistStatus(resourceId, 'succeeded');

      toast.success(`Re-extracted "${resourceTitle}": ${result.kis} KIs`);

      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    } catch (err: any) {
      const result: ReExtractResult = { kis: 0, preservedUserEdited: 0, error: err.message };
      setResultMap(prev => ({ ...prev, [resourceId]: result }));
      setLocalOverrides(prev => ({ ...prev, [resourceId]: 'failed' }));
      await persistStatus(resourceId, 'failed');
      toast.error(`Re-extract failed for "${resourceTitle}": ${err.message}`);
    }
  }, [qc]);

  return { reExtract, getStatus, getResult };
}
