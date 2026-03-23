/**
 * Hook: useNewLogoTargets
 * Automatically selects top 3 new-logo accounts each day.
 * Caches in localStorage so the selection is stable throughout the day.
 */
import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { format } from 'date-fns';
import {
  selectDailyNewLogoTargets,
  loadCachedSelection,
  type DailySelection,
  type SelectedAccount,
} from '@/lib/newLogoSelection';

export function useNewLogoTargets(): {
  selection: DailySelection | null;
  targets: SelectedAccount[];
  isReady: boolean;
} {
  const { accounts, opportunities } = useStore();
  const today = format(new Date(), 'yyyy-MM-dd');

  const selection = useMemo(() => {
    if (!accounts.length) return null;

    // Check cache first for stable daily picks
    const cached = loadCachedSelection(today);
    // Validate cached accounts still exist
    if (cached && cached.accounts.length > 0) {
      const accountIds = new Set(accounts.map(a => a.id));
      const allValid = cached.accounts.every(a => accountIds.has(a.id));
      if (allValid) return cached;
    }

    // Build set of account IDs with active opportunities
    const activeOppAccountIds = new Set(
      opportunities
        .filter(o => o.status === 'active' || o.status === 'stalled')
        .map(o => o.accountId)
        .filter(Boolean) as string[]
    );

    return selectDailyNewLogoTargets(accounts, today, activeOppAccountIds);
  }, [accounts, opportunities, today]);

  return {
    selection,
    targets: selection?.accounts ?? [],
    isReady: (selection?.accounts.length ?? 0) > 0,
  };
}
