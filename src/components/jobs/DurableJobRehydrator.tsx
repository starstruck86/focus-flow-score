/**
 * DurableJobRehydrator — thin wrapper component that calls the rehydration hook.
 * Mount once in App.tsx inside AuthProvider.
 */
import { useDurableJobRehydration } from '@/hooks/useDurableJobRehydration';

export function DurableJobRehydrator() {
  useDurableJobRehydration();
  return null;
}
