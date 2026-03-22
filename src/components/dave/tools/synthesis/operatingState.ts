import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

export async function operatingState(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];

  const [tasksRes, oppsRes, renewalsRes] = await Promise.all([
    supabase.from('tasks').select('id, status, due_date, priority').eq('user_id', userId).not('status', 'in', '("done","dropped")'),
    supabase.from('opportunities').select('id, status, next_step, next_step_date, last_touch_date, arr').eq('user_id', userId).eq('status', 'active'),
    supabase.from('renewals').select('id, churn_risk, renewal_due, next_step, arr').eq('user_id', userId),
  ]);

  const tasks = (tasksRes.data || []) as Array<{ due_date: string | null; status: string }>;
  const opps = (oppsRes.data || []) as Array<{ next_step: string | null; next_step_date: string | null; last_touch_date: string | null }>;
  const renewals = (renewalsRes.data || []) as Array<{ renewal_due: string; churn_risk: string | null }>;

  const overdue = tasks.filter(t => t.due_date && t.due_date < todayStr).length;
  const noNextStep = opps.filter(o => !o.next_step && !o.next_step_date).length;
  const staleDeals = opps.filter(o => o.last_touch_date && o.last_touch_date < fourteenDaysAgo).length;
  const atRisk = renewals.filter(r => {
    const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
    return days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain');
  }).length;

  let score = 0;
  if (opps.length > 0) score += 2;
  if (overdue === 0) score += 2;
  if (noNextStep === 0) score += 2;
  if (staleDeals === 0) score += 1;
  if (atRisk === 0) score += 1;
  if (overdue >= 5) score -= 3;
  if (noNextStep >= 3) score -= 2;
  if (staleDeals >= 3) score -= 2;

  if (score >= 7) return `🟢 On pace — ${opps.length} active deals, no open loops.`;
  if (score >= 4) {
    const issue = noNextStep > 0 ? `${noNextStep} deals missing next steps` : `${overdue} overdue tasks`;
    return `🟡 Slight drift — ${issue}.`;
  }
  if (score >= 1) {
    const issues: string[] = [];
    if (overdue > 0) issues.push(`${overdue} overdue`);
    if (staleDeals > 0) issues.push(`${staleDeals} stale deals`);
    return `🟠 Drifting — ${issues.join(', ')}.`;
  }
  return `🔴 Reactive — follow-ups lagging, territory going cold.`;
}
