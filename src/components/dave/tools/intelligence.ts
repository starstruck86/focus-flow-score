import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import { ACCOUNT_FIELDS } from '../toolTypes';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createIntelligenceTools(ctx: ToolContext): ToolMap {
  return {
    search_crm: async (params: { query: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const q = `%${params.query}%`;
      const [accts, opps, contacts, transcripts] = await Promise.all([
        supabase.from('accounts').select('name, tier, account_status').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},industry.ilike.${q}`).limit(5),
        supabase.from('opportunities').select('name, stage, arr').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},next_step.ilike.${q}`).limit(5),
        supabase.from('contacts').select('name, title, email').eq('user_id', userId).or(`name.ilike.${q},title.ilike.${q},email.ilike.${q}`).limit(5),
        supabase.from('call_transcripts').select('title, call_date, summary').eq('user_id', userId).or(`title.ilike.${q},content.ilike.${q},summary.ilike.${q}`).limit(5),
      ]);

      const results: string[] = [];
      if (accts.data?.length) results.push(`Accounts: ${accts.data.map(a => `${a.name} [${a.tier || '—'}]`).join(', ')}`);
      if (opps.data?.length) results.push(`Deals: ${opps.data.map(o => `${o.name} (${o.stage || '—'}, $${Math.round((o.arr || 0) / 1000)}k)`).join(', ')}`);
      if (contacts.data?.length) results.push(`Contacts: ${contacts.data.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}`).join(', ')}`);
      if (transcripts.data?.length) results.push(`Transcripts: ${transcripts.data.map(t => `${t.title} (${t.call_date})`).join(', ')}`);

      if (!results.length) return `No results found for "${params.query}"`;
      return `Search results for "${params.query}":\n${results.join('\n')}`;
    },

    lookup_contact: async (params: { accountName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase.from('accounts').select('id, name').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { data: contacts } = await supabase.from('contacts').select('name, title, email, buyer_role, influence_level, department, status').eq('account_id', accts[0].id).limit(20);

      if (!contacts?.length) return `No contacts found for ${accts[0].name}`;
      return `Contacts at ${accts[0].name}:\n` + contacts.map(c =>
        `• ${c.name}${c.title ? ` (${c.title})` : ''}${c.department ? ` — ${c.department}` : ''}${c.buyer_role ? ` [${c.buyer_role}]` : ''}${c.email ? ` ${c.email}` : ''}`
      ).join('\n');
    },

    add_contact: async (params: { name: string; title?: string; email?: string; accountName?: string; department?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase.from('accounts').select('id').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
        accountId = accts?.[0]?.id ?? null;
      }

      const { error } = await supabase.from('contacts').insert({
        user_id: userId,
        name: params.name,
        title: params.title || null,
        email: params.email || null,
        account_id: accountId,
        department: params.department || null,
        discovery_source: 'voice',
      });

      if (error) return `Failed to add contact: ${error.message}`;
      emitDataChanged('contacts');
      toast.success('Contact added', { description: `${params.name}${params.title ? ` — ${params.title}` : ''}` });
      return `Added contact ${params.name}${params.accountName ? ` at ${params.accountName}` : ''}`;
    },

    lookup_transcript: async (params: { accountName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase.from('accounts').select('id, name').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { data: transcripts } = await supabase.from('call_transcripts').select('title, call_date, call_type, summary, participants, duration_minutes').eq('account_id', accts[0].id).order('call_date', { ascending: false }).limit(5);

      if (!transcripts?.length) return `No call transcripts found for ${accts[0].name}`;
      return `Recent calls with ${accts[0].name}:\n` +
        transcripts.map(t => `• ${t.call_date}: ${t.title} (${t.call_type || 'call'}${t.duration_minutes ? `, ${t.duration_minutes}min` : ''})${t.summary ? `\n  Summary: ${t.summary.slice(0, 150)}` : ''}`).join('\n');
    },

    lookup_renewal: async (params: { timeframe?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      let endDate: Date;
      const tf = (params.timeframe || 'quarter').toLowerCase();
      if (tf.includes('month')) endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      else if (tf.includes('year')) endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      else endDate = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());

      const { data: renewals } = await supabase.from('renewals').select('account_name, arr, renewal_due, health_status, churn_risk, renewal_stage, next_step').eq('user_id', userId).gte('renewal_due', now.toISOString().split('T')[0]).lte('renewal_due', endDate.toISOString().split('T')[0]).order('renewal_due').limit(20);

      if (!renewals?.length) return `No renewals found in the next ${tf}.`;
      const totalArr = renewals.reduce((s, r) => s + Number(r.arr || 0), 0);
      return `${renewals.length} renewals ($${Math.round(totalArr / 1000)}k) in the next ${tf}:\n` +
        renewals.map(r => `• ${r.account_name}: $${Math.round(Number(r.arr || 0) / 1000)}k due ${r.renewal_due} [${r.health_status || '—'}/${r.churn_risk || '—'}]${r.next_step ? ` → ${r.next_step}` : ''}`).join('\n');
    },

    update_renewal: async (params: { accountName: string; field: string; value: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const RENEWAL_FIELDS: Record<string, string> = {
        health: 'health_status', 'health status': 'health_status',
        risk: 'churn_risk', 'churn risk': 'churn_risk',
        'risk reason': 'risk_reason',
        stage: 'renewal_stage', 'renewal stage': 'renewal_stage',
        'next step': 'next_step', next_step: 'next_step',
        notes: 'notes',
      };

      const dbField = RENEWAL_FIELDS[params.field.toLowerCase()];
      if (!dbField) return `Invalid renewal field "${params.field}". Valid: ${Object.keys(RENEWAL_FIELDS).join(', ')}`;

      const { data: renewals } = await supabase.from('renewals').select('id, account_name').eq('user_id', userId).ilike('account_name', `%${params.accountName}%`).limit(1);
      if (!renewals?.length) return `Renewal for "${params.accountName}" not found`;

      const { error } = await supabase.from('renewals').update({ [dbField]: params.value, updated_at: new Date().toISOString() }).eq('id', renewals[0].id);

      if (error) return `Failed to update renewal: ${error.message}`;
      emitDataChanged('renewals');
      toast.success('Renewal updated', { description: `${renewals[0].account_name}: ${params.field} → ${params.value}` });
      return `Updated ${renewals[0].account_name} renewal ${params.field} to ${params.value}`;
    },

    stakeholder_query: async (params: { accountName: string; role?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase.from('accounts').select('id, name').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
      if (!accts?.length) return `Account "${params.accountName}" not found`;

      let query = supabase.from('contacts').select('name, title, department, buyer_role, influence_level, email, reporting_to, status, seniority').eq('account_id', accts[0].id);
      if (params.role) query = query.or(`buyer_role.ilike.%${params.role}%,title.ilike.%${params.role}%`);

      const { data: contacts } = await query.limit(20);
      if (!contacts?.length) return `No stakeholders found at ${accts[0].name}${params.role ? ` matching "${params.role}"` : ''}`;

      const byInfluence = contacts.sort((a, b) => {
        const levels: Record<string, number> = { high: 3, medium: 2, low: 1 };
        return (levels[b.influence_level || ''] || 0) - (levels[a.influence_level || ''] || 0);
      });

      return `Stakeholders at ${accts[0].name}:\n` +
        byInfluence.map(c =>
          `• ${c.name}${c.title ? ` — ${c.title}` : ''}${c.department ? ` (${c.department})` : ''}\n  Role: ${c.buyer_role || '—'} | Influence: ${c.influence_level || '—'} | Status: ${c.status || '—'}${c.reporting_to ? ` | Reports to: ${c.reporting_to}` : ''}`
        ).join('\n');
    },

    contact_timeline: async (params: { contactName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: contacts } = await supabase.from('contacts').select('id, name, title, account_id, last_touch_date').eq('user_id', userId).ilike('name', `%${params.contactName}%`).limit(1);
      if (!contacts?.length) return `Contact matching "${params.contactName}" not found`;
      const contact = contacts[0] as any;

      const { data: transcripts } = await supabase.from('call_transcripts').select('id, title, call_date, call_type').eq('user_id', userId).or(`participants.ilike.%${params.contactName}%,title.ilike.%${params.contactName}%`).order('call_date', { ascending: false }).limit(5);

      const { data: events } = await supabase.from('calendar_events').select('id, title, start_time').eq('user_id', userId).ilike('title', `%${params.contactName}%`).order('start_time', { ascending: false }).limit(5);

      const engagements: string[] = [];
      for (const t of (transcripts || []) as any[]) engagements.push(`📞 ${t.call_date}: ${t.title} (${t.call_type || 'call'})`);
      for (const e of (events || []) as any[]) engagements.push(`📅 ${new Date(e.start_time).toLocaleDateString()}: ${e.title}`);

      engagements.sort().reverse();

      const staleDays = contact.last_touch_date
        ? Math.ceil((Date.now() - new Date(contact.last_touch_date).getTime()) / 86400000)
        : null;

      return `👤 ${contact.name}${contact.title ? ` — ${contact.title}` : ''}\n${staleDays !== null ? `Last touch: ${staleDays} days ago${staleDays > 14 ? ' ⚠️ Going cold!' : ''}` : 'No touch date recorded'}\n\nEngagement History:\n${engagements.length ? engagements.slice(0, 8).join('\n') : 'No engagements found — consider reaching out!'}`;
    },

    competitive_intel: async (params: { query: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const searchTerm = params.query.toLowerCase();

      const { data: transcripts } = await supabase.from('call_transcripts').select('id, title, call_date, account_id, content').eq('user_id', userId).ilike('content', `%${params.query}%`).order('call_date', { ascending: false }).limit(10);
      const { data: accounts } = await supabase.from('accounts').select('id, name, notes').eq('user_id', userId).ilike('notes', `%${params.query}%`).limit(10);
      const { data: opps } = await supabase.from('opportunities').select('id, name, notes, account_id').eq('user_id', userId).ilike('notes', `%${params.query}%`).limit(10);
      const { data: grades } = await supabase.from('transcript_grades').select('transcript_id, competitors_mentioned').eq('user_id', userId).not('competitors_mentioned', 'is', null).limit(50);

      const gradeMatches = (grades || []).filter((g: any) =>
        (g.competitors_mentioned || []).some((c: string) => c.toLowerCase().includes(searchTerm))
      );

      const accountIds = [...new Set((transcripts || []).map((t: any) => t.account_id).filter(Boolean))];
      let accountMap: Record<string, string> = {};
      if (accountIds.length) {
        const { data: accts } = await supabase.from('accounts').select('id, name').in('id', accountIds);
        accountMap = Object.fromEntries((accts || []).map((a: any) => [a.id, a.name]));
      }

      const results: string[] = [];
      for (const t of (transcripts || []) as any[]) {
        const acctName = accountMap[t.account_id] || 'Unknown';
        const idx = (t.content || '').toLowerCase().indexOf(searchTerm);
        const snippet = idx >= 0 ? (t.content || '').slice(Math.max(0, idx - 50), idx + searchTerm.length + 100).trim() : '';
        results.push(`📞 ${t.call_date} — ${acctName}: "${snippet.slice(0, 150)}..."`);
      }
      for (const a of (accounts || []) as any[]) results.push(`🏢 Account "${a.name}" notes mention "${params.query}"`);
      for (const o of (opps || []) as any[]) results.push(`💼 Deal "${o.name}" notes mention "${params.query}"`);
      if (gradeMatches.length) results.push(`📊 ${gradeMatches.length} call grade(s) flagged "${params.query}" as a competitor`);

      if (!results.length) return `No mentions of "${params.query}" found in your transcripts, accounts, or deals.`;
      return `🔍 Competitive Intel for "${params.query}":\n\n${results.slice(0, 10).join('\n\n')}${results.length > 10 ? `\n\n...and ${results.length - 10} more mentions` : ''}`;
    },

    trend_query: async (params: { metric: string; period?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const TREND_METRIC_MAP: Record<string, string> = {
        dials: 'dials', calls: 'dials',
        connects: 'conversations', conversations: 'conversations',
        meetings: 'meetings_set', 'meetings set': 'meetings_set',
        emails: 'manual_emails',
        prospects: 'prospects_added',
        'customer meetings': 'customer_meetings_held',
        opps: 'opportunities_created',
        'accounts researched': 'accounts_researched',
        score: 'daily_score',
      };

      const dbField = TREND_METRIC_MAP[params.metric.toLowerCase()] || params.metric;
      const period = (params.period || 'week').toLowerCase();
      const daysBack = period.includes('month') ? 30 : period.includes('quarter') ? 90 : 7;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const { data: entries } = await supabase.from('daily_journal_entries').select(`date, ${dbField}`).eq('user_id', userId).gte('date', startDate.toISOString().split('T')[0]).order('date');

      if (!entries?.length) return `No data for ${params.metric} in the last ${daysBack} days.`;

      const values = entries.map(e => (e as any)[dbField] || 0);
      const total = values.reduce((s: number, v: number) => s + v, 0);
      const avg = Math.round((total / values.length) * 10) / 10;
      const latest = values[values.length - 1];

      const mid = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, mid);
      const secondHalf = values.slice(mid);
      const firstAvg = firstHalf.length ? firstHalf.reduce((s: number, v: number) => s + v, 0) / firstHalf.length : 0;
      const secondAvg = secondHalf.length ? secondHalf.reduce((s: number, v: number) => s + v, 0) / secondHalf.length : 0;
      const trend = secondAvg > firstAvg * 1.1 ? '📈 trending up' : secondAvg < firstAvg * 0.9 ? '📉 trending down' : '➡️ stable';

      return `${params.metric} over last ${daysBack} days: Total ${total}, Avg ${avg}/day, Latest ${latest}. ${trend} (early avg ${Math.round(firstAvg * 10) / 10} → recent avg ${Math.round(secondAvg * 10) / 10}).`;
    },

    read_resource: async (params: { title: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: resources } = await supabase.from('resources').select('id, title, content, type').eq('user_id', userId).ilike('title', `%${params.title}%`).limit(1);
      if (!resources?.length) return `Resource matching "${params.title}" not found`;

      const r = resources[0] as any;
      const content = (r.content || '').substring(0, 3000);
      return `📚 "${r.title}" (${r.type || 'document'}):\n\n${content}${(r.content || '').length > 3000 ? '\n\n... [truncated]' : ''}`;
    },

    search_resources: async (params: { query: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const q = `%${params.query}%`;
      const { data: resources } = await supabase.from('resources').select('title, resource_type, template_category, created_at').eq('user_id', userId).or(`title.ilike.${q},content.ilike.${q},resource_type.ilike.${q}`).limit(10);

      if (!resources?.length) return `No resources found matching "${params.query}"`;
      return `Resources matching "${params.query}":\n` +
        resources.map(r => `• ${r.title} [${r.resource_type || '—'}]${r.template_category ? ` (${r.template_category})` : ''}`).join('\n');
    },

    bulk_update: async (params: { entity: string; filter_field: string; filter_value: string; update_field: string; update_value: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const entity = params.entity.toLowerCase();

      const VALID_FIELDS: Record<string, string[]> = {
        accounts: ['account_status', 'tier', 'priority', 'motion', 'notes', 'next_step', 'outreach_status', 'industry', 'cadence_name'],
        opportunities: ['stage', 'status', 'arr', 'close_date', 'next_step', 'notes', 'deal_type'],
        tasks: ['status', 'priority', 'due_date', 'notes', 'category'],
      };

      if (!VALID_FIELDS[entity]) return `Bulk update only supports accounts, opportunities, and tasks.`;

      const filterField = ACCOUNT_FIELDS[params.filter_field.toLowerCase()] || params.filter_field;
      const updateField = (entity === 'accounts' ? ACCOUNT_FIELDS[params.update_field.toLowerCase()] : null) || params.update_field;

      if (!VALID_FIELDS[entity].includes(filterField) && filterField !== 'name' && filterField !== 'title') {
        return `Invalid filter field "${params.filter_field}" for ${entity}. Valid: name, ${VALID_FIELDS[entity].join(', ')}`;
      }
      if (!VALID_FIELDS[entity].includes(updateField)) {
        return `Invalid update field "${params.update_field}" for ${entity}. Valid: ${VALID_FIELDS[entity].join(', ')}`;
      }

      const table = entity as 'accounts' | 'opportunities' | 'tasks';

      const { data: matches, count } = await supabase
        .from(table)
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .ilike(filterField, `%${params.filter_value}%`)
        .limit(50);

      const matchCount = count || matches?.length || 0;
      if (!matchCount) return `No ${entity} found matching ${params.filter_field} = "${params.filter_value}"`;

      const ids = (matches || []).map(m => m.id);
      const { error } = await supabase
        .from(table)
        .update({ [updateField]: params.update_value, updated_at: new Date().toISOString() })
        .in('id', ids);

      if (error) return `Bulk update failed: ${error.message}`;
      emitDataChanged(entity);
      toast.success(`Bulk updated ${matchCount} ${entity}`, { description: `${params.update_field} → ${params.update_value}` });
      return `Updated ${matchCount} ${entity} where ${params.filter_field} matches "${params.filter_value}": set ${params.update_field} = "${params.update_value}"`;
    },
  };
}
