/**
 * Dave Account-Centric Tools
 *
 * Makes Dave account-first: "work Acme", "what's next for Acme",
 * "does Acme look like an opportunity?", "what changed on Acme?"
 */

import type { ToolContext, ToolMap } from '../../toolTypes';
import { todayInAppTz } from '@/lib/timeFormat';
import { isAccountCentricExecutionEnabled, isAccountExecutionModelEnabled } from '@/lib/featureFlags';
import { getAccountState } from '@/lib/accountExecutionState';
import { buildAccountWorkingSummary } from '@/lib/accountWorkingSummary';
import { getPostActionRecommendation, evaluateOpportunityEscalation } from '@/lib/accountPostAction';
import { getRecentEvents, getTimelineSummary } from '@/lib/accountTimeline';

async function resolveAccount(ctx: ToolContext, accountName: string) {
  const userId = await ctx.getUserId();
  if (!userId) return null;
  const { supabase } = await import('@/integrations/supabase/client');
  const { data } = await supabase
    .from('accounts')
    .select('id, name')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .ilike('name', `%${accountName}%`)
    .limit(1);
  return data?.[0] ? { ...data[0], userId } : null;
}

export function createAccountCentricTools(ctx: ToolContext): ToolMap {
  return {
    account_summary: async (params: { accountName: string }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const summary = await buildAccountWorkingSummary(acct.userId, acct.id);
      if (!summary) return `Could not build summary for ${acct.name}.`;

      const lines = [
        `📋 ${summary.accountName}`,
        `Industry: ${summary.industry || 'unknown'} | Tier: ${summary.tier || '?'} | Motion: ${summary.motion || '?'}`,
        `Prep: ${summary.prepStatus} | Action: ${summary.actionStatus}`,
        `Next: ${summary.nextRecommendedAction.replace(/_/g, ' ')}`,
        `Attempts: ${summary.callAttemptCount} | Connects: ${summary.connectCount}`,
      ];

      if (summary.latestOutcome) {
        lines.push(`Last outcome: ${summary.latestOutcome.replace(/_/g, ' ')}`);
      }
      if (summary.carryForward) {
        lines.push(`⏩ Carrying forward (${summary.carryForwardReason})`);
      }
      if (summary.hasOpportunity && summary.primaryOpportunity) {
        const o = summary.primaryOpportunity;
        lines.push(`💼 Opp: ${o.opportunityName} — ${o.stage || 'no stage'} (${o.status})`);
      } else {
        lines.push('No active opportunity.');
      }

      return lines.join('\n');
    },

    account_next_action: async (params: { accountName: string }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const today = todayInAppTz();
      const execState = getAccountState(today, acct.id);
      if (!execState) return `No execution state for ${acct.name} today. Complete a prep or action block first.`;

      const summary = await buildAccountWorkingSummary(acct.userId, acct.id);
      const rec = getPostActionRecommendation(execState, summary);

      return `➡️ ${acct.name}: ${rec.reason}\nRecommendation: ${rec.decision.replace(/_/g, ' ')} (${rec.confidence} confidence)`;
    },

    account_opportunity_check: async (params: { accountName: string }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const summary = await buildAccountWorkingSummary(acct.userId, acct.id);
      if (!summary) return `Could not build summary for ${acct.name}.`;

      const escalation = evaluateOpportunityEscalation(summary);

      if (escalation.type === 'no_escalation' || escalation.type === 'defer') {
        return `${acct.name}: ${escalation.reason}`;
      }

      return `💡 ${acct.name}: ${escalation.reason}\nSuggested: ${escalation.suggestedAction} (${escalation.confidence} confidence)`;
    },

    account_history: async (params: { accountName: string; days?: number }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const events = getRecentEvents(acct.id, 15);
      if (events.length === 0) return `No recorded history for ${acct.name} yet.`;

      const lines = [`📜 Recent history for ${acct.name}:`];
      for (const e of events.slice(-10)) {
        const label = e.eventType.replace(/_/g, ' ');
        lines.push(`  ${e.date} — ${label}${e.notes ? ': ' + e.notes : ''}`);
      }
      return lines.join('\n');
    },

    account_what_changed: async (params: { accountName: string }) => {
      const acct = await resolveAccount(ctx, params.accountName);
      if (!acct) return `Could not find account "${params.accountName}".`;

      const today = todayInAppTz();
      const todayEvents = getRecentEvents(acct.id).filter(e => e.date === today);

      if (todayEvents.length === 0) return `Nothing recorded for ${acct.name} today.`;

      const lines = [`Today on ${acct.name}:`];
      for (const e of todayEvents) {
        lines.push(`• ${e.eventType.replace(/_/g, ' ')}${e.notes ? ' — ' + e.notes : ''}`);
      }
      return lines.join('\n');
    },
  };
}
