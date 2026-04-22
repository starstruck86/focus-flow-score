// ════════════════════════════════════════════════════════════════
// useCanaryUser — hardcoded canary gate for Cycle 1 hardening UI.
// Add pilot user UUID(s) to CANARY_USER_IDS to expose the canary-only
// RoutingDetails developer panel.
// ════════════════════════════════════════════════════════════════

import { useAuth } from '@/contexts/AuthContext';

const CANARY_USER_IDS = new Set<string>([
  // Add pilot user UUID(s) here.
]);

export function useCanaryUser(): boolean {
  const { user } = useAuth();
  return !!user && CANARY_USER_IDS.has(user.id);
}
