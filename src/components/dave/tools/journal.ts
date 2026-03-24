import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitMetricsUpdated } from '@/lib/daveEvents';
import { METRIC_MAP } from '../toolTypes';
import type { ToolContext, ToolMap } from '../toolTypes';
import type { DailyJournalRow } from '@/types/supabase-helpers';

export function createJournalTools(ctx: ToolContext): ToolMap {
  return {
    update_daily_metrics: async (params: { metric: string; value: number; mode?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const dbField = METRIC_MAP[params.metric.toLowerCase()] || METRIC_MAP[params.metric.toLowerCase().replace(/_/g, ' ')];
      if (!dbField) return `Unknown metric "${params.metric}". Try: calls, connects, emails, meetings, prospects, customer meetings, opps created, accounts researched, contacts prepped.`;

      const today = new Date().toISOString().split('T')[0];
      const mode = params.mode || 'add';

      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      let oldValue = 0;
      let newValue = params.value;

      if (existing?.length) {
        const row = existing[0];
        oldValue = (row[dbField as keyof DailyJournalRow] as number) || 0;
        newValue = mode === 'add' ? oldValue + params.value : params.value;
        const { error } = await supabase
          .from('daily_journal_entries')
          .update({ [dbField]: newValue, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id);
        if (error) return `Failed to update: ${error.message}`;
      } else {
        const { error } = await supabase
          .from('daily_journal_entries')
          .insert({ user_id: userId, date: today, [dbField]: newValue });
        if (error) return `Failed to create entry: ${error.message}`;
      }

      const label = params.metric.charAt(0).toUpperCase() + params.metric.slice(1);
      toast.success(`${label} updated`, { description: `${oldValue} → ${newValue} (${mode === 'add' ? '+' : '='}${params.value})` });
      emitMetricsUpdated({ [dbField]: newValue });
      return `Updated ${params.metric}: ${oldValue} → ${newValue}`;
    },

    get_daily_metrics: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_journal_entries')
        .select('dials, conversations, meetings_set, manual_emails, prospects_added, customer_meetings_held, opportunities_created, accounts_researched, contacts_prepped, checked_in, daily_score, goal_met')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (!data?.length) return 'No journal entry for today yet. All metrics at zero.';
      const d = data[0];
      return `Today's metrics: ${d.dials} dials, ${d.conversations} connects, ${d.meetings_set} meetings set, ${d.manual_emails} emails, ${d.prospects_added} prospects added, ${d.customer_meetings_held} customer meetings, ${d.opportunities_created} opps created, ${d.accounts_researched} accounts researched, ${d.contacts_prepped} contacts prepped. Checked in: ${d.checked_in ? 'yes' : 'no'}. Daily score: ${d.daily_score ?? 'not set'}. Goal met: ${d.goal_met ? 'yes' : 'no'}.`;
    },

    log_reflection: async (params: { whatWorked?: string; blocker?: string; tomorrowPriority?: string; reflection?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const updates: Record<string, string> = { updated_at: new Date().toISOString() };
      if (params.whatWorked) updates.what_worked_today = params.whatWorked;
      if (params.blocker) updates.biggest_blocker = params.blocker;
      if (params.tomorrowPriority) updates.tomorrow_priority = params.tomorrowPriority;
      if (params.reflection) updates.daily_reflection = params.reflection;

      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        await supabase.from('daily_journal_entries').update(updates).eq('id', existing[0].id);
      } else {
        await supabase.from('daily_journal_entries').insert({ user_id: userId, date: today, ...updates });
      }

      toast.success('Reflection logged');
      emitMetricsUpdated({ reflection: true });
      return 'Reflection captured for today.';
    },

    check_in: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id, checked_in')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        if (existing[0].checked_in) return 'Already checked in for today.';
        await supabase.from('daily_journal_entries')
          .update({ checked_in: true, check_in_timestamp: now, updated_at: now })
          .eq('id', existing[0].id);
      } else {
        await supabase.from('daily_journal_entries')
          .insert({ user_id: userId, date: today, checked_in: true, check_in_timestamp: now });
      }

      toast.success('Checked in ✓');
      return 'Checked in for today. Let\'s get after it.';
    },

    guided_journal: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      const entry = data?.[0] ?? null;
      const missing: string[] = [];
      const completed: string[] = [];

      const metrics = [
        { field: 'dials' as const, label: 'Dials', default: 0 },
        { field: 'conversations' as const, label: 'Connects/Conversations', default: 0 },
        { field: 'manual_emails' as const, label: 'Manual Emails', default: 0 },
        { field: 'meetings_set' as const, label: 'Meetings Set', default: 0 },
        { field: 'customer_meetings_held' as const, label: 'Customer Meetings Held', default: 0 },
        { field: 'opportunities_created' as const, label: 'Opportunities Created', default: 0 },
        { field: 'prospects_added' as const, label: 'Prospects Added', default: 0 },
        { field: 'accounts_researched' as const, label: 'Accounts Researched', default: 0 },
        { field: 'contacts_prepped' as const, label: 'Contacts Prepped', default: 0 },
      ];

      for (const m of metrics) {
        const val = entry?.[m.field] ?? m.default;
        if (val === 0 || val === m.default) missing.push(`📊 ${m.label} (currently ${val})`);
        else completed.push(`✅ ${m.label}: ${val}`);
      }

      const qualFields = [
        { field: 'what_worked_today' as const, label: 'What worked today' },
        { field: 'biggest_blocker' as const, label: 'Biggest blocker' },
        { field: 'tomorrow_priority' as const, label: 'Tomorrow\'s top priority' },
        { field: 'daily_reflection' as const, label: 'Daily reflection' },
      ];
      for (const q of qualFields) {
        if (!entry?.[q.field]) missing.push(`💬 ${q.label}`);
        else completed.push(`✅ ${q.label}`);
      }

      const wellnessFields = [
        { field: 'energy' as const, label: 'Energy level (1-5)' },
        { field: 'focus_quality' as const, label: 'Focus quality (1-5)' },
        { field: 'stress' as const, label: 'Stress level (1-5)' },
      ];
      for (const w of wellnessFields) {
        if (!entry?.[w.field]) missing.push(`🧠 ${w.label}`);
        else completed.push(`✅ ${w.label}: ${entry[w.field]}`);
      }

      if (!entry?.personal_development) missing.push('📚 Personal development (yes/no)');
      else completed.push('✅ Personal development');

      if (!entry) {
        return `No journal entry for today yet. Let's walk through it step by step.\n\nMISSING (${missing.length}):\n${missing.join('\n')}\n\nStart by asking about the activity metrics first (dials, connects, emails, etc.), then move to reflections and wellness.`;
      }

      return `Journal progress for today:\n\nCOMPLETED (${completed.length}):\n${completed.join('\n')}\n\nSTILL NEEDED (${missing.length}):\n${missing.join('\n')}\n\nAsk about the missing items one by one, starting with activity metrics.`;
    },

    update_journal_field: async (params: { field: string; value: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const JOURNAL_FIELDS: Record<string, { column: string; type: 'text' | 'number' | 'boolean' }> = {
        what_worked_today: { column: 'what_worked_today', type: 'text' },
        what_worked: { column: 'what_worked_today', type: 'text' },
        biggest_blocker: { column: 'biggest_blocker', type: 'text' },
        blocker: { column: 'biggest_blocker', type: 'text' },
        tomorrow_priority: { column: 'tomorrow_priority', type: 'text' },
        tomorrow: { column: 'tomorrow_priority', type: 'text' },
        daily_reflection: { column: 'daily_reflection', type: 'text' },
        reflection: { column: 'daily_reflection', type: 'text' },
        energy: { column: 'energy', type: 'number' },
        focus_quality: { column: 'focus_quality', type: 'number' },
        focus: { column: 'focus_quality', type: 'number' },
        stress: { column: 'stress', type: 'number' },
        personal_development: { column: 'personal_development', type: 'boolean' },
        clarity: { column: 'clarity', type: 'number' },
        what_drained_you: { column: 'what_drained_you', type: 'text' },
        drained: { column: 'what_drained_you', type: 'text' },
      };

      const fieldDef = JOURNAL_FIELDS[params.field.toLowerCase().replace(/\s+/g, '_')];
      if (!fieldDef) return `Unknown journal field "${params.field}". Valid: ${Object.keys(JOURNAL_FIELDS).filter(k => !k.includes('_') || k === params.field).join(', ')}`;

      let dbValue: string | number | boolean;
      if (fieldDef.type === 'number') {
        dbValue = parseInt(params.value) || 0;
        if (['energy', 'focus_quality', 'stress', 'clarity'].includes(fieldDef.column)) {
          dbValue = Math.max(1, Math.min(5, dbValue));
        }
      } else if (fieldDef.type === 'boolean') {
        dbValue = ['yes', 'true', '1', 'yeah', 'yep'].includes(params.value.toLowerCase());
      } else {
        dbValue = params.value;
      }

      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        const { error } = await supabase
          .from('daily_journal_entries')
          .update({ [fieldDef.column]: dbValue, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id);
        if (error) return `Failed to update: ${error.message}`;
      } else {
        const { error } = await supabase
          .from('daily_journal_entries')
          .insert({ user_id: userId, date: today, [fieldDef.column]: dbValue });
        if (error) return `Failed to create entry: ${error.message}`;
      }

      emitMetricsUpdated({ [fieldDef.column]: dbValue });
      toast.success('Journal updated', { description: `${params.field}: ${params.value}` });
      return `Updated ${params.field} to "${params.value}"`;
    },
  };
}
