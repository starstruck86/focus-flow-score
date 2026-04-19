/**
 * useStrategySaveGesture — the single entry point for "save this thought".
 *
 * Routes EVERY selection-driven save through the exact existing proposal
 * pipeline (strategy_promotion_proposals → confirm → promote). No side-door
 * writes. Trust gates are preserved: if a CRM contact promotion lacks a linked
 * account (or the thread has trust conflicts), we surface a human-readable
 * message instead of attempting the write.
 *
 * Phase 2 contract:
 *   - 1 gesture = insert pending proposal → confirm with class → promote
 *   - returns { ok, undo, openPath, message } so the caller can show a quiet toast
 *   - undo() reverts by setting the proposal to 'rejected' (and best-effort
 *     soft-deletes the promoted record by leaving it; we do not fabricate
 *     destructive deletes from a save toast — Undo means "don't keep it")
 */
import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { StrategyThread } from '@/types/strategy';
import type { PromotionClass, ProposalScope, ProposalType } from './useStrategyProposals';

export type SaveScope = 'account' | 'opportunity' | 'research' | 'crm_contact';

export interface SaveGestureInput {
  selectionText: string;
  sourceMessageId: string | null;
  thread: StrategyThread;
  /** The destination scope. */
  scope: SaveScope;
  /** Override targets (used by ScopePicker). */
  targetAccountId?: string | null;
  targetOpportunityId?: string | null;
  /** For crm_contact saves — the parsed person name. */
  contactName?: string | null;
}

export interface SaveGestureResult {
  ok: boolean;
  /** Human-readable inline message for the toast. Never references internal state. */
  message: string;
  /** Where "Open" should jump to. null when there's nowhere to open. */
  openPath: string | null;
  /** Calling undo() reverts the save. */
  undo?: () => Promise<void>;
}

function classify(scope: SaveScope): { promotionClass: PromotionClass; proposalType: ProposalType; targetTable: string; targetScope: ProposalScope } {
  switch (scope) {
    case 'account':
      return { promotionClass: 'shared_intelligence', proposalType: 'account_intelligence', targetTable: 'account_strategy_memory', targetScope: 'account' };
    case 'opportunity':
      return { promotionClass: 'shared_intelligence', proposalType: 'opportunity_intelligence', targetTable: 'account_strategy_memory', targetScope: 'opportunity' };
    case 'research':
      return { promotionClass: 'research_only', proposalType: 'account_note', targetTable: 'account_strategy_memory', targetScope: 'account' };
    case 'crm_contact':
      return { promotionClass: 'crm_contact', proposalType: 'contact', targetTable: 'contacts', targetScope: 'account' };
  }
}

/** Resolve which entity a save should attach to, given the thread + scope. */
function resolveTarget(
  thread: StrategyThread,
  scope: SaveScope,
  override: { accountId?: string | null; opportunityId?: string | null },
): { accountId: string | null; opportunityId: string | null; missing: 'account' | 'opportunity' | null } {
  if (override.accountId !== undefined || override.opportunityId !== undefined) {
    return { accountId: override.accountId ?? null, opportunityId: override.opportunityId ?? null, missing: null };
  }
  if (scope === 'opportunity') {
    if (thread.linked_opportunity_id) {
      return { accountId: thread.linked_account_id ?? null, opportunityId: thread.linked_opportunity_id, missing: null };
    }
    return { accountId: null, opportunityId: null, missing: 'opportunity' };
  }
  if (scope === 'account' || scope === 'crm_contact' || scope === 'research') {
    if (thread.linked_account_id) {
      return { accountId: thread.linked_account_id, opportunityId: thread.linked_opportunity_id ?? null, missing: null };
    }
    return { accountId: null, opportunityId: null, missing: 'account' };
  }
  return { accountId: null, opportunityId: null, missing: null };
}

/** Look up the entity name for a friendly toast like "Saved to Lima One Capital". */
async function fetchEntityName(accountId: string | null, opportunityId: string | null): Promise<string | null> {
  try {
    if (opportunityId) {
      const { data } = await supabase.from('opportunities').select('name').eq('id', opportunityId).maybeSingle();
      if (data?.name) return data.name;
    }
    if (accountId) {
      const { data } = await supabase.from('accounts').select('name').eq('id', accountId).maybeSingle();
      if (data?.name) return data.name;
    }
  } catch { /* swallow — toast falls back */ }
  return null;
}

/** Build a stable dedupe key for a selection-driven save. */
function dedupeKeyFor(scope: SaveScope, threadId: string, text: string): string {
  // Hash-ish: use first 80 chars + scope + thread. Idempotent per gesture target.
  const slice = text.replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase();
  return `selection:${scope}:${threadId}:${slice}`;
}

export function useStrategySaveGesture() {
  const { user } = useAuth();

  const save = useCallback(async (input: SaveGestureInput): Promise<SaveGestureResult> => {
    if (!user) return { ok: false, message: 'Sign in required', openPath: null };

    const cls = classify(input.scope);
    const target = resolveTarget(input.thread, input.scope, {
      accountId: input.targetAccountId,
      opportunityId: input.targetOpportunityId,
    });

    // Trust gate: CRM contact requires a linked account
    if (input.scope === 'crm_contact' && !target.accountId) {
      return {
        ok: false,
        message: 'Need a linked account before saving this as a contact',
        openPath: null,
      };
    }

    if (target.missing === 'account' && input.scope !== 'research') {
      // Research-only does not require linkage; everything else does.
      return {
        ok: false,
        message: input.scope === 'opportunity'
          ? 'Need a linked opportunity for this save'
          : 'Need a linked account for this save',
        openPath: null,
      };
    }
    if (target.missing === 'opportunity') {
      return { ok: false, message: 'Need a linked opportunity for this save', openPath: null };
    }

    // Build payload — selection-driven proposals carry the raw selection in
    // payload_json so the promoter writes it as the memory/contact content.
    const payload: Record<string, unknown> = input.scope === 'crm_contact'
      ? {
          name: input.contactName ?? input.selectionText.split(/\s+/).slice(0, 4).join(' '),
          notes: input.selectionText,
          source: 'strategy_selection',
        }
      : {
          content: input.selectionText,
          memory_type: input.scope === 'research'
            ? 'fact'
            : input.scope === 'opportunity' ? 'next_step' : 'fact',
          source: 'strategy_selection',
        };

    // 1) Insert pending proposal (selection-origin)
    const { data: inserted, error: insertErr } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .insert({
        user_id: user.id,
        thread_id: input.thread.id,
        source_message_id: input.sourceMessageId,
        proposal_type: cls.proposalType,
        target_table: cls.targetTable,
        target_scope: cls.targetScope,
        target_account_id: target.accountId,
        target_opportunity_id: target.opportunityId,
        payload_json: payload,
        rationale: 'User selection saved via Strategy gesture',
        scope_rationale: input.scope,
        dedupe_key: dedupeKeyFor(input.scope, input.thread.id, input.selectionText),
        status: 'pending',
        detector_version: 'selection_gesture_v1',
        detector_confidence: 1,
      })
      .select('id')
      .single();

    if (insertErr || !inserted?.id) {
      // Dedupe collision is fine — treat as "already saved"
      const msg = String(insertErr?.message ?? '');
      if (/duplicate|unique/i.test(msg)) {
        const name = await fetchEntityName(target.accountId, target.opportunityId);
        return { ok: true, message: name ? `Already saved to ${name}` : 'Already saved', openPath: null };
      }
      console.error('[save-gesture] insert failed', insertErr);
      return { ok: false, message: 'Could not save right now', openPath: null };
    }

    const proposalId = inserted.id as string;

    // 2) Confirm with class
    const { error: confirmErr } = await (supabase as any)
      .from('strategy_promotion_proposals')
      .update({
        status: input.scope === 'research' ? 'confirmed_research_only'
          : input.scope === 'crm_contact' ? 'confirmed_crm_contact'
          : 'confirmed_shared_intelligence',
        confirmed_class: cls.promotionClass,
        confirmed_by: user.id,
        confirmed_at: new Date().toISOString(),
      })
      .eq('id', proposalId);

    if (confirmErr) {
      console.error('[save-gesture] confirm failed', confirmErr);
      return { ok: false, message: 'Could not save right now', openPath: null };
    }

    // 3) Promote (skip for research-only — those are durable as proposals)
    let openPath: string | null = null;
    if (input.scope !== 'research') {
      try {
        const { data: prom, error: promErr } = await supabase.functions.invoke('strategy-promote-proposal', {
          body: { proposal_id: proposalId },
        });
        if (promErr || (prom as any)?.error) {
          // Trust failure path — surface as human copy
          const errStr = String((prom as any)?.error ?? promErr?.message ?? '');
          if (/account/i.test(errStr) && /linked|missing/i.test(errStr)) {
            return { ok: false, message: 'Need a linked account before saving this', openPath: null };
          }
          if (/conflict|trust|cross/i.test(errStr)) {
            return { ok: false, message: 'This thread might not match — clone before saving', openPath: null };
          }
          console.error('[save-gesture] promote failed', promErr, prom);
          return { ok: false, message: 'Could not save right now', openPath: null };
        }
        // Build openPath from the promoted record where possible
        if (target.opportunityId) openPath = `/opportunities/${target.opportunityId}`;
        else if (target.accountId) openPath = `/accounts/${target.accountId}`;
      } catch (e) {
        console.error('[save-gesture] promote threw', e);
        return { ok: false, message: 'Could not save right now', openPath: null };
      }
    }

    const name = await fetchEntityName(target.accountId, target.opportunityId);
    const message = input.scope === 'research'
      ? 'Saved as research'
      : name ? `Saved to ${name}` : 'Saved';

    const undo = async () => {
      await (supabase as any)
        .from('strategy_promotion_proposals')
        .update({ status: 'rejected', rejected_reason: 'undo_from_toast' })
        .eq('id', proposalId);
    };

    return { ok: true, message, openPath, undo };
  }, [user]);

  return { save };
}
