/**
 * Dave tool: daily_game_plan_walkthrough
 * Reads real dashboard data and returns a concise spoken walkthrough.
 */
import { supabase } from '@/integrations/supabase/client';
import { formatTimeETLabel, todayInAppTz } from '@/lib/timeFormat';
import type { ToolContext } from '../../toolTypes';

export async function dailyGamePlanWalkthrough(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = todayInAppTz();
  const now = new Date();

  // Fetch all data in parallel
  const [calendarRes, tasksRes, oppsRes, renewalsRes, journalRes, timeBlocksRes] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('id, title, start_time, end_time, all_day, location')
      .eq('user_id', userId)
      .gte('start_time', `${today}T00:00:00`)
      .lte('start_time', `${today}T23:59:59`)
      .order('start_time'),
    supabase
      .from('tasks')
      .select('id, title, priority, due_date, linked_account_id')
      .eq('user_id', userId)
      .not('status', 'in', '("done","dropped")')
      .lte('due_date', today)
      .order('priority')
      .limit(15),
    supabase
      .from('opportunities')
      .select('id, name, arr, next_step, next_step_date, last_touch_date, close_date, status, account_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('arr', { ascending: false })
      .limit(20),
    supabase
      .from('renewals')
      .select('id, account_name, arr, renewal_due, churn_risk, next_step')
      .eq('user_id', userId)
      .limit(20),
    supabase
      .from('daily_journal_entries')
      .select('checked_in, daily_score, focus_mode, tomorrow_priority')
      .eq('user_id', userId)
      .eq('date', today)
      .maybeSingle(),
    supabase
      .from('daily_time_blocks')
      .select('blocks, ai_reasoning, key_metric_targets, focus_hours_available, meeting_load_hours')
      .eq('user_id', userId)
      .eq('plan_date', today)
      .maybeSingle(),
  ]);

  type CalEvent = { id: string; title: string; start_time: string; end_time: string | null; all_day: boolean; location: string | null };
  type TaskRow = { id: string; title: string; priority: string | null; due_date: string | null; linked_account_id: string | null };
  type OppRow = { id: string; name: string; arr: number | null; next_step: string | null; last_touch_date: string | null; close_date: string | null };
  type RenewalRow = { id: string; account_name: string; arr: number | null; renewal_due: string; churn_risk: string | null };

  const events = (calendarRes.data || []) as CalEvent[];
  const tasks = (tasksRes.data || []) as TaskRow[];
  const opps = (oppsRes.data || []) as OppRow[];
  const renewals = (renewalsRes.data || []) as RenewalRow[];
  const journal = journalRes.data as { checked_in: boolean; daily_score: number | null; focus_mode: string; tomorrow_priority: string | null } | null;
  const timeBlocks = timeBlocksRes.data as { blocks: unknown; ai_reasoning: string | null; key_metric_targets: unknown; focus_hours_available: number | null; meeting_load_hours: number | null } | null;

  const parts: string[] = [];

  // ── Header ──
  parts.push(`📋 DAILY GAME PLAN — ${today}`);

  // ── Time blocks summary ──
  if (timeBlocks) {
    const focusHrs = timeBlocks.focus_hours_available ?? 0;
    const meetingHrs = timeBlocks.meeting_load_hours ?? 0;
    parts.push(`\n⏱️ Today's structure: ${focusHrs.toFixed(1)}h focus time, ${meetingHrs.toFixed(1)}h in meetings.`);
    if (timeBlocks.ai_reasoning) {
      parts.push(`Strategy: ${timeBlocks.ai_reasoning.slice(0, 200)}`);
    }
  }

  // ── Yesterday's commitment ──
  if (journal?.tomorrow_priority) {
    parts.push(`\n🔁 Yesterday you committed to: "${journal.tomorrow_priority}"`);
  }

  // ── Meetings timeline ──
  const timedEvents = events.filter(e => !e.all_day);
  const allDayEvents = events.filter(e => e.all_day);

  if (allDayEvents.length) {
    parts.push(`\n📌 All-day: ${allDayEvents.map(e => e.title).join(', ')}`);
  }

  if (timedEvents.length) {
    parts.push(`\n📅 Meetings (${timedEvents.length}):`);
    for (const e of timedEvents) {
      const time = formatTimeETLabel(e.start_time);
      const minsUntil = Math.round((new Date(e.start_time).getTime() - now.getTime()) / 60000);
      const urgency = minsUntil > 0 && minsUntil <= 30 ? ' ⚡ SOON' : minsUntil <= 0 ? ' 🔴 NOW' : '';
      parts.push(`  • ${time} — ${e.title}${urgency}`);
    }
  } else {
    parts.push('\n📅 No meetings today — full focus day.');
  }

  // ── Top tasks ──
  const overdue = tasks.filter(t => t.due_date && t.due_date < today);
  const dueToday = tasks.filter(t => t.due_date === today);
  const p0p1 = tasks.filter(t => t.priority === 'P0' || t.priority === 'P1');

  if (overdue.length || dueToday.length) {
    parts.push(`\n✅ Tasks: ${dueToday.length} due today${overdue.length ? `, ${overdue.length} overdue` : ''}`);
    const topTasks = p0p1.length ? p0p1 : tasks.slice(0, 3);
    for (const t of topTasks.slice(0, 4)) {
      const tag = t.due_date && t.due_date < today ? '⚠️ OVERDUE' : t.priority || '';
      parts.push(`  • ${t.title} ${tag}`);
    }
  }

  // ── Risks ──
  const risks: string[] = [];

  // Stale deals
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const staleDeals = opps.filter(o => o.last_touch_date && o.last_touch_date < sevenDaysAgo);
  if (staleDeals.length) {
    risks.push(`${staleDeals.length} deal${staleDeals.length > 1 ? 's' : ''} going stale (7+ days no touch)`);
  }

  // Missing next steps
  const noNextStep = opps.filter(o => !o.next_step);
  if (noNextStep.length) {
    risks.push(`${noNextStep.length} deal${noNextStep.length > 1 ? 's' : ''} missing next steps`);
  }

  // Renewals at risk
  const atRiskRenewals = renewals.filter(r => {
    const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
    return days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain');
  });
  if (atRiskRenewals.length) {
    const totalArr = atRiskRenewals.reduce((s, r) => s + (r.arr || 0), 0);
    risks.push(`${atRiskRenewals.length} renewal${atRiskRenewals.length > 1 ? 's' : ''} at risk ($${Math.round(totalArr / 1000)}k ARR)`);
  }

  if (risks.length) {
    parts.push(`\n🚨 Risks:\n${risks.map(r => `  • ${r}`).join('\n')}`);
  }

  // ── Focus recommendation ──
  const nextMeeting = timedEvents.find(e => new Date(e.start_time).getTime() > now.getTime());
  if (nextMeeting) {
    const minsUntil = Math.round((new Date(nextMeeting.start_time).getTime() - now.getTime()) / 60000);
    if (minsUntil <= 30) {
      parts.push(`\n🎯 Focus now: Prep for "${nextMeeting.title}" — it starts in ${minsUntil} minutes.`);
    } else if (minsUntil <= 90) {
      parts.push(`\n🎯 Focus now: You have ${minsUntil} min before "${nextMeeting.title}." ${overdue.length ? 'Knock out overdue tasks.' : 'Use for prospecting or deal advancement.'}`);
    } else {
      parts.push(`\n🎯 Focus now: ${overdue.length ? `Clear ${overdue.length} overdue tasks first.` : p0p1.length ? `Tackle your ${p0p1[0].priority} task: "${p0p1[0].title}."` : 'Prospecting block or deal work.'}`);
    }
  } else if (!timedEvents.length) {
    parts.push(`\n🎯 Focus now: ${overdue.length ? `Clear ${overdue.length} overdue tasks.` : 'Deep work — prospecting or deal advancement.'}`);
  }

  return parts.join('\n');
}
