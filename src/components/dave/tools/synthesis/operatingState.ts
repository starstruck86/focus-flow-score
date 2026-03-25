import { supabase } from '@/integrations/supabase/client';
import { todayInAppTz, getCurrentMinutesET } from '@/lib/timeFormat';
import type { ToolContext } from '../../toolTypes';

export async function operatingState(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const todayStr = todayInAppTz();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
  const currentMinutes = getCurrentMinutesET();

  const [tasksRes, oppsRes, renewalsRes, journalRes, planRes] = await Promise.all([
    supabase.from('tasks').select('id, status, due_date, priority')
      .eq('user_id', userId).not('status', 'in', '("done","dropped")'),
    // HARD FILTER: only active — closed-won/lost NEVER included
    supabase.from('opportunities').select('id, status, next_step, next_step_date, last_touch_date, arr')
      .eq('user_id', userId).eq('status', 'active'),
    supabase.from('renewals').select('id, churn_risk, renewal_due, next_step, arr')
      .eq('user_id', userId),
    supabase.from('daily_journal_entries').select('dials, conversations, checked_in')
      .eq('user_id', userId).eq('date', todayStr).maybeSingle(),
    supabase.from('daily_time_blocks').select('blocks, completed_goals')
      .eq('user_id', userId).eq('plan_date', todayStr).maybeSingle(),
  ]);

  const tasks = (tasksRes.data || []) as Array<{ due_date: string | null; status: string; priority: string }>;
  const opps = (oppsRes.data || []) as Array<{ next_step: string | null; next_step_date: string | null; last_touch_date: string | null; arr: number | null }>;
  const renewals = (renewalsRes.data || []) as Array<{ renewal_due: string; churn_risk: string | null }>;
  const journal = journalRes.data as { dials: number; conversations: number; checked_in: boolean } | null;
  const plan = planRes.data as { blocks: any[]; completed_goals: string[] | null } | null;

  const overdue = tasks.filter(t => t.due_date && t.due_date < todayStr).length;
  const noNextStep = opps.filter(o => !o.next_step && !o.next_step_date).length;
  const staleDeals = opps.filter(o => o.last_touch_date && o.last_touch_date < fourteenDaysAgo).length;
  const atRisk = renewals.filter(r => {
    const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
    return days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain');
  }).length;

  // Execution state tracking
  const dialsToday = journal?.dials || 0;
  const checkedIn = journal?.checked_in || false;
  const totalPipeline = opps.reduce((s, o) => s + (o.arr || 0), 0);

  // Block progress
  let blocksTotal = 0;
  let blocksCompleted = 0;
  if (plan?.blocks) {
    blocksTotal = (plan.blocks as any[]).length;
    blocksCompleted = (plan.completed_goals || []).length;
  }

  // Deterministic scoring
  let score = 0;
  if (opps.length > 0) score += 2;
  if (overdue === 0) score += 2;
  if (noNextStep === 0) score += 2;
  if (staleDeals === 0) score += 1;
  if (atRisk === 0) score += 1;
  if (overdue >= 5) score -= 3;
  if (noNextStep >= 3) score -= 2;
  if (staleDeals >= 3) score -= 2;

  // Build state sentence
  let state: string;
  if (score >= 7) {
    state = `🟢 On pace — ${opps.length} active deals, $${Math.round(totalPipeline / 1000)}k pipeline, no open loops.`;
  } else if (score >= 4) {
    const issue = noNextStep > 0 ? `${noNextStep} deals missing next steps` : `${overdue} overdue tasks`;
    state = `🟡 Slight drift — ${issue}.`;
  } else if (score >= 1) {
    const issues: string[] = [];
    if (overdue > 0) issues.push(`${overdue} overdue`);
    if (staleDeals > 0) issues.push(`${staleDeals} stale deals`);
    if (atRisk > 0) issues.push(`${atRisk} at-risk renewals`);
    state = `🟠 Drifting — ${issues.join(', ')}.`;
  } else {
    state = `🔴 Reactive — follow-ups lagging, territory going cold.`;
  }

  // Execution progress
  const progress: string[] = [state];
  if (currentMinutes >= 540 && currentMinutes < 1020) {
    progress.push(`Dials: ${dialsToday}/20 minimum`);
    if (blocksTotal > 0) {
      progress.push(`Blocks: ${blocksCompleted}/${blocksTotal} completed`);
    }
    if (!checkedIn) progress.push('⚠️ Not checked in yet.');
  }

  return progress.join('\n');
}
