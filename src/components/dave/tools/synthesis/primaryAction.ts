import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { ToolContext } from '../../toolTypes';

interface Candidate {
  id: string;
  action: string;
  why: string;
  nextStep: string;
  score: number;
}

export async function primaryAction(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];

  const [tasksRes, oppsRes, renewalsRes, calendarRes] = await Promise.all([
    supabase.from('tasks').select('id, title, due_date, priority, linked_account_id').eq('user_id', userId).not('status', 'in', '("done","dropped")').lte('due_date', todayStr).order('priority').limit(10),
    supabase.from('opportunities').select('id, name, arr, next_step, next_step_date, last_touch_date, status').eq('user_id', userId).eq('status', 'active').order('arr', { ascending: false }).limit(20),
    supabase.from('renewals').select('id, account_name, arr, renewal_due, churn_risk, next_step').eq('user_id', userId).limit(20),
    supabase.from('calendar_events').select('id, title, start_time').eq('user_id', userId).gte('start_time', now.toISOString()).lte('start_time', new Date(now.getTime() + 2 * 3600000).toISOString()).order('start_time').limit(3),
  ]);

  const candidates: Candidate[] = [];

  for (const e of (calendarRes.data || []) as Array<{ id: string; title: string; start_time: string }>) {
    const mins = Math.max(0, (new Date(e.start_time).getTime() - now.getTime()) / 60000);
    candidates.push({ id: `meeting-${e.id}`, action: `Prep for "${e.title}" (${Math.round(mins)} min away)`, why: 'Upcoming meeting needs preparation', nextStep: 'Review account context and set your call goals.', score: mins < 30 ? 250 : 150 });
  }

  for (const r of (calendarRes.data || [], renewalsRes.data || []) as Array<{ id: string; account_name: string; arr: number | null; renewal_due: string; churn_risk: string | null; next_step: string | null }>) {
    const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
    if (days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain')) {
      candidates.push({ id: `renewal-${r.id}`, action: `Address renewal risk: ${r.account_name}`, why: `$${((r.arr || 0) / 1000).toFixed(0)}k renewal in ${days} days, ${r.churn_risk} risk`, nextStep: r.next_step || 'Schedule a risk mitigation call.', score: 200 + (r.arr || 0) / 1000 });
    }
  }

  for (const t of (tasksRes.data || []) as Array<{ id: string; title: string; priority: string | null }>) {
    const pw = t.priority === 'P0' ? 5 : t.priority === 'P1' ? 4 : t.priority === 'P2' ? 2 : 1;
    candidates.push({ id: `task-${t.id}`, action: t.title, why: `${t.priority} task overdue`, nextStep: 'Complete or reschedule now.', score: 60 * pw });
  }

  for (const o of (oppsRes.data || []) as Array<{ id: string; name: string; arr: number | null; next_step: string | null; next_step_date: string | null }>) {
    if (!o.next_step && !o.next_step_date) {
      candidates.push({ id: `opp-ns-${o.id}`, action: `Set next step on "${o.name}"`, why: `$${((o.arr || 0) / 1000).toFixed(0)}k deal with no defined next step`, nextStep: 'Define what advances this deal.', score: 100 + (o.arr || 0) / 2000 });
    }
  }

  const memoryRaw = localStorage.getItem('jarvis-action-memory');
  if (memoryRaw) {
    try {
      const records = JSON.parse(memoryRaw) as Array<{ actionId: string; outcome: string; timestamp: number }>;
      const weekAgo = Date.now() - 7 * 86400000;
      for (const c of candidates) {
        const ignores = records.filter(r => r.actionId === c.id && r.outcome === 'ignored' && r.timestamp > weekAgo).length;
        if (ignores >= 3) c.score *= 0.5;
        else if (ignores >= 1) c.score *= 0.8;
      }
    } catch {}
  }

  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length === 0) return '✅ No urgent actions — you\'re clear to execute at will.';

  const top = candidates[0];
  return `🎯 ${top.action}\n\nWhy: ${top.why}\nNext step: ${top.nextStep}\n\n[action_id: ${top.id}]`;
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
