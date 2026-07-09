/**
 * useVerticals — reads the 4 verticals for the current user and joins
 * account counts. Read-only.
 */
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface StructuralForce {
  name: string;
  class?: string;
  evidence?: string;
  mechanism?: string;
  so_what?: string;
}

export interface VerticalRow {
  id: string;
  name: string;
  thesis: string | null;
  structural_forces: StructuralForce[];
  vocabulary: string[];
  teaching_narrative: string | null;
  branch_relevance_map: string | null;
  refreshed_at: string | null;
  account_count: number;
}

export function useVerticals() {
  const [data, setData] = useState<VerticalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [vRes, aRes] = await Promise.all([
        supabase
          .from('verticals')
          .select('id, name, thesis, structural_forces, vocabulary, teaching_narrative, branch_relevance_map, refreshed_at')
          .order('name'),
        supabase
          .from('accounts')
          .select('vertical_id')
          .is('deleted_at', null)
          .not('vertical_id', 'is', null),
      ]);
      if (cancelled) return;
      if (vRes.error) {
        setError(vRes.error.message);
        setLoading(false);
        return;
      }
      const counts = new Map<string, number>();
      for (const a of (aRes.data ?? []) as Array<{ vertical_id: string | null }>) {
        if (a.vertical_id) counts.set(a.vertical_id, (counts.get(a.vertical_id) ?? 0) + 1);
      }
      const rows: VerticalRow[] = ((vRes.data ?? []) as any[]).map((v) => ({
        id: v.id,
        name: v.name,
        thesis: v.thesis,
        structural_forces: Array.isArray(v.structural_forces) ? v.structural_forces : [],
        vocabulary: Array.isArray(v.vocabulary) ? v.vocabulary : [],
        teaching_narrative: v.teaching_narrative,
        branch_relevance_map: v.branch_relevance_map,
        refreshed_at: v.refreshed_at,
        account_count: counts.get(v.id) ?? 0,
      }));
      setData(rows);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { data, loading, error };
}
