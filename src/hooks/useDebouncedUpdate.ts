import { useCallback, useRef } from 'react';

/**
 * Returns a debounced update function that batches rapid calls.
 * Useful for inline text/textarea editing to avoid firing store updates on every keystroke.
 */
export function useDebouncedUpdate<T extends Record<string, any>>(
  updateFn: (id: string, updates: Partial<T>) => void,
  id: string,
  delayMs = 400
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<Partial<T>>({});

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (Object.keys(pendingRef.current).length > 0) {
      updateFn(id, { ...pendingRef.current });
      pendingRef.current = {};
    }
  }, [updateFn, id]);

  const debouncedUpdate = useCallback((updates: Partial<T>) => {
    pendingRef.current = { ...pendingRef.current, ...updates };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, delayMs);
  }, [flush, delayMs]);

  return { debouncedUpdate, flush };
}

/**
 * Simple debounced callback — calls `fn` after `delayMs` of inactivity.
 */
export function useDebouncedCallback<A extends any[]>(fn: (...args: A) => void, delayMs = 400) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  return useCallback((...args: A) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fnRef.current(...args), delayMs);
  }, [delayMs]);
}
