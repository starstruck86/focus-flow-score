/**
 * useAccountGapScores — bulk gap-score fetch for many accounts (table rows).
 * One query for branch_pov, one for account_risks, one for last_reviewed_at.
 */
import { useEffect, useState, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeGapScore, type GapScoreResult } from '@/lib/gapScore';

export function useAccountGapScores(accountIds: string[]): Record<string, GapScoreResult> {
  const [map, setMap] = useState<Record<string, GapScoreResult>>({});

  // Stable key to avoid refetching on every re-render.
  const key = useMemo(() => [...accountIds].sort().join('|'), [accountIds]);

  useEffect(() => {
    let cancelled = false;
    if (accountIds.length === 0) {
      setMap({});
      return;
    }
    (async () => {
      const [povsRes, risksRes, acctRes] = await Promise.all([
        supabase
          .from('branch_pov')
          .select('account_id, target_status, conviction')
          .in('account_id', accountIds),
        supabase
          .from('account_risks')
          .select('account_id, status, severity')
          .in('account_id', accountIds),
        supabase
          .from('accounts')
          .select('id, last_reviewed_at')
          .in('id', accountIds),
      ]);
      if (cancelled) return;
      const povs = (povsRes.data ?? []) as Array<{ account_id: string; target_status: string | null; conviction: number | null }>;
      const risks = (risksRes.data ?? []) as Array<{ account_id: string; status: string | null; severity: number | null }>;
      const acct = (acctRes.data ?? []) as Array<{ id: string; last_reviewed_at: string | null }>;
      const reviewedBy = new Map(acct.map((a) => [a.id, a.last_reviewed_at] as const));
      const next: Record<string, GapScoreResult> = {};
      accountIds.forEach((id) => {
        next[id] = computeGapScore({
          povs: povs.filter((p) => p.account_id === id),
          risks: risks.filter((r) => r.account_id === id),
          last_reviewed_at: reviewedBy.get(id) ?? null,
        });
      });
      setMap(next);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}
