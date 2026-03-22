import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import { OPP_FIELDS, MEDDICC_FIELDS } from '../toolTypes';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createOpportunityTools(ctx: ToolContext): ToolMap {
  return {
    create_opportunity: async (params: { name: string; accountName?: string; arr?: number; stage?: string; dealType?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        accountId = accts?.[0]?.id ?? null;
      }

      const { error } = await supabase.from('opportunities').insert({
        user_id: userId,
        name: params.name,
        account_id: accountId,
        arr: params.arr || 0,
        stage: params.stage || 'Discovery',
        deal_type: params.dealType || 'new-logo',
        status: 'open',
      });

      if (error) return `Failed to create opportunity: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Opportunity created', { description: `${params.name} — $${Math.round((params.arr || 0) / 1000)}k` });
      return `Created opportunity ${params.name}${params.arr ? ` at $${Math.round(params.arr / 1000)}k ARR` : ''}`;
    },

    update_opportunity: async (params: { opportunityName: string; field: string; value: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const dbField = OPP_FIELDS[params.field.toLowerCase()] || params.field;
      const updateValue = dbField === 'arr' ? parseFloat(params.value) || 0 : params.value;

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `Opportunity "${params.opportunityName}" not found`;

      const { error } = await supabase
        .from('opportunities')
        .update({ [dbField]: updateValue, updated_at: new Date().toISOString() })
        .eq('id', opps[0].id);

      if (error) return `Failed to update: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Deal updated', { description: `${opps[0].name}: ${params.field} → ${params.value}` });
      return `Updated ${opps[0].name} ${params.field} to ${params.value}`;
    },

    move_deal: async (params: { opportunityName: string; newStage: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, stage')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `Opportunity "${params.opportunityName}" not found`;

      const oldStage = opps[0].stage;
      const { error } = await supabase
        .from('opportunities')
        .update({ stage: params.newStage, updated_at: new Date().toISOString() })
        .eq('id', opps[0].id);

      if (error) return `Failed to move deal: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Deal moved', { description: `${opps[0].name}: ${oldStage || '—'} → ${params.newStage}` });
      return `Moved ${opps[0].name} from ${oldStage || 'no stage'} to ${params.newStage}`;
    },

    add_opportunity_note: async (params: { opportunityName: string; note: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `Opportunity matching "${params.opportunityName}" not found`;

      const opp = opps[0];
      const updatedNotes = ((opp.notes || '') + `\n\n🎙️ ${new Date().toLocaleDateString()}: ${params.note}`).trim();

      const { error } = await supabase
        .from('opportunities')
        .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
        .eq('id', opp.id);

      if (error) return `Failed to add note: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Note added to opportunity', { description: opp.name });
      return `Added note to opportunity "${opp.name}"`;
    },

    update_methodology: async (params: { opportunityName: string; field: string; confirmed?: boolean; notes?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const fieldKey = MEDDICC_FIELDS[params.field.toLowerCase()];
      if (!fieldKey) return `Unknown methodology field: ${params.field}. Valid: ${Object.keys(MEDDICC_FIELDS).join(', ')}`;

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `Opportunity "${params.opportunityName}" not found`;

      const updates: Record<string, any> = {};
      if (params.confirmed !== undefined) updates[`${fieldKey}_confirmed`] = params.confirmed;
      if (params.notes) updates[`${fieldKey}_notes`] = params.notes;

      const { error } = await supabase.from('opportunity_methodology')
        .upsert({
          user_id: userId,
          opportunity_id: opps[0].id,
          ...updates,
        }, { onConflict: 'user_id,opportunity_id' });

      if (error) return `Failed to update methodology: ${error.message}`;
      emitDataChanged('opportunities');

      const action = params.confirmed ? '✅ Confirmed' : params.notes ? '📝 Updated' : 'Updated';
      toast.success('MEDDICC updated', { description: `${opps[0].name}: ${params.field} ${action}` });
      return `${action} ${params.field} for ${opps[0].name}${params.notes ? `: ${params.notes}` : ''}`;
    },

    methodology_gaps: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, arr, close_date, stage, status')
        .eq('user_id', userId)
        .in('status', ['active', 'stalled'])
        .order('arr', { ascending: false })
        .limit(20);

      if (!opps?.length) return 'No active opportunities found';

      const oppIds = opps.map(o => o.id);
      const { data: methodologies } = await supabase
        .from('opportunity_methodology')
        .select('*')
        .eq('user_id', userId)
        .in('opportunity_id', oppIds);

      const methMap = new Map((methodologies || []).map((m: any) => [m.opportunity_id, m]));
      const fields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
      const fieldLabels: Record<string, string> = { metrics: 'Metrics', economic_buyer: 'Economic Buyer', decision_criteria: 'Decision Criteria', decision_process: 'Decision Process', identify_pain: 'Identify Pain', champion: 'Champion', competition: 'Competition' };

      const gaps: { opp: string; arr: number; closeDate: string; missing: string[]; urgency: number }[] = [];

      for (const opp of opps) {
        const meth = methMap.get(opp.id) as any;
        const missing = fields.filter(f => !meth || !meth[`${f}_confirmed`]).map(f => fieldLabels[f]);
        if (missing.length === 0) continue;

        const daysToClose = opp.close_date ? Math.max(1, Math.ceil((new Date(opp.close_date).getTime() - Date.now()) / 86400000)) : 90;
        const urgency = (opp.arr || 0) / daysToClose;

        gaps.push({ opp: opp.name, arr: opp.arr || 0, closeDate: opp.close_date || 'none', missing, urgency });
      }

      gaps.sort((a, b) => b.urgency - a.urgency);

      if (gaps.length === 0) return '✅ All active deals have full MEDDICC coverage!';

      return `🎯 MEDDICC Gaps (ranked by urgency):\n\n${gaps.slice(0, 5).map((g, i) =>
        `${i + 1}. ${g.opp} ($${(g.arr / 1000).toFixed(0)}k, close: ${g.closeDate})\n   Missing: ${g.missing.join(', ')}`
      ).join('\n\n')}${gaps.length > 5 ? `\n\n...and ${gaps.length - 5} more deals with gaps` : ''}`;
    },

    create_methodology_tasks: async (params: { opportunityName: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, close_date, arr, account_id')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `No opportunity matching "${params.opportunityName}"`;
      const opp = opps[0] as any;

      const { data: meth } = await supabase
        .from('opportunity_methodology' as any)
        .select('*')
        .eq('opportunity_id', opp.id)
        .maybeSingle();

      if (!meth) return `No methodology data for "${opp.name}" — update MEDDICC first.`;

      const m = meth as any;
      const MEDDICC_TASK_MAP: Record<string, string> = {
        metrics: 'Confirm Metrics: Ask what success metrics they\'ll measure — tie to their KPIs',
        economic_buyer: 'Identify Economic Buyer: Ask who signs off on budget and what their approval process looks like',
        decision_criteria: 'Map Decision Criteria: Ask what they\'re evaluating vendors on — technical, commercial, and cultural fit',
        decision_process: 'Map Decision Process: Ask about timeline, stakeholders involved, and approval steps',
        identify_pain: 'Quantify Pain: Ask about the cost of inaction — lost revenue, wasted time, risk exposure',
        champion: 'Test Champion: Ask your champion to introduce you to the economic buyer or set up a technical validation',
        competition: 'Assess Competition: Ask who else they\'re evaluating and what criteria matter most',
      };

      const gapEntries = Object.entries(MEDDICC_TASK_MAP)
        .filter(([field]) => !m[`${field}_confirmed`]);

      if (!gapEntries.length) return `✅ All MEDDICC elements confirmed for "${opp.name}" — no tasks needed!`;

      const closeDate = opp.close_date ? new Date(opp.close_date) : new Date();
      const now = new Date();
      const daysToClose = Math.max(1, Math.ceil((closeDate.getTime() - now.getTime()) / 86400000));
      const interval = Math.max(1, Math.floor(daysToClose / gapEntries.length));

      const created: string[] = [];
      for (let i = 0; i < gapEntries.length; i++) {
        const [, taskTitle] = gapEntries[i];
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + Math.min(interval * (i + 1), daysToClose));

        await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            title: `[${opp.name}] ${taskTitle}`,
            priority: i < 2 ? 'P1' : 'P2',
            status: 'todo',
            due_date: dueDate.toISOString().split('T')[0],
            linked_account_id: opp.account_id,
            source: 'dave-methodology',
          } as any);

        created.push(`• ${taskTitle} (due ${dueDate.toLocaleDateString()})`);
      }

      emitDataChanged('tasks');
      toast.success(`${created.length} MEDDICC tasks created`, { description: opp.name });
      return `Created ${created.length} tasks to close MEDDICC gaps on "${opp.name}":\n\n${created.join('\n')}`;
    },

    assess_deal_risk: async (params: { opportunityName?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const query = supabase
        .from('opportunities')
        .select('id, name, stage, arr, close_date, last_touch_date, next_step, next_step_date, notes, account_id')
        .eq('user_id', userId)
        .not('status', 'eq', 'closed-won')
        .not('status', 'eq', 'closed-lost');

      if (params.opportunityName) {
        query.ilike('name', `%${params.opportunityName}%`);
      }

      const { data: opps } = await query.order('arr', { ascending: false }).limit(params.opportunityName ? 1 : 10);
      if (!opps?.length) return params.opportunityName ? `No active deal matching "${params.opportunityName}"` : 'No active deals found';

      const risks: { name: string; arr: number; score: number; factors: string[] }[] = [];

      for (const opp of opps as any[]) {
        const factors: string[] = [];
        let riskScore = 0;

        if (opp.last_touch_date) {
          const daysSince = Math.ceil((Date.now() - new Date(opp.last_touch_date).getTime()) / 86400000);
          if (daysSince > 14) { riskScore += 30; factors.push(`${daysSince}d since last touch`); }
          else if (daysSince > 7) { riskScore += 15; factors.push(`${daysSince}d since last touch`); }
        } else {
          riskScore += 20; factors.push('No touch date recorded');
        }

        if (opp.close_date) {
          const daysToClose = Math.ceil((new Date(opp.close_date).getTime() - Date.now()) / 86400000);
          if (daysToClose < 0) { riskScore += 40; factors.push(`Close date ${Math.abs(daysToClose)}d overdue`); }
          else if (daysToClose < 14) { riskScore += 20; factors.push(`Closing in ${daysToClose}d`); }
        }

        const { data: meth } = await supabase
          .from('opportunity_methodology' as any)
          .select('*')
          .eq('opportunity_id', opp.id)
          .maybeSingle();

        if (meth) {
          const m = meth as any;
          const methGaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
            .filter(f => !m[`${f}_confirmed`]);
          if (methGaps.length >= 4) { riskScore += 30; factors.push(`${methGaps.length} MEDDICC gaps: ${methGaps.join(', ')}`); }
          else if (methGaps.length >= 2) { riskScore += 15; factors.push(`${methGaps.length} MEDDICC gaps: ${methGaps.join(', ')}`); }
        } else {
          riskScore += 25; factors.push('No MEDDICC data');
        }

        if (!opp.next_step) { riskScore += 10; factors.push('No next step defined'); }

        risks.push({ name: opp.name, arr: opp.arr || 0, score: riskScore, factors });
      }

      risks.sort((a, b) => b.score - a.score);

      const riskLevel = (score: number) => score >= 50 ? '🔴 HIGH' : score >= 25 ? '🟡 MEDIUM' : '🟢 LOW';

      if (params.opportunityName && risks.length === 1) {
        const r = risks[0];
        return `${riskLevel(r.score)} Risk — ${r.name} ($${(r.arr / 1000).toFixed(0)}k)\nRisk Score: ${r.score}/100\n\nRisk Factors:\n${r.factors.map(f => `• ${f}`).join('\n')}\n\nRecommendation: ${r.score >= 50 ? 'Needs immediate attention — schedule a call, confirm champion, and update next steps.' : r.score >= 25 ? 'Monitor closely — address the gaps above this week.' : 'On track — keep momentum.'}`;
      }

      return `📊 Deal Risk Assessment:\n\n${risks.slice(0, 5).map(r =>
        `${riskLevel(r.score)} ${r.name} ($${(r.arr / 1000).toFixed(0)}k) — Score: ${r.score}\n  ${r.factors.slice(0, 3).join(' | ')}`
      ).join('\n\n')}`;
    },
  };
}
