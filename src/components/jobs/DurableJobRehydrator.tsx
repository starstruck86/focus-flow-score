/**
 * DurableJobRehydrator — thin wrapper component that calls the rehydration hook.
 * Mount once in App.tsx inside AuthProvider.
 */
import { useEffect, useRef } from 'react';
import { useDurableJobRehydration } from '@/hooks/useDurableJobRehydration';
import { installJobObserver } from '@/lib/observability';

export function DurableJobRehydrator() {
  useDurableJobRehydration();

  // Install telemetry observer once — additive only, no behavior change
  const observerRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!observerRef.current) {
      observerRef.current = installJobObserver();
    }
    return () => {
      observerRef.current?.();
      observerRef.current = null;
    };
  }, []);

  return null;
}
