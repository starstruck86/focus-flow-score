/**
 * Dave Execution Session Tools
 *
 * Dave fully participates in the active account session:
 * "work Acme", "next account", "what's left in this block?", "log voicemail"
 */

import type { ToolContext, ToolMap } from '../../toolTypes';
import { todayInAppTz } from '@/lib/timeFormat';
import { isExecutionSessionLayerEnabled } from '@/lib/featureFlags';
import {
  useExecutionSession,
  getNextBestAccounts,
  buildScorecard,
  runEndOfBlockCleanup,
  deriveEngagementStage,
  buildTrustExplanation,
} from '@/lib/executionSession';
import { getAccountState } from '@/lib/accountExecutionState';

async function resolveAccount(ctx: ToolContext, accountName: string) {
  const userId = await ctx.getUserId();
  if (!userId) return null;
  const { supabase } = await import('@/integrations/supabase/client');
  const { data } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('user_id', userId)
    .ilike('name', `%${accountName}%`)
    .limit(1);
  return data?.[0] || null;
}

export function createExecutionSessionTools(ctx: ToolContext): ToolMap {
  if (!isExecutionSessionLayerEnabled()) return {};

  return {
    work_account: async (params: { accountName: string }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const store = useExecutionSession.getState();
      store.activateAccount(acct.id, acct.name, 'action', null);
      store.refreshScorecard();

      const today = todayInAppTz();
      const state = getAccountState(today, acct.id);
      const prep = state?.prepStatus || 'unknown';
      const attempts = state?.callAttemptCount || 0;

      return `🎯 Now working ${acct.name}.\nPrep: ${prep} | Attempts today: ${attempts}\nReady for action.`;
    },

    next_account: async () => {
      const store = useExecutionSession.getState();
      const candidates = getNextBestAccounts();
      const currentId = store.activeSession?.accountId;
      const next = candidates.find(c => c.accountId !== currentId);

      if (!next) return 'No more accounts ready right now.';

      store.activateAccount(next.accountId, next.accountName, 'action', store.activeSession?.loopId || null);
      store.refreshScorecard();

      const today = todayInAppTz();
      const state = getAccountState(today, next.accountId);
      const trust = buildTrustExplanation(next, state || null);

      return `➡️ Moving to ${next.accountName}.\nWhy: ${trust.whyThisAccount}\n${trust.whyThisAction}\nSource: ${trust.sourceOfTruth}`;
    },

    session_log_outcome: async (params: { outcome: string; notes?: string }) => {
      const store = useExecutionSession.getState();
      if (!store.activeSession) return 'No active account session. Use "work [account]" first.';

      const outcomeType = params.outcome as any;
      store.logOutcome(outcomeType, params.notes || null, null);

      const session = useExecutionSession.getState().activeSession;
      const rec = session?.postActionRecommendation;
      const lines = [`✅ Logged ${params.outcome.replace(/_/g, ' ')} on ${session?.accountName}.`];
      if (rec) lines.push(`→ Recommendation: ${rec.decision.replace(/_/g, ' ')} (${rec.confidence})`);
      return lines.join('\n');
    },

    whats_left: async () => {
      const cleanup = runEndOfBlockCleanup();
      const score = buildScorecard();

      const lines = [
        `📊 Block status:`,
        `Worked: ${cleanup.workedCount} | Ready: ${cleanup.readyRemaining} | Carry-forward: ${cleanup.carryForwardCount}`,
        `Connects: ${score.connects} | Meetings: ${score.meetingsBooked}`,
      ];
      if (cleanup.needsOpportunityAction > 0) {
        lines.push(`💡 ${cleanup.needsOpportunityAction} account(s) may need opportunity action.`);
      }
      return lines.join('\n');
    },

    session_scorecard: async () => {
      const score = buildScorecard();
      return [
        `📈 Today's score:`,
        `Accounts worked: ${score.accountsWorked}`,
        `Attempts: ${score.attempts} | Connects: ${score.connects}`,
        `Meetings booked: ${score.meetingsBooked}`,
        `Ready remaining: ${score.readyRemaining}`,
        `Carry-forward: ${score.carryForwardCreated}`,
      ].join('\n');
    },

    why_this_account: async () => {
      const store = useExecutionSession.getState();
      if (!store.activeSession) return 'No active account right now.';

      const today = todayInAppTz();
      const state = getAccountState(today, store.activeSession.accountId);
      const candidates = getNextBestAccounts();
      const candidate = candidates.find(c => c.accountId === store.activeSession?.accountId);

      if (!candidate) return `${store.activeSession.accountName} is the active account (manually selected).`;

      const trust = buildTrustExplanation(candidate, state || null);
      return `🎯 ${store.activeSession.accountName}\nWhy: ${trust.whyThisAccount}\n${trust.whyThisAction}\nSource: ${trust.sourceOfTruth}`;
    },

    end_block: async () => {
      const cleanup = runEndOfBlockCleanup();
      const store = useExecutionSession.getState();
      store.clearSession();
      store.refreshScorecard();

      return [
        `✅ Block complete.`,
        `Worked: ${cleanup.workedCount} | Carry-forward: ${cleanup.carryForwardCount}`,
        cleanup.needsOpportunityAction > 0
          ? `💡 ${cleanup.needsOpportunityAction} account(s) need opportunity review.`
          : '',
        cleanup.prioritizedForNext.length > 0
          ? `Next session priorities: ${cleanup.prioritizedForNext.length} account(s) queued.`
          : '',
      ].filter(Boolean).join('\n');
    },
  };
}
