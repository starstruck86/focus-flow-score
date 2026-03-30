/**
 * Canonical Lifecycle Hook — SINGLE SOURCE OF TRUTH for all tabs.
 *
 * Every component that needs resource lifecycle counts MUST use this hook.
 * No tab may compute its own lifecycle truth independently.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import {
  auditCanonicalLifecycle,
  type LifecycleSummary,
  type CanonicalResourceStatus,
  type LifecycleStage,
  type BlockedReason,
} from '@/lib/canonicalLifecycle';

export type { LifecycleSummary, CanonicalResourceStatus, LifecycleStage, BlockedReason };
export { LIFECYCLE_STAGES, STAGE_LABELS, STAGE_COLORS, BLOCKED_LABELS } from '@/lib/canonicalLifecycle';

export function useCanonicalLifecycle() {
  const { user } = useAuth();

  const query = useQuery({
    queryKey: ['canonical-lifecycle', user?.id],
    queryFn: auditCanonicalLifecycle,
    enabled: !!user,
    staleTime: 30_000, // 30s — shared across all tabs
    refetchOnWindowFocus: false,
  });

  return {
    summary: query.data ?? null,
    loading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    isRefetching: query.isRefetching,
  };
}
