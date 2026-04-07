/**
 * Dave tools for step-driven prospecting execution engine.
 * Surfaces cycle state, suggests next accounts, and guides step-by-step workflow.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createProspectingTools(ctx: ToolContext): ToolMap {
  return {
    prospecting_plan: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const [accountsRes, contactsRes, journalRes] = await Promise.all([
        supabase.from('accounts').select('id, name, created_at, tier, icp_fit_score, outreach_status, account_status')
          .eq('user_id', userId).is('deleted_at', null).order('created_at', { ascending: false }),
        supabase.from('contacts').select('id, created_at').eq('user_id', userId),
        supabase.from('daily_journal_entries').select('date, prospects_added, conversations')
          .eq('user_id', userId).order('date', { ascending: false }).limit(7),
      ]);

      const accounts = accountsRes.data || [];
      const contacts = contactsRes.data || [];
      const journal = journalRes.data || [];

      const now = new Date();
      const dow = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
      const mondayStr = monday.toISOString().split('T')[0];

      const weekAccts = accounts.filter(a => a.created_at >= mondayStr).length;
      const weekContacts = contacts.filter(c => c.created_at >= mondayStr).length;
      const weekCadences = journal.filter(j => j.date >= mondayStr).reduce((s, j) => s + (j.prospects_added || 0), 0);
      const weekCalls = journal.filter(j => j.date >= mondayStr).reduce((s, j) => s + (j.conversations || 0), 0);
      const daysLeft = Math.max(1, 5 - Math.min(dow === 0 ? 5 : dow - 1, 5));

      // Determine where user is in the prospecting cycle
      const needsAccounts = weekAccts < 3;
      const needsContacts = weekContacts < weekAccts * 2;
      const needsCadences = weekCadences < weekAccts;

      let nextStep: string;
      if (needsAccounts) nextStep = 'Select your next target account — say "suggest next accounts" for top picks';
      else if (needsContacts) nextStep = 'Find contacts for your newest accounts — say "discover contacts for [account]"';
      else if (needsCadences) nextStep = 'Launch cadences for prepped accounts — start outreach today';
      else nextStep = 'Make calls — connect with contacts already in cadence';

      return `Prospecting this week:\n` +
        `• Accounts: ${weekAccts}/15 (${Math.ceil(Math.max(0, 15 - weekAccts) / daysLeft)}/day needed)\n` +
        `• Contacts: ${weekContacts}/30\n` +
        `• Cadences: ${weekCadences}/10\n` +
        `• Calls: ${weekCalls}/50\n` +
        `• ${daysLeft} days left\n\n` +
        `Next step: ${nextStep}`;
    },

    suggest_next_accounts: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      // First check prepped/researching accounts
      const { data: ready } = await supabase
        .from('accounts')
        .select('name, tier, icp_fit_score, account_status, priority_score')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .in('account_status', ['researching', 'prepped'])
        .order('priority_score', { ascending: false })
        .limit(5);

      if (ready?.length) {
        return `Top accounts ready to work:\n` +
          ready.map((a, i) =>
            `${i + 1}. ${a.name} — Tier ${a.tier || '?'}, ICP ${a.icp_fit_score || '?'}%`
          ).join('\n') +
          `\n\nPick one and say "I'm working on [account name]" to start the cycle.`;
      }

      // Fallback to ICP sourced
      const { data: sourced } = await supabase
        .from('icp_sourced_accounts')
        .select('company_name, fit_score, icp_fit_reason, trigger_signal')
        .eq('user_id', userId).eq('status', 'new')
        .order('fit_score', { ascending: false }).limit(5);

      if (sourced?.length) {
        return `No prepped accounts. Promote from sourced leads:\n` +
          sourced.map((s, i) => `${i + 1}. ${s.company_name} (${s.fit_score}% fit) — ${s.icp_fit_reason}`).join('\n');
      }

      return 'No accounts ready. Run ICP sourcing first, or add an account manually.';
    },

    prospecting_next_step: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      // Find the most recently updated account to determine where user is
      const { data: recent } = await supabase
        .from('accounts')
        .select('name, account_status, outreach_status, contact_status')
        .eq('user_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (!recent?.length) return 'Step 1: Select a target account. Say "suggest next accounts" for recommendations.';

      const acct = recent[0];

      // Walk through the step sequence
      if (acct.contact_status === 'not-started' || !acct.contact_status) {
        return `Step 2 for "${acct.name}": Find contacts. Say "discover contacts for ${acct.name}" to identify 2-3 decision-makers.`;
      }
      if (acct.outreach_status === 'not-started' || !acct.outreach_status) {
        return `Step 5 for "${acct.name}": Launch a cadence. Update the outreach status or say "update outreach status for ${acct.name} to in-progress".`;
      }
      if (acct.outreach_status === 'in-progress' || acct.outreach_status === 'working') {
        return `Step 6 for "${acct.name}": Make a call. Connect with a contact and log the touch. Then start a new cycle with another account.`;
      }

      return `"${acct.name}" is in ${acct.outreach_status} status. Start a new prospecting cycle — say "suggest next accounts".`;
    },
  };
}
