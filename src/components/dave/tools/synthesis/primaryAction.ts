import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { getCurrentMinutesET, todayInAppTz } from '@/lib/timeFormat';
import type { ToolContext } from '../../toolTypes';

interface Candidate {
  id: string;
  action: string;
  why: string;
  nextStep: string;
  deadline: string;
  score: number;
  category: 'close' | 'create' | 'pace' | 'prep';
}

type WorkBlock = 'prospecting' | 'calls' | 'meetings' | 'admin' | 'unknown';

/** Detect current work block from daily plan */
async function detectCurrentBlock(userId: string): Promise<{ block: WorkBlock; label: string }> {
  const todayStr = todayInAppTz();
  const currentMinutes = getCurrentMinutesET();

  const { data: plans } = await supabase
    .from('daily_time_blocks')
    .select('blocks')
    .eq('user_id', userId)
    .eq('plan_date', todayStr)
    .limit(1);

  if (plans?.length) {
    const blocks = (plans[0].blocks || []) as Array<{
      label?: string; type?: string; start_time?: string; end_time?: string;
    }>;

    for (const b of blocks) {
      if (!b.start_time || !b.end_time) continue;
      const [sh, sm] = b.start_time.split(':').map(Number);
      const [eh, em] = b.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;
      if (currentMinutes >= startMin && currentMinutes < endMin) {
        const label = (b.label || b.type || '').toLowerCase();
        if (label.includes('prospect') || label.includes('hunter') || label.includes('power hour') || label.includes('build'))
          return { block: 'prospecting', label: b.label || 'Prospecting' };
        if (label.includes('call') || label.includes('dial'))
          return { block: 'calls', label: b.label || 'Call Block' };
        if (label.includes('meeting') || label.includes('prep'))
          return { block: 'meetings', label: b.label || 'Meeting Prep' };
        if (label.includes('admin'))
          return { block: 'admin', label: b.label || 'Admin' };
      }
    }
  }

  return { block: 'unknown', label: 'Open' };
}

export async function primaryAction(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const todayStr = todayInAppTz();
  const currentMinutes = getCurrentMinutesET();

  // Detect current block for contextual gating
  const currentBlock = await detectCurrentBlock(userId);

  const [tasksRes, oppsRes, renewalsRes, calendarRes, journalRes] = await Promise.all([
    supabase.from('tasks').select('id, title, due_date, priority, linked_account_id, linked_opportunity_id')
      .eq('user_id', userId)
      .not('status', 'in', '("done","dropped")')
      .lte('due_date', todayStr)
      .order('priority').limit(10),
    // HARD FILTER: only active opps — closed-won/lost NEVER surface
    supabase.from('opportunities').select('id, name, arr, next_step, next_step_date, last_touch_date, close_date, status, stage')
      .eq('user_id', userId)
      .eq('status', 'active')
      .order('arr', { ascending: false }).limit(20),
    supabase.from('renewals').select('id, account_name, arr, renewal_due, churn_risk, next_step, linked_opportunity_id')
      .eq('user_id', userId).limit(20),
    supabase.from('calendar_events').select('id, title, start_time')
      .eq('user_id', userId)
      .gte('start_time', now.toISOString())
      .lte('start_time', new Date(now.getTime() + 2 * 3600000).toISOString())
      .order('start_time').limit(3),
    supabase.from('daily_journal_entries').select('dials, conversations, meetings_set')
      .eq('user_id', userId).eq('date', todayStr).maybeSingle(),
  ]);

  const candidates: Candidate[] = [];
  const journal = journalRes.data as { dials: number; conversations: number; meetings_set: number } | null;

  // 1. MEETING PREP — contextually gated: only if meeting is <30 min away
  for (const e of (calendarRes.data || []) as Array<{ id: string; title: string; start_time: string }>) {
    const mins = Math.max(0, (new Date(e.start_time).getTime() - now.getTime()) / 60000);
    if (mins > 30) continue; // Only surface imminent meetings
    const deadlineStr = `before ${new Date(e.start_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' })}`;
    candidates.push({
      id: `meeting-${e.id}`,
      action: `Prep for "${e.title}"`,
      why: `Meeting starts in ${Math.round(mins)} minutes`,
      nextStep: 'Review account context and set call goals',
      deadline: deadlineStr,
      score: 300, // Imminent meetings always win
      category: 'prep',
    });
  }

  // 2. AT-RISK RENEWALS — only open, actionable ones
  for (const r of (renewalsRes.data || []) as Array<{ id: string; account_name: string; arr: number | null; renewal_due: string; churn_risk: string | null; next_step: string | null; linked_opportunity_id: string | null }>) {
    const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
    if (days > 30) continue;
    if (r.churn_risk !== 'high' && r.churn_risk !== 'certain') continue;
    const arrK = (r.arr || 0) / 1000;
    candidates.push({
      id: `renewal-${r.id}`,
      action: `Address renewal risk: ${r.account_name}`,
      why: `$${arrK.toFixed(0)}k renewal in ${days} days, ${r.churn_risk} churn risk`,
      nextStep: r.next_step || 'Schedule a risk mitigation call',
      deadline: `${days} days to renewal`,
      score: 200 + arrK,
      category: 'close',
    });
  }

  // 3. OVERDUE TASKS — only actionable
  for (const t of (tasksRes.data || []) as Array<{ id: string; title: string; priority: string | null }>) {
    const pw = t.priority === 'P0' ? 6 : t.priority === 'P1' ? 4 : t.priority === 'P2' ? 2 : 1;
    candidates.push({
      id: `task-${t.id}`,
      action: t.title,
      why: `${t.priority || 'P3'} task overdue`,
      nextStep: 'Complete or reschedule now',
      deadline: 'today',
      score: 60 * pw,
      category: 'pace',
    });
  }

  // 4. STALE ACTIVE DEALS — missing next step or no touch >7d
  for (const o of (oppsRes.data || []) as Array<{ id: string; name: string; arr: number | null; next_step: string | null; next_step_date: string | null; last_touch_date: string | null; close_date: string | null }>) {
    const arrK = (o.arr || 0) / 1000;
    if (!o.next_step && !o.next_step_date) {
      candidates.push({
        id: `opp-ns-${o.id}`,
        action: `Set next step on "${o.name}"`,
        why: `$${arrK.toFixed(0)}k deal with no defined next step`,
        nextStep: 'Define what advances this deal',
        deadline: 'today',
        score: 100 + arrK / 2,
        category: 'close',
      });
    }
    // Stale touch on high-value deals
    if (o.last_touch_date) {
      const daysSinceTouch = Math.ceil((now.getTime() - new Date(o.last_touch_date).getTime()) / 86400000);
      if (daysSinceTouch >= 7 && arrK >= 20) {
        candidates.push({
          id: `opp-stale-${o.id}`,
          action: `Re-engage "${o.name}" — ${daysSinceTouch}d since last touch`,
          why: `$${arrK.toFixed(0)}k deal going cold`,
          nextStep: o.next_step || 'Call or email the primary contact',
          deadline: 'today',
          score: 90 + arrK / 2 + daysSinceTouch,
          category: 'close',
        });
      }
    }
  }

  // 5. PACE CHECK — dial deficit (contextual: only during work hours 9-17)
  if (currentMinutes >= 540 && currentMinutes < 1020) {
    const dialsToday = journal?.dials || 0;
    const hoursLeft = (1020 - currentMinutes) / 60;
    if (dialsToday < 20 && hoursLeft > 1) {
      const dialsNeeded = 20 - dialsToday;
      candidates.push({
        id: 'pace-dials',
        action: `Make ${dialsNeeded} more dials to hit minimum`,
        why: `${dialsToday} dials so far — minimum is 20`,
        nextStep: 'Start a call block now',
        deadline: 'by 5 PM',
        score: 70 + (dialsNeeded * 2),
        category: 'pace',
      });
    }
  }

  // Apply action memory — deprioritize repeatedly ignored actions
  const memoryRaw = localStorage.getItem('jarvis-action-memory');
  if (memoryRaw) {
    try {
      const records = JSON.parse(memoryRaw) as Array<{ actionId: string; outcome: string; timestamp: number }>;
      const weekAgo = Date.now() - 7 * 86400000;
      for (const c of candidates) {
        const ignores = records.filter(r => r.actionId === c.id && (r.outcome === 'ignored' || r.outcome === 'skipped') && r.timestamp > weekAgo).length;
        if (ignores >= 3) c.score *= 0.5;
        else if (ignores >= 1) c.score *= 0.8;
      }
    } catch {}
  }

  // DETERMINISTIC SORT: score desc, then by category priority (close > create > pace > prep already scored), then by id for stability
  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));

  if (candidates.length === 0) return '✅ No urgent actions — you\'re clear to execute at will.';

  // SINGLE ACTION — always return exactly one
  const top = candidates[0];
  return `🎯 ${top.action}\n\nWhy: ${top.why}\nNext step: ${top.nextStep}\nDeadline: ${top.deadline}\n\n[action_id: ${top.id}]`;
}

export async function completeAction(params: { actionId: string }): Promise<string> {
  try {
    const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
    records.push({ actionId: params.actionId, outcome: 'completed', timestamp: Date.now() });
    localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
  } catch {}
  toast.success('Action completed — advancing to next.');
  return 'Action marked complete. Ask me for the next primary action.';
}

export async function deferAction(params: { actionId: string; reason?: string }): Promise<string> {
  try {
    const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
    records.push({ actionId: params.actionId, outcome: 'ignored', timestamp: Date.now() });
    localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
  } catch {}
  return 'Deferred — this will be deprioritized. Ask for the next primary action.';
}
