/**
 * useMutationGuard — prevents double-submits and duplicate mutations.
 * Returns { isPending, guard } where guard wraps an async fn and
 * prevents concurrent execution.
 *
 * In review mode, all mutations are blocked with a toast.
 */

import { useRef, useState, useCallback } from 'react';
import { REVIEW_MODE } from '@/contexts/ReviewModeContext';
import { toast } from 'sonner';

export function useMutationGuard() {
  const [isPending, setIsPending] = useState(false);
  const lockRef = useRef(false);

  const guard = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      if (REVIEW_MODE) {
        toast.info('Mutations are disabled in Public Review Mode', { duration: 3000 });
        return undefined;
      }
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
