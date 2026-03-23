/**
 * Dave tools for prospecting execution engine.
 * Gives Dave the ability to query the daily prospecting plan,
 * suggest next accounts, and guide prospecting workflow.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createProspectingTools(ctx: ToolContext): ToolMap {
  return {
    prospecting_plan: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      // Gather live data for plan summary
      const [accountsRes, contactsRes, journalRes] = await Promise.all([
        supabase.from('accounts').select('id, name, created_at, tier, icp_fit_score, outreach_status, account_status')
          .eq('user_id', userId).order('created_at', { ascending: false }),
        supabase.from('contacts').select('id, created_at').eq('user_id', userId),
        supabase.from('daily_journal_entries').select('date, prospects_added, conversations')
          .eq('user_id', userId).order('date', { ascending: false }).limit(7),
      ]);

      const accounts = accountsRes.data || [];
      const contacts = contactsRes.data || [];
      const journal = journalRes.data || [];

      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const mondayStr = monday.toISOString().split('T')[0];

      const weekAccounts = accounts.filter(a => a.created_at >= mondayStr).length;
      const weekContacts = contacts.filter(c => c.created_at >= mondayStr).length;
      const weekProspects = journal.filter(j => j.date >= mondayStr).reduce((s, j) => s + (j.prospects_added || 0), 0);
      const weekCalls = journal.filter(j => j.date >= mondayStr).reduce((s, j) => s + (j.conversations || 0), 0);
      const daysLeft = Math.max(1, 5 - Math.min(dayOfWeek === 0 ? 5 : dayOfWeek - 1, 5));

      return `Prospecting progress this week:\n` +
        `• Accounts added: ${weekAccounts}/15 (need ${Math.max(0, Math.ceil((15 - weekAccounts) / daysLeft))}/day)\n` +
        `• Contacts added: ${weekContacts}/30\n` +
        `• Cadences launched: ${weekProspects}/10\n` +
        `• Calls made: ${weekCalls}/50\n` +
        `• ${daysLeft} selling days remaining\n` +
        `Next step: ${weekAccounts === 0 ? 'Select your first target account' : weekContacts < weekAccounts * 2 ? 'Find contacts for your newest accounts' : 'Launch cadences for prepped accounts'}`;
    },

    suggest_next_accounts: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accounts } = await supabase
        .from('accounts')
        .select('name, tier, icp_fit_score, outreach_status, account_status, priority_score')
        .eq('user_id', userId)
        .in('account_status', ['researching', 'prepped'])
        .order('priority_score', { ascending: false })
        .limit(5);

      if (!accounts?.length) {
        // Check ICP sourced accounts
        const { data: sourced } = await supabase
          .from('icp_sourced_accounts')
          .select('company_name, fit_score, icp_fit_reason, trigger_signal')
          .eq('user_id', userId)
          .eq('status', 'new')
          .order('fit_score', { ascending: false })
          .limit(5);

        if (sourced?.length) {
          return `No prepped accounts ready. Here are ICP-fit sourced leads to promote:\n` +
            sourced.map((s, i) => `${i + 1}. ${s.company_name} (fit: ${s.fit_score}%) — ${s.icp_fit_reason}${s.trigger_signal ? ` | Signal: ${s.trigger_signal}` : ''}`).join('\n');
        }
        return 'No target accounts ready. Consider running ICP Account Sourcing to find new prospects.';
      }

      return `Recommended next accounts to work:\n` +
        accounts.map((a, i) =>
          `${i + 1}. ${a.name} — Tier ${a.tier || '?'}, ICP ${a.icp_fit_score || '?'}%, Status: ${a.account_status || 'unknown'}`
        ).join('\n') +
        `\nPick 1-3 to start prospecting.`;
    },

    prospecting_next_step: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      // Check what's in progress
      const { data: recent } = await supabase
        .from('accounts')
        .select('name, account_status, outreach_status, contact_status')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(3);

      if (!recent?.length) return 'Start by selecting a target account. Say "suggest next accounts" for recommendations.';

      const top = recent[0];
      if (top.contact_status === 'not-started') {
        return `Your most recent account "${top.name}" needs contacts. Say "discover contacts for ${top.name}" to find key people.`;
      }
      if (top.outreach_status === 'not-started') {
        return `"${top.name}" has contacts but no outreach started. Time to launch a cadence or make a call.`;
      }
      return `"${top.name}" is in ${top.outreach_status} status. Next: check response rates or follow up. Say "account status for ${top.name}" for details.`;
    },
  };
}
