/**
 * Hook to fetch latest smoke test result with persistent notification dedupe.
 */
import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export interface HealthRecord {
  id: string;
  status: string;
  total_ms: number | null;
  provider_health: Record<string, boolean>;
  infra_passed: number;
  infra_failed: number;
  e2e_passed: number;
  e2e_failed: number;
  failed_tests: Array<{ test: string; error?: string }>;
  created_at: string;
  full_result?: { results?: Array<{ fallback_used?: boolean }> };
}

const LS_NOTIFIED_ID = 'smoke_last_notified_id';
const LS_NOTIFIED_STATUS = 'smoke_last_notified_status';

export function useSystemHealth() {
  const { user } = useAuth();
  const currentCreatedAtRef = useRef<string | null>(null);

  const query = useQuery({
    queryKey: ['system-health', user?.id],
    queryFn: async (): Promise<HealthRecord | null> => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('smoke_test_results')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        ...data,
        provider_health: (data.provider_health ?? {}) as Record<string, boolean>,
        failed_tests: (data.failed_tests ?? []) as Array<{ test: string; error?: string }>,
        full_result: (data.full_result ?? undefined) as HealthRecord['full_result'],
      };
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  const health = query.data;

  // Persistent notification dedupe
  useEffect(() => {
    if (!health) return;

    // Race-condition guard: ignore stale results
    if (currentCreatedAtRef.current && new Date(health.created_at) < new Date(currentCreatedAtRef.current)) {
      return;
    }
    currentCreatedAtRef.current = health.created_at;

    const lastNotifiedId = localStorage.getItem(LS_NOTIFIED_ID);
    const lastNotifiedStatus = localStorage.getItem(LS_NOTIFIED_STATUS);

    // Same result already notified — skip
    if (health.id === lastNotifiedId) return;

    // Degradation: do NOT toast. The badge in the bottom-right is the
    // single source of truth for system status. Toasts during normal
    // usage are scary, interrupt the user, and add noise. We still
    // record the notification ID so recovery toasts behave correctly
    // for users who happened to see the badge change state.
    if (health.status !== 'ok') {
      localStorage.setItem(LS_NOTIFIED_ID, health.id);
      localStorage.setItem(LS_NOTIFIED_STATUS, health.status);
      return;
    }

    // Recovery: only toast if the user previously saw a degraded state
    // in this session. Quiet by default.
    if (lastNotifiedStatus && lastNotifiedStatus !== 'ok' && health.status === 'ok') {
      toast.success('AI System Recovered', {
        description: 'All systems operational',
        duration: 4_000,
      });
      localStorage.setItem(LS_NOTIFIED_ID, health.id);
      localStorage.setItem(LS_NOTIFIED_STATUS, 'ok');
      return;
    }

    // Healthy and previous was healthy (or first load) — just update silently
    localStorage.setItem(LS_NOTIFIED_ID, health.id);
    localStorage.setItem(LS_NOTIFIED_STATUS, health.status);
  }, [health]);

  // Derive fallback warning from full_result
  const hasFallbackActivity = !!(health?.full_result?.results?.some(r => r.fallback_used));

  return { health, hasFallbackActivity, ...query };
}
