/**
 * useAccountRoom — hydrates the "Account Room" truth-model data for a single
 * account. Reads (never writes) from: branch_pov, account_risks,
 * account_signals, account_dossiers, accounts (parent/children/vertical),
 * verticals. The only mutation exposed is the ratify affordance on branch_pov.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { computeGapScore, type GapScoreResult } from '@/lib/gapScore';

export interface PovRow {
  id: string;
  surface: string;
  target_status: string;
  conviction: number;
  rationale: string | null;
  ratified: boolean;
  ratified_at: string | null;
  sequence_rank: number | null;
  updated_at: string | null;
}

export interface RiskRow {
  id: string;
  risk_type: string;
  severity: number | null;
  likelihood: number | null;
  status: string;
  rationale: string | null;
  surface: string | null;
  competitor: string | null;
  observed_at: string;
}

export interface SignalRow {
  id: string;
  intelligence_head: string;
  raw_text: string;
  signal_type: string;
  signal_class: string | null;
  source_label: string | null;
  source_url: string | null;
  observed_at: string | null;
  created_at: string | null;
}

export interface DossierRow {
  id: string;
  content_md: string;
  version: number;
  rendered_at: string;
  is_current: boolean;
}

export interface ChildAccountRoom {
  id: string;
  name: string;
  gap: GapScoreResult;
}

export interface ParentAccountRef {
  id: string;
  name: string;
}

export interface AccountRoomData {
  loading: boolean;
  vertical: string | null;
  lastReviewedAt: string | null;
  parent: ParentAccountRef | null;
  children: ChildAccountRoom[];
  povs: PovRow[];
  risks: RiskRow[];
  signals: SignalRow[];
  signalsSinceReview: SignalRow[];
  dossier: DossierRow | null;
  gap: GapScoreResult;
}

const EMPTY_GAP = computeGapScore({ povs: [], risks: [] });

export function useAccountRoom(accountId: string | undefined) {
  const [state, setState] = useState<AccountRoomData>({
    loading: true,
    vertical: null,
    lastReviewedAt: null,
    parent: null,
    children: [],
    povs: [],
    risks: [],
    signals: [],
    signalsSinceReview: [],
    dossier: null,
    gap: EMPTY_GAP,
  });

  const fetchAll = useCallback(async () => {
    if (!accountId) {
      setState((s) => ({ ...s, loading: false }));
      return;
    }
    setState((s) => ({ ...s, loading: true }));

    const [acctRes, povRes, riskRes, sigRes, dossierRes, childRes] = await Promise.all([
      supabase
        .from('accounts')
        .select('id, name, parent_account_id, vertical_id, last_reviewed_at, verticals ( name )')
        .eq('id', accountId)
        .maybeSingle() as unknown as Promise<{ data: any; error: any }>,
      supabase
        .from('branch_pov')
        .select('id, surface, target_status, conviction, rationale, ratified, ratified_at, sequence_rank, updated_at')
        .eq('account_id', accountId)
        .order('sequence_rank', { ascending: true, nullsFirst: false })
        .order('conviction', { ascending: false }),
      supabase
        .from('account_risks')
        .select('id, risk_type, severity, likelihood, status, rationale, surface, competitor, observed_at')
        .eq('account_id', accountId)
        .order('observed_at', { ascending: false }),
      supabase
        .from('account_signals')
        .select('id, intelligence_head, raw_text, signal_type, signal_class, source_label, source_url, observed_at, created_at')
        .eq('linked_account_id', accountId)
        .order('observed_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(40),
      supabase
        .from('account_dossiers')
        .select('id, content_md, version, rendered_at, is_current')
        .eq('account_id', accountId)
        .eq('is_current', true)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('accounts')
        .select('id, name')
        .eq('parent_account_id', accountId),
    ]);

    const acct = acctRes.data as any;
    const povs = (povRes.data ?? []) as PovRow[];
    const risks = (riskRes.data ?? []) as RiskRow[];
    const signals = (sigRes.data ?? []) as SignalRow[];
    const dossier = (dossierRes.data ?? null) as DossierRow | null;
    const childAccts = (childRes.data ?? []) as Array<{ id: string; name: string }>;

    // Fetch parent (if any) name
    let parent: ParentAccountRef | null = null;
    if (acct?.parent_account_id) {
      const { data: p } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('id', acct.parent_account_id)
        .maybeSingle();
      if (p) parent = { id: p.id, name: p.name };
    }

    // Fetch child truth-model rows in one shot to compute per-child gap
    let children: ChildAccountRoom[] = [];
    if (childAccts.length > 0) {
      const ids = childAccts.map((c) => c.id);
      const [childPovsRes, childRisksRes] = await Promise.all([
        supabase
          .from('branch_pov')
          .select('account_id, target_status, conviction')
          .in('account_id', ids),
        supabase
          .from('account_risks')
          .select('account_id, status, severity')
          .in('account_id', ids),
      ]);
      const childPovs = (childPovsRes.data ?? []) as Array<{
        account_id: string;
        target_status: string | null;
        conviction: number | null;
      }>;
      const childRisks = (childRisksRes.data ?? []) as Array<{
        account_id: string;
        status: string | null;
        severity: number | null;
      }>;
      children = childAccts
        .map((c) => ({
          id: c.id,
          name: c.name,
          gap: computeGapScore({
            povs: childPovs.filter((p) => p.account_id === c.id),
            risks: childRisks.filter((r) => r.account_id === c.id),
          }),
        }))
        .sort((a, b) => b.gap.score - a.gap.score);
    }

    const lastReviewedAt = (acct?.last_reviewed_at ?? null) as string | null;
    const vertical = (acct?.verticals?.name ?? null) as string | null;

    // ⚡ SINCE LAST REVIEW filter — use observed_at ?? created_at
    const reviewTs = lastReviewedAt ? new Date(lastReviewedAt).getTime() : 0;
    const signalsSinceReview = signals.filter((s) => {
      const t = new Date(s.observed_at ?? s.created_at ?? 0).getTime();
      return t > reviewTs;
    });

    const gap = computeGapScore({
      povs: povs.map((p) => ({ target_status: p.target_status, conviction: p.conviction })),
      risks: risks.map((r) => ({ status: r.status, severity: r.severity })),
      last_reviewed_at: lastReviewedAt,
    });

    setState({
      loading: false,
      vertical,
      lastReviewedAt,
      parent,
      children,
      povs,
      risks,
      signals,
      signalsSinceReview,
      dossier,
      gap,
    });
  }, [accountId]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const ratifyPov = useCallback(
    async (povId: string) => {
      const { error } = await supabase
        .from('branch_pov')
        .update({ ratified: true, ratified_at: new Date().toISOString() })
        .eq('id', povId);
      if (error) throw error;
      await fetchAll();
    },
    [fetchAll],
  );

  return { ...state, refetch: fetchAll, ratifyPov };
}
