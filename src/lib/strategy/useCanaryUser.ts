// ════════════════════════════════════════════════════════════════
// useCanaryUser — legacy boolean gate.
// Delegates to useCanaryMode so callers automatically pick up the
// localStorage operator toggle in addition to the hardcoded allowlist.
// ════════════════════════════════════════════════════════════════

import { useCanaryMode } from './useCanaryMode';

export function useCanaryUser(): boolean {
  return useCanaryMode().isCanary;
}
