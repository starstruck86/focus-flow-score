/**
 * Hook to fetch latest smoke test result and detect state changes for notifications.
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
}

const CRITICAL_TESTS = [
  'e2e_strategy_chat',
  'e2e_strategy_workflow',
  'e2e_artifact_transform',
];

export function useSystemHealth() {
  const { user } = useAuth();
  const prevStatusRef = useRef<string | null>(null);
  const prevHealthRef = useRef<Record<string, boolean> | null>(null);
  const hasNotifiedRef = useRef(false);

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
      };
    },
    enabled: !!user,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000, // re-check every 5 min
  });

  const health = query.data;

  // Notification logic — only fire on state transitions
  useEffect(() => {
    if (!health || hasNotifiedRef.current) return;

    const prev = prevStatusRef.current;
    const prevProviders = prevHealthRef.current;

    // Update refs
    prevStatusRef.current = health.status;
    prevHealthRef.current = health.provider_health;

    // Skip first load (no previous state to compare)
    if (prev === null) return;

    // Status degradation
    if (prev === 'ok' && health.status !== 'ok') {
      hasNotifiedRef.current = true;
      const failedCount = health.e2e_failed + health.infra_failed;
      toast.error(`AI System ${health.status === 'failed' ? 'Down' : 'Degraded'}`, {
        description: `${failedCount} test(s) failing`,
        duration: 10_000,
      });
    }

    // Provider went unhealthy
    if (prevProviders) {
      for (const [provider, wasHealthy] of Object.entries(prevProviders)) {
        if (wasHealthy && health.provider_health[provider] === false) {
          hasNotifiedRef.current = true;
          toast.error(`${provider} is now unhealthy`, {
            description: 'Fallback may be active',
            duration: 8_000,
          });
        }
      }
    }

    // Critical test failure
    const criticalFails = health.failed_tests
      .filter(t => CRITICAL_TESTS.includes(t.test))
      .map(t => t.test);
    if (criticalFails.length > 0 && prev === 'ok') {
      // already covered by status degradation toast above
    }

    // Reset notification flag when healthy again
    if (health.status === 'ok') {
      hasNotifiedRef.current = false;
    }
  }, [health]);

  return { health, ...query };
}
