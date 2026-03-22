import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { trackedInvoke } from '@/lib/trackedInvoke';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createPipelineTools(ctx: ToolContext): ToolMap {
  return {
    pipeline_pulse: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';
      const { data: opps } = await supabase
        .from('opportunities')
        .select('name, stage, arr, close_date')
        .eq('user_id', userId)
        .not('status', 'eq', 'closed-lost');
      if (!opps?.length) return 'No active pipeline deals found.';
      const total = opps.reduce((s, o) => s + (o.arr || 0), 0);
      const summary = `You have ${opps.length} active deals worth $${Math.round(total / 1000)}k. ` +
        opps.slice(0, 5).map(o => `${o.name}: ${o.stage || 'no stage'}, $${Math.round((o.arr || 0) / 1000)}k`).join('. ');
      return summary;
    },

    quota_status: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const [quotaRes, closedWonRes] = await Promise.all([
        supabase.from('quota_targets').select('new_arr_quota, renewal_arr_quota').eq('user_id', userId).limit(1),
        supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
      ]);

      const quota = quotaRes.data?.[0];
      if (!quota) return 'No quota targets configured. Go to Settings to set them up.';

      const closedNew = (closedWonRes.data || []).filter(o => o.deal_type === 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
      const closedRenewal = (closedWonRes.data || []).filter(o => o.deal_type !== 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
      const newPct = quota.new_arr_quota ? Math.round((closedNew / quota.new_arr_quota) * 100) : 0;
      const renewalPct = quota.renewal_arr_quota ? Math.round((closedRenewal / quota.renewal_arr_quota) * 100) : 0;
      const totalClosed = closedNew + closedRenewal;
      const totalQuota = (quota.new_arr_quota || 0) + (quota.renewal_arr_quota || 0);
      const totalPct = totalQuota ? Math.round((totalClosed / totalQuota) * 100) : 0;

      return `Quota attainment: ${totalPct}% overall ($${Math.round(totalClosed / 1000)}k of $${Math.round(totalQuota / 1000)}k). New logo: ${newPct}% ($${Math.round(closedNew / 1000)}k of $${Math.round((quota.new_arr_quota || 0) / 1000)}k). Renewal: ${renewalPct}% ($${Math.round(closedRenewal / 1000)}k of $${Math.round((quota.renewal_arr_quota || 0) / 1000)}k). Gap: $${Math.round(Math.max(0, totalQuota - totalClosed) / 1000)}k.`;
    },

    commission_detail: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const [quotaRes, closedRes] = await Promise.all([
        supabase.from('quota_targets').select('*').eq('user_id', userId).limit(1),
        supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
      ]);

      const quota = quotaRes.data?.[0];
      if (!quota) return 'No quota targets configured. Go to Settings to set them up.';

      const closed = closedRes.data || [];
      const newArr = closed.filter(o => o.deal_type === 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
      const renewalArr = closed.filter(o => o.deal_type !== 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
      const totalQuota = (quota.new_arr_quota || 0) + (quota.renewal_arr_quota || 0);
      const totalClosed = newArr + renewalArr;
      const attainment = totalQuota ? Math.round((totalClosed / totalQuota) * 100) : 0;

      let summary = `Commission snapshot:\n`;
      summary += `Total attainment: ${attainment}% ($${Math.round(totalClosed / 1000)}k of $${Math.round(totalQuota / 1000)}k)\n`;
      summary += `New logo: $${Math.round(newArr / 1000)}k of $${Math.round((quota.new_arr_quota || 0) / 1000)}k\n`;
      summary += `Renewal: $${Math.round(renewalArr / 1000)}k of $${Math.round((quota.renewal_arr_quota || 0) / 1000)}k\n`;
      summary += `Gap to quota: $${Math.round(Math.max(0, totalQuota - totalClosed) / 1000)}k`;

      if (attainment >= 100) summary += `\n🎉 You're at or above quota! Accelerators may apply.`;
      else if (attainment >= 80) summary += `\n🔥 Strong pace — closing $${Math.round((totalQuota - totalClosed) / 1000)}k more gets you there.`;

      return summary;
    },

    scenario_calc: async (params: { dealNames: string[] }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const [quotaRes, allOppsRes, closedWonRes] = await Promise.all([
        supabase.from('quota_targets').select('new_arr_quota, renewal_arr_quota').eq('user_id', userId).limit(1),
        supabase.from('opportunities').select('name, arr, deal_type, status').eq('user_id', userId).not('status', 'eq', 'closed-lost'),
        supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
      ]);

      const quota = quotaRes.data?.[0];
      const allOpps = allOppsRes.data || [];
      const closedWon = closedWonRes.data || [];

      if (!allOpps.length) return 'No active pipeline deals found.';

      const matched = params.dealNames.map(name => {
        const lower = name.toLowerCase();
        return allOpps.find(o => o.name.toLowerCase().includes(lower));
      }).filter(Boolean);

      if (!matched.length) return `Could not find any of those deals in your pipeline.`;

      const scenarioArr = matched.reduce((sum, o: any) => sum + (o.arr || 0), 0);
      const newLogoArr = matched.filter((o: any) => o.deal_type === 'new-logo').reduce((sum, o: any) => sum + (o.arr || 0), 0);
      const renewalArr = scenarioArr - newLogoArr;

      let summary = `If you close ${matched.map((o: any) => o.name).join(' and ')}, that's $${Math.round(scenarioArr / 1000)}k total ARR.`;

      if (quota) {
        const closedNewArr = closedWon.filter((o: any) => o.deal_type === 'new-logo').reduce((s: number, o: any) => s + (o.arr || 0), 0);
        const closedRenewalArr = closedWon.filter((o: any) => o.deal_type !== 'new-logo').reduce((s: number, o: any) => s + (o.arr || 0), 0);
        const newTotal = closedNewArr + newLogoArr;
        const renewalTotal = closedRenewalArr + renewalArr;
        const newPct = quota.new_arr_quota ? Math.round((newTotal / quota.new_arr_quota) * 100) : 0;
        const renewalPct = quota.renewal_arr_quota ? Math.round((renewalTotal / quota.renewal_arr_quota) * 100) : 0;
        const newRemaining = Math.max(0, (quota.new_arr_quota || 0) - newTotal);
        const renewalRemaining = Math.max(0, (quota.renewal_arr_quota || 0) - renewalTotal);

        summary += ` New logo: $${Math.round(newTotal / 1000)}k of $${Math.round((quota.new_arr_quota || 0) / 1000)}k (${newPct}%).`;
        summary += ` Renewal: $${Math.round(renewalTotal / 1000)}k of $${Math.round((quota.renewal_arr_quota || 0) / 1000)}k (${renewalPct}%).`;
        summary += ` You'd still need $${Math.round(newRemaining / 1000)}k new and $${Math.round(renewalRemaining / 1000)}k renewal to hit quota.`;
      }

      return summary;
    },

    pipeline_hygiene: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data: recent } = await supabase
        .from('pipeline_hygiene_scans')
        .select('health_score, total_issues, critical_issues, summary, scan_date')
        .eq('user_id', userId)
        .order('scan_date', { ascending: false })
        .limit(1);

      if (recent?.length && recent[0].scan_date === today) {
        const scan = recent[0];
        const summary = scan.summary as any;
        return `Pipeline hygiene (today's scan): Health ${scan.health_score}/100, ${scan.total_issues} issues (${scan.critical_issues} critical). ${summary?.top_issues ? `Top issues: ${(summary.top_issues as string[]).join(', ')}` : ''}`;
      }

      toast.info('Running pipeline hygiene scan...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('pipeline-hygiene', { body: {} });

      if (error) return `Pipeline hygiene scan failed: ${error.message}`;
      return `Pipeline hygiene: Health ${data?.health_score || '—'}/100, ${data?.total_issues || 0} issues found (${data?.critical_issues || 0} critical). ${data?.summary?.top_issues ? `Top: ${data.summary.top_issues.join(', ')}` : 'Check dashboard for details.'}`;
    },

    weekly_battle_plan: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      const weekStart = monday.toISOString().split('T')[0];

      const { data: plans } = await supabase
        .from('weekly_battle_plans')
        .select('strategy_summary, moves, quota_gap, days_remaining, moves_completed')
        .eq('user_id', userId)
        .gte('week_start', weekStart)
        .order('created_at', { ascending: false })
        .limit(1);

      if (plans?.length) {
        const plan = plans[0];
        const moves = (plan.moves as any[]) || [];
        const completed = (plan.moves_completed as any[]) || [];
        return `This week's battle plan (${moves.length} moves, ${completed.length} completed):\n` +
          `Quota gap: $${Math.round((plan.quota_gap as number || 0) / 1000)}k | ${plan.days_remaining || '—'} selling days left\n` +
          `Strategy: ${plan.strategy_summary || 'Not set'}\n` +
          `Top moves:\n${moves.slice(0, 5).map((m: any, i: number) => `${i + 1}. ${m.action || m.description || JSON.stringify(m)}`).join('\n')}`;
      }

      toast.info('Generating battle plan...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('weekly-battle-plan', { body: {} });

      if (error) return `Failed to generate battle plan: ${error.message}`;
      return data?.strategy_summary || 'Battle plan generated. Check your dashboard for the full plan.';
    },

    weekly_review: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      toast.info('Running weekly review...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('weekly-patterns', { body: {} });

      if (error) return `Failed to run weekly review: ${error.message}`;
      return data?.summary || data?.patterns_summary || 'Weekly review complete. Check the dashboard for details.';
    },

    account_prioritize: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      toast.info('AI prioritizing accounts...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('prioritize-accounts', { body: {} });

      if (error) return `Failed to prioritize: ${error.message}`;

      const ranked = data?.ranked || data?.accounts || [];
      if (!ranked.length) return 'No accounts to prioritize. Add accounts first.';

      return `Top priority accounts:\n` +
        ranked.slice(0, 8).map((a: any, i: number) =>
          `${i + 1}. ${a.name || a.account_name} — ${a.reason || a.rationale || 'Priority account'}`
        ).join('\n');
    },
  };
}
