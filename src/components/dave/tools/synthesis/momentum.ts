import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

export async function momentumCheck(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

  const [oppsRes, tasksRes, journalRes] = await Promise.all([
    supabase.from('opportunities').select('id, name, arr, stage, status, last_touch_date, created_at').eq('user_id', userId).not('status', 'in', '("closed-lost")'),
    supabase.from('tasks').select('id, status, completed_at').eq('user_id', userId).gte('completed_at', sevenDaysAgo),
    supabase.from('daily_journal_entries').select('date, dials, conversations, meetings_set, daily_score').eq('user_id', userId).gte('date', sevenDaysAgo).order('date'),
  ]);

  const opps = (oppsRes.data || []) as Array<{ arr: number | null; status: string | null; last_touch_date: string | null; created_at: string }>;
  const completedTasks = (tasksRes.data || []).filter((t: { status: string }) => t.status === 'done').length;
  const journal = (journalRes.data || []) as Array<{ dials: number; meetings_set: number }>;

  const activeOpps = opps.filter(o => o.status === 'active');
  const totalPipeline = activeOpps.reduce((s, o) => s + (o.arr || 0), 0);
  const newDeals = opps.filter(o => o.created_at >= sevenDaysAgo).length;
  const staleDeals = activeOpps.filter(o => o.last_touch_date && o.last_touch_date < sevenDaysAgo).length;

  const avgDials = journal.length ? Math.round(journal.reduce((s, j) => s + (j.dials || 0), 0) / journal.length) : 0;
  const avgMeetings = journal.length ? Math.round(journal.reduce((s, j) => s + (j.meetings_set || 0), 0) / journal.length * 10) / 10 : 0;

  let summary = `📊 7-Day Momentum:\n`;
  summary += `Pipeline: $${Math.round(totalPipeline / 1000)}k across ${activeOpps.length} deals\n`;
  summary += `New deals: ${newDeals} | Stale deals: ${staleDeals}\n`;
  summary += `Tasks completed: ${completedTasks}\n`;
  summary += `Avg daily: ${avgDials} dials, ${avgMeetings} meetings set\n`;

  if (staleDeals > 2) summary += '\n⚠️ Multiple stale deals — re-engage or qualify out.';
  if (avgDials < 10) summary += '\n⚠️ Low dial volume — consider a power hour.';
  if (newDeals === 0) summary += '\n⚠️ No new pipeline created this week.';

  return summary;
}

export async function nextAction(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = new Date().toISOString().split('T')[0];
  const now = new Date();

  const [tasksRes, calendarRes, oppsRes, journalRes] = await Promise.all([
    supabase.from('tasks').select('id, title, due_date, priority, linked_account_id, linked_opportunity_id').eq('user_id', userId).not('status', 'in', '("done","dropped")').lte('due_date', today).order('priority', { ascending: true }).limit(10),
    supabase.from('calendar_events').select('id, title, start_time, description').eq('user_id', userId).gte('start_time', now.toISOString()).lte('start_time', new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString()).order('start_time', { ascending: true }).limit(3),
    supabase.from('opportunities').select('id, name, arr, close_date, last_touch_date, status').eq('user_id', userId).eq('status', 'active').order('arr', { ascending: false }).limit(20),
    supabase.from('daily_journal_entries').select('checked_in, dials, conversations').eq('user_id', userId).eq('date', today).maybeSingle(),
  ]);

  const candidates: { action: string; score: number; reason: string }[] = [];

  for (const task of (tasksRes.data || []) as Array<{ title: string; priority: string | null }>) {
    const priorityWeight = task.priority === 'P1' ? 3 : task.priority === 'P2' ? 2 : 1;
    candidates.push({ action: `Complete overdue task: "${task.title}"`, score: 60 * priorityWeight, reason: `Overdue ${task.priority || 'P3'} task` });
  }

  for (const event of (calendarRes.data || []) as Array<{ title: string; start_time: string }>) {
    const minsAway = Math.max(0, (new Date(event.start_time).getTime() - now.getTime()) / 60000);
    candidates.push({ action: `Prep for meeting: "${event.title}" (in ${Math.round(minsAway)} min)`, score: minsAway < 30 ? 200 : 120, reason: `Meeting in ${Math.round(minsAway)} minutes` });
  }

  for (const opp of (oppsRes.data || []) as Array<{ name: string; arr: number | null; last_touch_date: string | null }>) {
    if (!opp.last_touch_date) continue;
    const daysSinceTouch = Math.ceil((now.getTime() - new Date(opp.last_touch_date).getTime()) / 86400000);
    if (daysSinceTouch >= 7) {
      candidates.push({ action: `Re-engage stale deal: "${opp.name}" ($${((opp.arr || 0) / 1000).toFixed(0)}k)`, score: (opp.arr || 0) / 1000 * (daysSinceTouch / 7), reason: `${daysSinceTouch} days since last touch, $${((opp.arr || 0) / 1000).toFixed(0)}k ARR` });
    }
  }

  const journal = journalRes.data as { checked_in: boolean } | null;
  if (!journal?.checked_in && now.getHours() >= 16) {
    candidates.push({ action: 'Complete your daily journal check-in', score: 40, reason: 'After 4pm and not checked in yet' });
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return '✅ Nothing urgent — you\'re caught up! Consider prospecting or prepping for tomorrow.';

  const top = candidates[0];
  const runners = candidates.slice(1, 3);

  return `🎯 #1 Priority Right Now:\n${top.action}\nWhy: ${top.reason}${runners.length ? `\n\nAlso consider:\n${runners.map((r, i) => `${i + 2}. ${r.action} (${r.reason})`).join('\n')}` : ''}`;
}

export async function killSwitch(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = Date.now();
  const { data: opps } = await supabase
    .from('opportunities')
    .select('id, name, arr, stage, last_touch_date, created_at, status')
    .eq('user_id', userId)
    .eq('status', 'active')
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
