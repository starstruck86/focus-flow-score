// ════════════════════════════════════════════════════════════════
// validationKey — session-scoped cache for STRATEGY_VALIDATION_KEY.
//
// The validation key is stored in sessionStorage so the operator only
// has to enter it once per browser session. Cleared on tab close.
// Never persisted to localStorage. Never sent anywhere except the
// run-validation-canary endpoint.
// ════════════════════════════════════════════════════════════════

const KEY = 'strategy.validationKey';

export function getCachedValidationKey(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setCachedValidationKey(value: string) {
  try {
    sessionStorage.setItem(KEY, value);
  } catch { /* ignore */ }
}

export function clearCachedValidationKey() {
  try {
    sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

/** Prompt for the key if not cached. Returns null if user cancels. */
export function ensureValidationKey(): string | null {
  const cached = getCachedValidationKey();
  if (cached) return cached;
  const entered = typeof window !== 'undefined'
    ? window.prompt('Enter STRATEGY_VALIDATION_KEY (cached for this browser session):')
    : null;
  if (!entered) return null;
  setCachedValidationKey(entered);
  return entered;
}
