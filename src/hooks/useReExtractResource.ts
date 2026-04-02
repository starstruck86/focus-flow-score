/**
 * Hook to trigger single-resource KI re-extraction via the stabilized edge function.
 * Tracks per-resource status (idle/running/succeeded/failed).
 */
import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export type ReExtractStatus = 'idle' | 'running' | 'succeeded' | 'failed';

export interface ReExtractResult {
  kis: number;
  preservedUserEdited: number;
  error?: string;
}

export function useReExtractResource() {
  const qc = useQueryClient();
  const [statusMap, setStatusMap] = useState<Record<string, ReExtractStatus>>({});
  const [resultMap, setResultMap] = useState<Record<string, ReExtractResult>>({});

  const getStatus = useCallback((resourceId: string): ReExtractStatus => {
    return statusMap[resourceId] || 'idle';
  }, [statusMap]);

  const getResult = useCallback((resourceId: string): ReExtractResult | undefined => {
    return resultMap[resourceId];
  }, [resultMap]);

  const reExtract = useCallback(async (resourceId: string, resourceTitle: string) => {
    setStatusMap(prev => ({ ...prev, [resourceId]: 'running' }));

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
      setStatusMap(prev => ({ ...prev, [resourceId]: 'succeeded' }));

      toast.success(`Re-extracted "${resourceTitle}": ${result.kis} KIs`);

      // Refresh data
      qc.invalidateQueries({ queryKey: ['knowledge-items'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    } catch (err: any) {
      const result: ReExtractResult = { kis: 0, preservedUserEdited: 0, error: err.message };
      setResultMap(prev => ({ ...prev, [resourceId]: result }));
      setStatusMap(prev => ({ ...prev, [resourceId]: 'failed' }));
      toast.error(`Re-extract failed for "${resourceTitle}": ${err.message}`);
    }
  }, [qc]);

  return { reExtract, getStatus, getResult };
}
