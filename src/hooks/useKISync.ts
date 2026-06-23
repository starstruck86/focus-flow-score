/**
 * Syncs Branch KIs to IndexedDB on app load when online.
 * Runs once per session; skips if cache is fresh.
 */
import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  isCacheFresh,
  getCachedKICount,
  writeBranchKIsToCache,
  type CachedBranchKI,
} from '@/lib/offlineBranchKICache';

export type KISyncStatus = 'idle' | 'syncing' | 'synced' | 'error' | 'offline';

export function useKISync() {
  const { user } = useAuth();
  const [status, setStatus] = useState<KISyncStatus>('idle');
  const [cachedCount, setCachedCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    async function sync() {
      const existing = await getCachedKICount();
      if (!cancelled) setCachedCount(existing);

      if (!navigator.onLine) {
        if (!cancelled) setStatus('offline');
        return;
      }

      const fresh = await isCacheFresh();
      if (fresh) {
        if (!cancelled) setStatus('synced');
        return;
      }

      if (!cancelled) setStatus('syncing');
      try {
        const allKIs: CachedBranchKI[] = [];
        const PAGE_SIZE = 200;
        let offset = 0;

        while (true) {
          const { data, error } = await supabase
            .from('knowledge_items')
            .select('id, title, chapter, sub_chapter, spider_dimension, intelligence_type, tactic_summary, when_to_use, when_not_to_use, example_usage, why_it_matters, framework, confidence_score, active')
            .eq('user_id', user!.id)
            .eq('chapter', 'branch_io')
            .eq('active', true)
            .range(offset, offset + PAGE_SIZE - 1);

          if (error || !data?.length) break;
          allKIs.push(...(data as CachedBranchKI[]));
          if (data.length < PAGE_SIZE) break;
          offset += PAGE_SIZE;
        }

        if (allKIs.length > 0) {
          await writeBranchKIsToCache(allKIs);
          if (!cancelled) {
            setCachedCount(allKIs.length);
            setStatus('synced');
          }
        } else if (!cancelled) {
          setStatus('error');
        }
      } catch {
        if (!cancelled) setStatus('error');
      }
    }

    const t = setTimeout(sync, 2000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [user?.id]);

  return { status, cachedCount };
}
