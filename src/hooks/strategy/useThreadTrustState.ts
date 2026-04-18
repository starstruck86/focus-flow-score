/**
 * useThreadTrustState — hydrates the durable trust state of a Strategy thread
 * from strategy_threads + strategy_thread_conflicts and exposes a runDetect()
 * action that re-runs the server-side detector.
 *
 * Trust states (server-computed):
 *   safe      — no unresolved conflicts
 *   warning   — at least one warning-level conflict (e.g. unconfirmed entity)
 *   blocked   — at least one blocking conflict (promotion is server-blocked)
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface ThreadConflict {
  id: string;
  conflict_kind: string;
  severity: 'warning' | 'blocking';
  reason: string;
  detected_account_name: string | null;
  linked_account_name: string | null;
  created_at: string;
}

export type TrustState = 'safe' | 'warning' | 'blocked';

interface EntitySignals {
  companies: { name: string; count: number; sources: string[] }[];
  people: { name: string; count: number; sources: string[] }[];
}

export function useThreadTrustState(threadId: string | null) {
  const { user } = useAuth();
  const [trustState, setTrustState] = useState<TrustState>('safe');
  const [trustReason, setTrustReason] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ThreadConflict[]>([]);
  const [entitySignals, setEntitySignals] = useState<EntitySignals | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    if (!threadId || !user) {
      setTrustState('safe'); setTrustReason(null); setConflicts([]); setEntitySignals(null); setLastCheckedAt(null);
      return;
    }
    const [{ data: thread }, { data: conf }] = await Promise.all([
      supabase
        .from('strategy_threads')
        .select('trust_state, trust_state_reason, entity_signals, trust_checked_at')
        .eq('id', threadId)
        .maybeSingle(),
      supabase
        .from('strategy_thread_conflicts')
        .select('id, conflict_kind, severity, reason, detected_account_name, linked_account_name, created_at')
        .eq('thread_id', threadId)
        .is('resolved_at', null)
        .order('severity', { ascending: false })
        .order('created_at', { ascending: false }),
    ]);
    setTrustState(((thread as any)?.trust_state ?? 'safe') as TrustState);
    setTrustReason((thread as any)?.trust_state_reason ?? null);
    setEntitySignals(((thread as any)?.entity_signals ?? null) as EntitySignals | null);
    setLastCheckedAt((thread as any)?.trust_checked_at ?? null);
    setConflicts((conf ?? []) as ThreadConflict[]);
  }, [threadId, user]);

  useEffect(() => { hydrate(); }, [hydrate]);

  const runDetect = useCallback(async (candidateAccountId?: string | null) => {
    if (!threadId) return null;
    setIsDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('strategy-detect-conflicts', {
        body: { thread_id: threadId, candidate_account_id: candidateAccountId ?? null },
      });
      if (error) throw error;
      await hydrate();
      return data as { trust_state: TrustState; conflicts: unknown[]; entity_signals: EntitySignals };
    } finally {
      setIsDetecting(false);
    }
  }, [threadId, hydrate]);

  return {
    trustState,
    trustReason,
    conflicts,
    entitySignals,
    isDetecting,
    lastCheckedAt,
    runDetect,
    refetch: hydrate,
  };
}
