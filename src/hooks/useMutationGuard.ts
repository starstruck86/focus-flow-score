/**
 * useMutationGuard — prevents double-submits and duplicate mutations.
 * Returns { isPending, guard } where guard wraps an async fn and
 * prevents concurrent execution.
 */

import { useRef, useState, useCallback } from 'react';

export function useMutationGuard() {
  const [isPending, setIsPending] = useState(false);
  const lockRef = useRef(false);

  const guard = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (lockRef.current) return undefined;
      lockRef.current = true;
      setIsPending(true);
      try {
        return await fn();
      } finally {
        lockRef.current = false;
        setIsPending(false);
      }
    },
    [],
  );

  return { isPending, guard };
}
