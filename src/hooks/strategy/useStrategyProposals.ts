import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export type ProposalStatus = 'pending' | 'confirmed' | 'rejected' | 'promoted' | 'failed' | 'superseded';
export type ProposalScope = 'account' | 'opportunity' | 'both';
export type ProposalType =
  | 'contact' | 'account_note' | 'account_intelligence'
  | 'opportunity_note' | 'opportunity_intelligence'
  | 'transcript' | 'resource_promotion' | 'artifact_promotion'
  | 'stakeholder' | 'risk' | 'blocker' | 'champion';

export interface StrategyProposal {
  id: string;
  user_id: string;
  thread_id: string;
  source_message_id: string | null;
  source_artifact_id: string | null;
  proposal_type: ProposalType;
  target_table: string;
  target_scope: ProposalScope;
  target_account_id: string | null;
  target_opportunity_id: string | null;
  payload_json: Record<string, unknown>;
  rationale: string | null;
  scope_rationale: string | null;
  dedupe_key: string;
  status: ProposalStatus;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_reason: string | null;
  promoted_record_id: string | null;
  promoted_at: string | null;
  promotion_error: string | null;
  detector_version: string;
  detector_confidence: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Reads + mutates strategy_promotion_proposals.
 * Phase 3: confirm/reject only update status. Promotion (writes to shared tables)
 * is Phase 4 — this hook does NOT touch any other table.
 */
export function useStrategyProposals(threadId: string | null) {
  const { user } = useAuth();
  const [proposals, setProposals] = useState<StrategyProposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchProposals = useCallback(async () => {
    if (!user || !threadId) { setProposals([]); return; }
    setIsLoading(true);
    const { data, error } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .select('*')
      .eq('thread_id', threadId)
      .in('status', ['pending', 'confirmed', 'promoted', 'failed'])
      .order('created_at', { ascending: false })
      .limit(50);
    if (!error && data) setProposals(data as StrategyProposal[]);
    setIsLoading(false);
  }, [user, threadId]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const detect = useCallback(async (input: {
    sourceMessageId?: string;
    sourceArtifactId?: string;
    content: string;
    artifactType?: string;
    artifactTitle?: string;
  }) => {
    if (!threadId) return { created: 0 };
    try {
      const { data, error } = await supabase.functions.invoke('strategy-detect-proposals', {
        body: {
          thread_id: threadId,
          source_message_id: input.sourceMessageId,
          source_artifact_id: input.sourceArtifactId,
          content: input.content,
          artifact_type: input.artifactType,
          artifact_title: input.artifactTitle,
        },
      });
      if (error) throw error;
      await fetchProposals();
      return data ?? { created: 0 };
    } catch (e) {
      console.error('[proposals] detect failed', e);
      return { created: 0, error: String(e) };
    }
  }, [threadId, fetchProposals]);

  /**
   * Retroactive scan: runs the detector against every recent assistant message
   * AND every artifact in the thread. Idempotent — the detector dedupes on
   * (thread_id, proposal_type, dedupe_key). This is the activation surface
   * that turns the pipeline on for historical content.
   */
  const scanThread = useCallback(async (): Promise<{ scanned: number; created: number; errors: number }> => {
    if (!threadId || !user) return { scanned: 0, created: 0, errors: 0 };
    const [{ data: msgs }, { data: arts }] = await Promise.all([
      (supabase as any)
        .from('strategy_messages')
        .select('id, content_json')
        .eq('thread_id', threadId)
        .eq('role', 'assistant')
        .order('created_at', { ascending: false })
        .limit(20),
      (supabase as any)
        .from('strategy_artifacts')
        .select('id, artifact_type, title, content_json')
        .eq('thread_id', threadId)
        .order('created_at', { ascending: false })
        .limit(20),
    ]);

    const messageJobs = (msgs ?? []).map((m: any) => {
      const text = typeof m.content_json === 'string'
        ? m.content_json
        : (m.content_json?.text ?? JSON.stringify(m.content_json ?? {}));
      return { kind: 'message' as const, id: m.id, content: String(text), title: undefined, type: undefined };
    }).filter((j: any) => j.content.trim().length >= 200);

    const artifactJobs = (arts ?? []).map((a: any) => {
      const text = typeof a.content_json === 'string'
        ? a.content_json
        : JSON.stringify(a.content_json ?? {});
      return { kind: 'artifact' as const, id: a.id, content: String(text), title: a.title, type: a.artifact_type };
    }).filter((j: any) => j.content.trim().length >= 100);

    const jobs = [...messageJobs, ...artifactJobs];
    let created = 0;
    let errors = 0;
    // Run sequentially to avoid hammering the LLM gateway with parallel bursts
    for (const job of jobs) {
      try {
        const res = await detect({
          ...(job.kind === 'message'
            ? { sourceMessageId: job.id }
            : { sourceArtifactId: job.id, artifactType: job.type, artifactTitle: job.title }),
          content: job.content.slice(0, 8000),
        });
        created += (res as any)?.created ?? 0;
      } catch {
        errors += 1;
      }
    }
    await fetchProposals();
    return { scanned: jobs.length, created, errors };
  }, [threadId, user, detect, fetchProposals]);

  const confirm = useCallback(async (
    proposalId: string,
    overrides?: { target_account_id?: string | null; target_opportunity_id?: string | null; target_scope?: ProposalScope; payload_json?: Record<string, unknown> }
  ) => {
    if (!user) return false;
    const updates: Record<string, unknown> = {
      status: 'confirmed',
      confirmed_by: user.id,
      confirmed_at: new Date().toISOString(),
    };
    if (overrides?.target_account_id !== undefined) updates.target_account_id = overrides.target_account_id;
    if (overrides?.target_opportunity_id !== undefined) updates.target_opportunity_id = overrides.target_opportunity_id;
    if (overrides?.target_scope) updates.target_scope = overrides.target_scope;
    if (overrides?.payload_json) updates.payload_json = overrides.payload_json;

    const { error } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .update(updates)
      .eq('id', proposalId);
    if (error) { console.error('[proposals] confirm failed', error); return false; }
    await fetchProposals();
    return true;
  }, [user, fetchProposals]);

  const reject = useCallback(async (proposalId: string, reason?: string) => {
    const { error } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .update({ status: 'rejected', rejected_reason: reason ?? null })
      .eq('id', proposalId);
    if (error) { console.error('[proposals] reject failed', error); return false; }
    setProposals(prev => prev.filter(p => p.id !== proposalId));
    return true;
  }, []);

  const editPayload = useCallback(async (proposalId: string, payload: Record<string, unknown>) => {
    const { error } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .update({ payload_json: payload })
      .eq('id', proposalId);
    if (error) { console.error('[proposals] edit failed', error); return false; }
    await fetchProposals();
    return true;
  }, [fetchProposals]);

  /**
   * Phase 4: Promote a confirmed proposal into the appropriate shared
   * system-of-record table via the promoter edge function.
   */
  const promote = useCallback(async (proposalId: string, opts?: { mark_reusable?: boolean; resource_type_override?: string }) => {
    try {
      const { data, error } = await supabase.functions.invoke('strategy-promote-proposal', {
        body: { proposal_id: proposalId, ...opts },
      });
      if (error) throw error;
      await fetchProposals();
      return data as { success?: boolean; promoted_table?: string; promoted_record_id?: string; already_promoted?: boolean; error?: string };
    } catch (e: any) {
      console.error('[proposals] promote failed', e);
      return { success: false, error: String(e?.message ?? e) };
    }
  }, [fetchProposals]);

  return { proposals, isLoading, refetch: fetchProposals, detect, scanThread, confirm, reject, editPayload, promote };
}
