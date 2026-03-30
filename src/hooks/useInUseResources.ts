/**
 * Hook to compute "In Use" resource count — resources whose knowledge items
 * have actual telemetry usage in knowledge_usage_log.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useInUseResources() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['in-use-resources', user?.id],
    queryFn: async () => {
      // Get distinct source_resource_ids that have usage logs
      const { data, error } = await supabase
        .from('knowledge_usage_log' as any)
        .select('source_resource_id');

      if (error || !data) return { inUseResourceIds: new Set<string>(), count: 0 };

      const ids = new Set<string>();
      for (const row of data as any[]) {
        if (row.source_resource_id) ids.add(row.source_resource_id);
      }

      return { inUseResourceIds: ids, count: ids.size };
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
}
