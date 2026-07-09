/**
 * useVerticalDetail — single vertical + its accounts + current brief (if any).
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { VerticalRow } from './useVerticals';

export interface VerticalAccountRef {
  id: string;
  name: string;
  tier: string | null;
}

export interface VerticalBriefRow {
  id: string;
  version: number;
  content_md: string | null;
  pov_deck_md: string | null;
  rendered_at: string | null;
}

export interface VerticalDetail extends VerticalRow {
  accounts: VerticalAccountRef[];
  brief: VerticalBriefRow | null;
}

export function useVerticalDetail(verticalId: string | undefined) {
  const [data, setData] = useState<VerticalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!verticalId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [vRes, aRes, bRes] = await Promise.all([
        supabase
          .from('verticals')
          .select('id, name, thesis, structural_forces, vocabulary, teaching_narrative, branch_relevance_map, refreshed_at')
          .eq('id', verticalId)
          .maybeSingle(),
        supabase
          .from('accounts')
          .select('id, name, tier')
          .eq('vertical_id', verticalId)
          .is('deleted_at', null)
          .order('name'),
        supabase
          .from('vertical_briefs')
          .select('id, version, content_md, pov_deck_md, rendered_at, is_current')
          .eq('vertical_id', verticalId)
          .eq('is_current', true)
          .order('version', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      if (vRes.error) {
        setError(vRes.error.message);
        setLoading(false);
        return;
      }
      const v = vRes.data as any;
      if (!v) {
        setData(null);
        setLoading(false);
        return;
      }
      setData({
        id: v.id,
        name: v.name,
        thesis: v.thesis,
        structural_forces: Array.isArray(v.structural_forces) ? v.structural_forces : [],
        vocabulary: Array.isArray(v.vocabulary) ? v.vocabulary : [],
        teaching_narrative: v.teaching_narrative,
        branch_relevance_map: v.branch_relevance_map,
        refreshed_at: v.refreshed_at,
        account_count: (aRes.data ?? []).length,
        accounts: (aRes.data ?? []) as VerticalAccountRef[],
        brief: (bRes.data as VerticalBriefRow | null) ?? null,
      });
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [verticalId]);

  return { data, loading, error };
}
