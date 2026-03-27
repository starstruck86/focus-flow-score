/**
 * Hook to load audio jobs from DB for display in resource table.
 * Replaces localStorage-based getAudioJobForResource for real DB state.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

export function useAudioJobsMap() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['audio-jobs-map', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('audio_jobs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);

      const map = new Map<string, AudioJobRecord>();
      for (const row of (data || [])) {
        const job = row as unknown as AudioJobRecord;
        // Keep only the latest job per resource
        if (!map.has(job.resource_id)) {
          map.set(job.resource_id, job);
        }
      }
      return map;
    },
    enabled: !!user,
    staleTime: 10_000,
  });

  return query;
}
