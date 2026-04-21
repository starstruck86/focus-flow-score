/**
 * Server-side resource lifecycle summary.
 *
 * Returns lifecycle bucket counts (total / importing / completed / failed /
 * processing / queued / content_ready) computed in Postgres — does NOT
 * download resource rows. Safe at 10k+ resources.
 *
 * Use this for screens that only need totals (badges, headers, dashboards).
 * For row-level UIs, use the canonical lifecycle hook (which paginates).
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ResourceLifecycleSummary {
  total: number;
  importing: number;
  completed: number;
  failed: number;
  processing: number;
  queued: number;
  content_ready: number;
  computed_at: string;
}

export function useResourceLifecycleSummary() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['resource-lifecycle-summary', user?.id],
    queryFn: async (): Promise<ResourceLifecycleSummary | null> => {
      if (!user) return null;
      const { data, error } = await supabase.rpc('get_resource_lifecycle_summary', {
        p_user_id: user.id,
      });
      if (error) throw error;
      return data as unknown as ResourceLifecycleSummary;
    },
    enabled: !!user,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
