// ════════════════════════════════════════════════════════════════
// useCanaryMode — operator-controllable canary gating.
//
// A user is "canary" if EITHER:
//   1. their user.id is in the hardcoded CANARY_USER_IDS allowlist, OR
//   2. they have flipped strategy.canaryMode = "1" in localStorage.
//
// This keeps the existing pilot allowlist working AND lets an operator
// enable canary-only surfaces for themselves at runtime, without an
// edit/deploy. No backend write — purely client-side, per-browser.
//
// `useCanaryUser` (legacy) delegates here so any caller picks up the
// new behavior automatically.
// ════════════════════════════════════════════════════════════════

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';

export const CANARY_USER_IDS = new Set<string>([
  // Add pilot user UUID(s) here. Members are always canary regardless
  // of their localStorage toggle.
]);

const LS_KEY = 'strategy.canaryMode';
const STORAGE_EVENT = 'strategy:canary-mode-changed';

function readLocal(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
}

function writeLocal(on: boolean) {
  if (typeof window === 'undefined') return;
  try {
    if (on) window.localStorage.setItem(LS_KEY, '1');
    else window.localStorage.removeItem(LS_KEY);
    // Notify same-tab listeners (the native `storage` event only fires
    // across tabs).
    window.dispatchEvent(new CustomEvent(STORAGE_EVENT));
  } catch {
    /* swallow — non-critical */
  }
}

/**
 * Returns whether the current user is in canary mode AND a setter to
 * toggle the local override. Allowlist membership cannot be toggled off.
 */
export function useCanaryMode(): {
  isCanary: boolean;
  isAllowlisted: boolean;
  localEnabled: boolean;
  setLocalEnabled: (on: boolean) => void;
  toggle: () => void;
} {
  const { user } = useAuth();
  const isAllowlisted = !!user && CANARY_USER_IDS.has(user.id);

  const [localEnabled, setLocalEnabledState] = useState<boolean>(() => readLocal());

  useEffect(() => {
    const onChange = () => setLocalEnabledState(readLocal());
    window.addEventListener('storage', onChange);
    window.addEventListener(STORAGE_EVENT, onChange as EventListener);
    return () => {
      window.removeEventListener('storage', onChange);
      window.removeEventListener(STORAGE_EVENT, onChange as EventListener);
    };
  }, []);

  const setLocalEnabled = useCallback((on: boolean) => {
    writeLocal(on);
    setLocalEnabledState(on);
  }, []);

  const toggle = useCallback(() => setLocalEnabled(!localEnabled), [localEnabled, setLocalEnabled]);

  return {
    isCanary: !!user && (isAllowlisted || localEnabled),
    isAllowlisted,
    localEnabled,
    setLocalEnabled,
    toggle,
  };
}
