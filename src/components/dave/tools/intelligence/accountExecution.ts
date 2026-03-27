/**
 * Dave Account Execution Tools
 *
 * Lets Dave read and write account-level execution state:
 * - mark accounts as prepped
 * - log call outcomes (voicemail, connected, meeting booked, etc.)
 * - query what's ready / prepped / carry-forward
 * - mark carry-forward
 */

import type { ToolContext, ToolMap } from '../../toolTypes';
import { todayInAppTz } from '@/lib/timeFormat';
import { isAccountExecutionModelEnabled } from '@/lib/featureFlags';
import {
  markAccountPrepped,
  recordAccountOutcome,
  getPreppedAccounts,
  getUnworkedPreppedAccounts,
  getWorkedAccounts,
  buildExecutionSummary,
  buildCarryForward,
  loadAccountStates,
  getRecentOutcomePatterns,
  type OutcomeType,
} from '@/lib/accountExecutionState';

export function createAccountExecutionTools(ctx: ToolContext): ToolMap {
  return {
    mark_account_prepped: async (params: { accountName: string }) => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const today = todayInAppTz();
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated.';
      // Find account by name
      const { supabase } = await import('@/integrations/supabase/client');
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', params.accountName)
        .limit(1);
      const account = accounts?.[0];
      if (!account) return `Could not find account "${params.accountName}" in your book.`;

      markAccountPrepped(today, account.id, account.name, null, null);
      return `✅ ${account.name} marked as prepped and ready to call.`;
    },

    log_call_outcome: async (params: {
      accountName: string;
      outcome: string;
      notes?: string;
    }) => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const today = todayInAppTz();
      const account = ctx.accounts?.find(
        a => a.name.toLowerCase() === params.accountName.toLowerCase(),
      );
      if (!account) return `Could not find account "${params.accountName}".`;

      const validOutcomes: OutcomeType[] = [
        'no_answer', 'voicemail', 'connected', 'meeting_booked',
        'follow_up_needed', 'bad_fit', 'not_now',
      ];
      const outcomeType = params.outcome.toLowerCase().replace(/[\s-]/g, '_') as OutcomeType;
      if (!validOutcomes.includes(outcomeType)) {
        return `Invalid outcome. Use one of: ${validOutcomes.join(', ')}`;
      }

      const entry = recordAccountOutcome(
        today, account.id, account.name, null, null, outcomeType, params.notes || null,
      );

      const labels: Record<string, string> = {
        no_answer: '📵 No answer',
        voicemail: '📞 Voicemail left',
        connected: '🤝 Connected',
        meeting_booked: '🎯 Meeting booked!',
        follow_up_needed: '📋 Follow-up needed',
        bad_fit: '❌ Bad fit',
        not_now: '⏳ Not now',
      };

      let response = `${labels[outcomeType] || outcomeType} logged for ${account.name}.`;
      if (entry.carryForward) {
        response += ` This account will carry forward (${entry.carryForwardReason}).`;
      }
      if (entry.nextRecommendedAction === 'retry_later') {
        response += ` Retry later — attempt #${entry.callAttemptCount}.`;
      }
      return response;
    },

    get_account_readiness: async () => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const today = todayInAppTz();
      const summary = buildExecutionSummary(today);

      if (summary.totalAccounts === 0) {
        return 'No account execution state tracked today yet. Accounts get tracked when prep or action blocks are completed.';
      }

      const lines = [
        `📊 Today's Account Execution Summary:`,
        `• ${summary.preppedCount} prepped`,
        `• ${summary.readyToCallCount} ready to call`,
        `• ${summary.workedCount} worked`,
        `• ${summary.unworkedPreppedCount} prepped but not called yet`,
        `• ${summary.carryForwardCount} carrying forward`,
      ];

      if (Object.keys(summary.outcomeCounts).length > 0) {
        lines.push('', 'Outcomes:');
        for (const [type, count] of Object.entries(summary.outcomeCounts)) {
          lines.push(`  • ${type.replace(/_/g, ' ')}: ${count}`);
        }
      }

      return lines.join('\n');
    },

    get_ready_accounts: async () => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const today = todayInAppTz();
      const ready = getUnworkedPreppedAccounts(today);

      if (ready.length === 0) {
        return 'No prepped-and-ready accounts waiting. Complete a prep block first.';
      }

      const list = ready.map(a => `• ${a.accountName}`).join('\n');
      return `${ready.length} account${ready.length !== 1 ? 's' : ''} ready for your next call block:\n${list}`;
    },

    get_carry_forward: async () => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const today = todayInAppTz();
      const carry = buildCarryForward(today);

      if (carry.length === 0) return 'No accounts carrying forward today.';

      const list = carry.map(a =>
        `• ${a.accountName} — ${a.carryForwardReason || 'unworked'}`,
      ).join('\n');
      return `${carry.length} account${carry.length !== 1 ? 's' : ''} carrying forward:\n${list}`;
    },

    get_outcome_patterns: async () => {
      if (!isAccountExecutionModelEnabled()) return 'Account execution model is not enabled yet.';
      const patterns = getRecentOutcomePatterns(7);

      if (patterns.length === 0) return 'No outcome patterns yet — log some call outcomes first.';

      const lines = ['📈 Outcome patterns (last 7 days):'];
      for (const p of patterns.slice(0, 5)) {
        lines.push(`• ${(p.outcomeType || 'unknown').replace(/_/g, ' ')}: ${p.frequency}x (last: ${p.lastSeen})`);
      }
      return lines.join('\n');
    },
  };
}
