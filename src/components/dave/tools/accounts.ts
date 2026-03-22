import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { ACCOUNT_FIELDS } from '../toolTypes';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createAccountTools(ctx: ToolContext): ToolMap {
  return {
    create_account: async (params: { name: string; tier?: string; motion?: string; industry?: string; website?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: existing } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .eq('name', params.name)
        .limit(1);

      if (existing?.length) return `Account "${existing[0].name}" already exists. Use update_account instead.`;

      const { error } = await supabase.from('accounts').insert({
        user_id: userId,
        name: params.name,
        tier: params.tier || null,
        motion: params.motion || null,
        industry: params.industry || null,
        website: params.website || null,
        account_status: 'active',
      });

      if (error) return `Failed to create account: ${error.message}`;
      emitDataChanged('accounts');
      toast.success('Account created', { description: `${params.name}${params.tier ? ` [${params.tier}]` : ''}` });
      return `Created account ${params.name}${params.tier ? ` (Tier ${params.tier})` : ''}${params.motion ? `, ${params.motion} motion` : ''}`;
    },

    update_account: async (params: { accountName: string; field: string; value: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const dbField = ACCOUNT_FIELDS[params.field.toLowerCase()] || params.field;
      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { error } = await supabase
        .from('accounts')
        .update({ [dbField]: params.value, updated_at: new Date().toISOString() })
        .eq('id', accts[0].id);

      if (error) return `Failed to update: ${error.message}`;
      emitDataChanged('accounts');
      toast.success('Account updated', { description: `${accts[0].name}: ${params.field} → ${params.value}` });
      return `Updated ${accts[0].name} ${params.field} to ${params.value}`;
    },

    lookup_account: async (params: { accountName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;
      const acct = accts[0];

      const [contactsRes, oppsRes, transcriptsRes] = await Promise.all([
        supabase.from('contacts').select('name, title, buyer_role, influence_level, email, department').eq('account_id', acct.id).limit(10),
        supabase.from('opportunities').select('name, stage, arr, close_date, next_step, deal_type, status').eq('account_id', acct.id).not('status', 'eq', 'closed-lost').limit(10),
        supabase.from('call_transcripts').select('title, call_date, call_type, summary').eq('account_id', acct.id).order('call_date', { ascending: false }).limit(5),
      ]);

      let summary = `📋 ${acct.name} [${acct.tier || '—'}/${acct.priority || '—'}]\n`;
      summary += `Status: ${acct.account_status || '—'} | Motion: ${acct.motion || '—'} | Industry: ${acct.industry || '—'}\n`;
      summary += `Last touch: ${acct.last_touch_date || 'never'} (${acct.last_touch_type || '—'})\n`;
      if (acct.next_step) summary += `Next step: ${acct.next_step}\n`;
      if (acct.notes) summary += `Notes: ${acct.notes.slice(0, 200)}\n`;

      if (oppsRes.data?.length) {
        const totalArr = oppsRes.data.reduce((s: number, o: any) => s + (o.arr || 0), 0);
        summary += `\nPipeline ($${Math.round(totalArr / 1000)}k): ${oppsRes.data.map((o: any) => `${o.name} [${o.stage || '—'}] $${Math.round((o.arr || 0) / 1000)}k${o.next_step ? ` → ${o.next_step}` : ''}`).join('; ')}\n`;
      }

      if (contactsRes.data?.length) {
        summary += `\nContacts: ${contactsRes.data.map((c: any) => `${c.name}${c.title ? ` (${c.title})` : ''} ${c.buyer_role || ''} ${c.influence_level || ''}`).join('; ')}\n`;
      }

      if (transcriptsRes.data?.length) {
        summary += `\nRecent calls: ${transcriptsRes.data.map((t: any) => `${t.call_date}: ${t.title}${t.summary ? ` — ${t.summary.slice(0, 80)}` : ''}`).join('; ')}\n`;
      }

      return summary;
    },

    enrich_account: async (params: { accountName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, website, industry')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      toast.info(`Enriching ${accts[0].name}...`, { duration: 3000 });

      const { data, error } = await trackedInvoke<any>('enrich-account', {
        body: {
          url: accts[0].website || '',
          accountName: accts[0].name,
          accountId: accts[0].id,
          industry: accts[0].industry || '',
        },
      });

      if (error) return `Enrichment failed: ${error.message}`;
      if (!data?.success) return `Enrichment failed: ${data?.error || 'unknown error'}`;

      const scores = data.scores || {};
      toast.success(`Enriched ${accts[0].name}`, {
        description: `ICP ${scores.icp_fit_score || '—'} • Tier ${scores.lifecycle_tier || '—'}`,
      });
      return `Enriched ${accts[0].name}: ICP fit ${scores.icp_fit_score || '—'}/100, Tier ${scores.lifecycle_tier || '—'}, priority ${scores.priority_score || '—'}. ${data.summary || ''}`;
    },

    log_touch: async (params: { accountName: string; touchType: string; notes?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes, touches_this_week')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const timestamp = new Date().toLocaleString();
      const touchNote = params.notes
        ? `\n\n**${params.touchType}** (${timestamp}): ${params.notes}`
        : '';

      const { error } = await supabase
        .from('accounts')
        .update({
          last_touch_date: new Date().toISOString().split('T')[0],
          last_touch_type: params.touchType,
          touches_this_week: (accts[0].touches_this_week || 0) + 1,
          notes: (accts[0].notes || '') + touchNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accts[0].id);

      if (error) return `Failed to log touch: ${error.message}`;
      emitDataChanged('accounts');
      toast.success('Touch logged', { description: `${accts[0].name}: ${params.touchType}` });
      return `Logged ${params.touchType} touch for ${accts[0].name}`;
    },

    add_note: async (params: { accountName: string; note: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const timestamp = new Date().toLocaleString();
      const existingNotes = accts[0].notes || '';
      const newNote = `\n\n**Voice Note** (${timestamp}): ${params.note}`;

      const { error } = await supabase
        .from('accounts')
        .update({
          notes: existingNotes + newNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accts[0].id);

      if (error) return `Failed to add note: ${error.message}`;
      toast.success('Note added', { description: `${accts[0].name}: ${params.note.slice(0, 60)}...` });
      return `Note added to ${accts[0].name}`;
    },

    debrief: async (params: { accountName: string; keyTakeaways?: string; nextSteps?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      const timestamp = new Date().toLocaleString();
      const debriefText = `\n\n---\n**Voice Debrief** (${timestamp})\n` +
        (params.keyTakeaways ? `**Takeaways:** ${params.keyTakeaways}\n` : '') +
        (params.nextSteps ? `**Next Steps:** ${params.nextSteps}\n` : '');

      if (accts?.length) {
        const existingNotes = accts[0].notes || '';
        await supabase
          .from('accounts')
          .update({
            notes: existingNotes + debriefText,
            next_step: params.nextSteps || undefined,
            last_touch_date: new Date().toISOString().split('T')[0],
            last_touch_type: 'meeting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', accts[0].id);
      }

      toast.success('Debrief logged', { description: params.accountName });
      return `Debrief captured for ${params.accountName}`;
    },

    smart_debrief: async (params: { accountName: string; summary: string; nextSteps?: string; sentiment?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      const timestamp = new Date().toLocaleString();
      const today = new Date().toISOString().split('T')[0];
      const debriefText = `\n\n---\n**Voice Debrief** (${timestamp})\n` +
        `**Summary:** ${params.summary}\n` +
        (params.nextSteps ? `**Next Steps:** ${params.nextSteps}\n` : '') +
        (params.sentiment ? `**Sentiment:** ${params.sentiment}\n` : '');

      if (accts?.length) {
        await supabase
          .from('accounts')
          .update({
            notes: (accts[0].notes || '') + debriefText,
            next_step: params.nextSteps || undefined,
            last_touch_date: today,
            last_touch_type: 'meeting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', accts[0].id);
      }

      const tasksCreated: string[] = [];
      if (params.nextSteps) {
        const steps = params.nextSteps.split(/[,;]|(?:\band\b)/i).map(s => s.trim()).filter(s => s.length > 5);
        for (const step of steps.slice(0, 5)) {
          const due = new Date();
          let added = 0;
          while (added < 3) {
            due.setDate(due.getDate() + 1);
            if (due.getDay() !== 0 && due.getDay() !== 6) added++;
          }

          await supabase.from('tasks').insert({
            user_id: userId,
            title: step,
            priority: 'P2',
            status: 'next',
            workstream: 'pg',
            linked_account_id: accts?.[0]?.id ?? null,
            category: 'debrief-generated',
            due_date: due.toISOString().split('T')[0],
          });
          tasksCreated.push(step);
        }
      }

      emitDataChanged('accounts');
      if (tasksCreated.length) emitDataChanged('tasks');
      toast.success('Smart debrief captured', {
        description: `${params.accountName}${tasksCreated.length ? ` + ${tasksCreated.length} tasks` : ''}`,
      });
      return `Debrief logged for ${params.accountName}. ${tasksCreated.length ? `Created ${tasksCreated.length} follow-up tasks: ${tasksCreated.join('; ')}` : 'No follow-up tasks extracted.'}`;
    },

    territory_analysis: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accounts } = await supabase
        .from('accounts')
        .select('name, tier, motion, account_status, last_touch_date, touches_this_week, priority_score, icp_fit_score')
        .eq('user_id', userId)
        .eq('account_status', 'active')
        .limit(200);

      if (!accounts?.length) return 'No active accounts found.';

      const now = new Date();
      const staleThreshold = new Date(now);
      staleThreshold.setDate(staleThreshold.getDate() - 14);

      const byTier: Record<string, number> = {};
      const byMotion: Record<string, number> = {};
      const staleAccounts: string[] = [];
      const untouched: string[] = [];

      accounts.forEach(a => {
        byTier[a.tier || 'untiered'] = (byTier[a.tier || 'untiered'] || 0) + 1;
        byMotion[a.motion || 'unset'] = (byMotion[a.motion || 'unset'] || 0) + 1;
        if (!a.last_touch_date) {
          untouched.push(a.name);
        } else if (new Date(a.last_touch_date) < staleThreshold) {
          staleAccounts.push(a.name);
        }
      });

      let summary = `Territory snapshot (${accounts.length} active accounts):\n`;
      summary += `By tier: ${Object.entries(byTier).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;
      summary += `By motion: ${Object.entries(byMotion).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;
      if (staleAccounts.length) summary += `⚠️ ${staleAccounts.length} stale (14+ days): ${staleAccounts.slice(0, 5).join(', ')}${staleAccounts.length > 5 ? ` +${staleAccounts.length - 5} more` : ''}\n`;
      if (untouched.length) summary += `🚫 ${untouched.length} never touched: ${untouched.slice(0, 5).join(', ')}${untouched.length > 5 ? ` +${untouched.length - 5} more` : ''}`;

      return summary;
    },
  };
}
