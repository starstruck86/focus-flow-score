import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

export async function momentumCheck(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

  const [oppsRes, tasksRes, journalRes] = await Promise.all([
    // HARD FILTER: only active opps
    supabase.from('opportunities').select('id, name, arr, stage, status, last_touch_date, created_at')
      .eq('user_id', userId).eq('status', 'active'),
    supabase.from('tasks').select('id, status, completed_at').eq('user_id', userId).gte('completed_at', sevenDaysAgo),
    supabase.from('daily_journal_entries').select('date, dials, conversations, meetings_set, daily_score')
      .eq('user_id', userId).gte('date', sevenDaysAgo).order('date'),
  ]);

  const opps = (oppsRes.data || []) as Array<{ arr: number | null; status: string | null; last_touch_date: string | null; created_at: string }>;
  const completedTasks = (tasksRes.data || []).filter((t: { status: string }) => t.status === 'done').length;
  const journal = (journalRes.data || []) as Array<{ dials: number; meetings_set: number }>;

  const totalPipeline = opps.reduce((s, o) => s + (o.arr || 0), 0);
  const newDeals = opps.filter(o => o.created_at >= sevenDaysAgo).length;
  const staleDeals = opps.filter(o => o.last_touch_date && o.last_touch_date < sevenDaysAgo).length;

  const avgDials = journal.length ? Math.round(journal.reduce((s, j) => s + (j.dials || 0), 0) / journal.length) : 0;
  const avgMeetings = journal.length ? Math.round(journal.reduce((s, j) => s + (j.meetings_set || 0), 0) / journal.length * 10) / 10 : 0;

  let summary = `📊 7-Day Momentum:\n`;
  summary += `Pipeline: $${Math.round(totalPipeline / 1000)}k across ${opps.length} active deals\n`;
  summary += `New deals: ${newDeals} | Stale deals: ${staleDeals}\n`;
  summary += `Tasks completed: ${completedTasks}\n`;
  summary += `Avg daily: ${avgDials} dials, ${avgMeetings} meetings set\n`;

  // DUAL-MOTION ASSESSMENT
  if (staleDeals > 2 && newDeals === 0) {
    summary += '\n🔴 Pipeline at risk — stale deals AND no new creation. Prioritize closing actions first, then create pipeline.';
  } else if (staleDeals > 2) {
    summary += '\n⚠️ Multiple stale deals — re-engage or qualify out.';
  } else if (newDeals === 0) {
    summary += '\n⚠️ No new pipeline created this week — increase prospecting.';
  }
  if (avgDials < 10) summary += '\n⚠️ Low dial volume — consider a power hour.';

  return summary;
}

export async function nextAction(ctx: ToolContext): Promise<string> {
  // Delegate to primaryAction — single action, no competing list
  const { primaryAction } = await import('./primaryAction');
  return primaryAction(ctx);
}

export async function killSwitch(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = Date.now();
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, name, arr, stage, last_touch_date, created_at, status')
    .eq('user_id', userId)
    .eq('status', 'active') // HARD FILTER: only active
    .order('arr', { ascending: true })
    .limit(50);

  if (!opps?.length) return 'No active deals to evaluate.';

  const killCandidates = opps.filter((o: { arr: number | null; last_touch_date: string | null; created_at: string }) => {
    const arrK = (o.arr || 0) / 1000;
    const daysSinceTouch = o.last_touch_date
      ? Math.ceil((now - new Date(o.last_touch_date).getTime()) / 86400000)
      : 999;
    const daysInPipeline = o.created_at
      ? Math.ceil((now - new Date(o.created_at).getTime()) / 86400000)
      : 0;

    if (arrK < 10 && daysSinceTouch > 21) return true;
    if (daysSinceTouch > 45) return true;
    if (daysInPipeline > 120 && daysSinceTouch > 14) return true;
    return false;
  });

  if (killCandidates.length === 0) return '✅ No low-value or stale deals to deprioritize. Pipeline looks clean.';

  let result = `⚡ ${killCandidates.length} deal${killCandidates.length > 1 ? 's' : ''} to consider deprioritizing:\n\n`;
  killCandidates.forEach((o: { name: string; arr: number | null; last_touch_date: string | null; stage: string | null }) => {
    const arrK = (o.arr || 0) / 1000;
    const daysSinceTouch = o.last_touch_date
      ? Math.ceil((now - new Date(o.last_touch_date).getTime()) / 86400000)
      : 999;
    result += `• **${o.name}** — $${arrK.toFixed(0)}k, ${daysSinceTouch}d since touch, stage: ${o.stage || '?'}\n`;
  });
  result += `\nSay "close lost" or "deprioritize" for any of these to free up focus.`;
  return result;
}
