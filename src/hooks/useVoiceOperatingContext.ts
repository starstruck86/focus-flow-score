/**
 * useVoiceOperatingContext
 *
 * UI safety net hook — keeps UI surfaces in sync with Dave's voice context.
 * Listens for 'dave-context-changed' events and provides current state.
 */

import { useState, useEffect, useCallback } from 'react';
import { getVoiceContext, updateVoiceContext, type VoiceOperatingContext } from '@/lib/voiceContext';

export function useVoiceOperatingContext() {
  const [context, setContext] = useState<VoiceOperatingContext>(getVoiceContext);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setContext(detail);
    };
    window.addEventListener('dave-context-changed', handler);
    // Also poll every 10s as a fallback
    const interval = setInterval(() => setContext(getVoiceContext()), 10_000);
    return () => {
      window.removeEventListener('dave-context-changed', handler);
      clearInterval(interval);
    };
  }, []);

  const update = useCallback((patch: Partial<VoiceOperatingContext>) => {
    updateVoiceContext(patch);
    setContext(getVoiceContext());
  }, []);

  return { context, update };
}
