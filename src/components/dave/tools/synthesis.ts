import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitDataChanged } from '@/lib/daveEvents';
import type { ToolContext, ToolMap } from '../toolTypes';

export function createSynthesisTools(ctx: ToolContext, allTools: Record<string, any>): ToolMap {
  return {
    operating_state: async () => {
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

      const tasks = (tasksRes.data || []) as any[];
      const opps = (oppsRes.data || []) as any[];
      const renewals = (renewalsRes.data || []) as any[];

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
        const issues = [];
        if (overdue > 0) issues.push(`${overdue} overdue`);
        if (staleDeals > 0) issues.push(`${staleDeals} stale deals`);
        return `🟠 Drifting — ${issues.join(', ')}.`;
      }
      return `🔴 Reactive — follow-ups lagging, territory going cold.`;
    },

    primary_action: async () => {
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

      interface Candidate { id: string; action: string; why: string; nextStep: string; score: number }
      const candidates: Candidate[] = [];

      for (const e of (calendarRes.data || []) as any[]) {
        const mins = Math.max(0, (new Date(e.start_time).getTime() - now.getTime()) / 60000);
        candidates.push({ id: `meeting-${e.id}`, action: `Prep for "${e.title}" (${Math.round(mins)} min away)`, why: 'Upcoming meeting needs preparation', nextStep: 'Review account context and set your call goals.', score: mins < 30 ? 250 : 150 });
      }

      for (const r of (renewalsRes.data || []) as any[]) {
        const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
        if (days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain')) {
          candidates.push({ id: `renewal-${r.id}`, action: `Address renewal risk: ${r.account_name}`, why: `$${((r.arr || 0) / 1000).toFixed(0)}k renewal in ${days} days, ${r.churn_risk} risk`, nextStep: r.next_step || 'Schedule a risk mitigation call.', score: 200 + (r.arr || 0) / 1000 });
        }
      }

      for (const t of (tasksRes.data || []) as any[]) {
        const pw = t.priority === 'P0' ? 5 : t.priority === 'P1' ? 4 : t.priority === 'P2' ? 2 : 1;
        candidates.push({ id: `task-${t.id}`, action: t.title, why: `${t.priority} task overdue`, nextStep: 'Complete or reschedule now.', score: 60 * pw });
      }

      for (const o of (oppsRes.data || []) as any[]) {
        if (!o.next_step && !o.next_step_date) {
          candidates.push({ id: `opp-ns-${o.id}`, action: `Set next step on "${o.name}"`, why: `$${((o.arr || 0) / 1000).toFixed(0)}k deal with no defined next step`, nextStep: 'Define what advances this deal.', score: 100 + (o.arr || 0) / 2000 });
        }
      }

      const memoryRaw = localStorage.getItem('jarvis-action-memory');
      if (memoryRaw) {
        try {
          const records = JSON.parse(memoryRaw) as any[];
          const weekAgo = Date.now() - 7 * 86400000;
          for (const c of candidates) {
            const ignores = records.filter((r: any) => r.actionId === c.id && r.outcome === 'ignored' && r.timestamp > weekAgo).length;
            if (ignores >= 3) c.score *= 0.5;
            else if (ignores >= 1) c.score *= 0.8;
          }
        } catch {}
      }

      candidates.sort((a, b) => b.score - a.score);
      if (candidates.length === 0) return '✅ No urgent actions — you\'re clear to execute at will.';

      const top = candidates[0];
      return `🎯 ${top.action}\n\nWhy: ${top.why}\nNext step: ${top.nextStep}\n\n[action_id: ${top.id}]`;
    },

    complete_action: async (params: { actionId: string }) => {
      try {
        const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
        records.push({ actionId: params.actionId, outcome: 'completed', timestamp: Date.now() });
        localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
      } catch {}
      toast.success('Action completed — advancing to next.');
      return 'Action marked complete. Ask me for the next primary action.';
    },

    defer_action: async (params: { actionId: string; reason?: string }) => {
      try {
        const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
        records.push({ actionId: params.actionId, outcome: 'ignored', timestamp: Date.now() });
        localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-100)));
      } catch {}
      return 'Deferred — this will be deprioritized. Ask for the next primary action.';
    },

    execution_brief: async () => {
      const stateResult = await allTools.operating_state();
      const actionResult = await allTools.primary_action();
      return `${stateResult}\n\n${actionResult}`;
    },

    momentum_check: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];

      const [oppsRes, tasksRes, journalRes] = await Promise.all([
        supabase.from('opportunities').select('id, name, arr, stage, status, last_touch_date, created_at').eq('user_id', userId).not('status', 'in', '("closed-lost")'),
        supabase.from('tasks').select('id, status, completed_at').eq('user_id', userId).gte('completed_at', sevenDaysAgo),
        supabase.from('daily_journal_entries').select('date, dials, conversations, meetings_set, daily_score').eq('user_id', userId).gte('date', sevenDaysAgo).order('date'),
      ]);

      const opps = (oppsRes.data || []) as any[];
      const completedTasks = (tasksRes.data || []).filter((t: any) => t.status === 'done').length;
      const journal = (journalRes.data || []) as any[];

      const totalPipeline = opps.filter(o => o.status === 'active').reduce((s: number, o: any) => s + (o.arr || 0), 0);
      const newDeals = opps.filter(o => o.created_at >= sevenDaysAgo).length;
      const staleDeals = opps.filter(o => o.last_touch_date && o.last_touch_date < sevenDaysAgo && o.status === 'active').length;

      const avgDials = journal.length ? Math.round(journal.reduce((s: number, j: any) => s + (j.dials || 0), 0) / journal.length) : 0;
      const avgMeetings = journal.length ? Math.round(journal.reduce((s: number, j: any) => s + (j.meetings_set || 0), 0) / journal.length * 10) / 10 : 0;

      let summary = `📊 7-Day Momentum:\n`;
      summary += `Pipeline: $${Math.round(totalPipeline / 1000)}k across ${opps.filter(o => o.status === 'active').length} deals\n`;
      summary += `New deals: ${newDeals} | Stale deals: ${staleDeals}\n`;
      summary += `Tasks completed: ${completedTasks}\n`;
      summary += `Avg daily: ${avgDials} dials, ${avgMeetings} meetings set\n`;

      if (staleDeals > 2) summary += '\n⚠️ Multiple stale deals — re-engage or qualify out.';
      if (avgDials < 10) summary += '\n⚠️ Low dial volume — consider a power hour.';
      if (newDeals === 0) summary += '\n⚠️ No new pipeline created this week.';

      return summary;
    },

    next_action: async () => {
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

      for (const task of (tasksRes.data || []) as any[]) {
        const priorityWeight = task.priority === 'P1' ? 3 : task.priority === 'P2' ? 2 : 1;
        candidates.push({ action: `Complete overdue task: "${task.title}"`, score: 60 * priorityWeight, reason: `Overdue ${task.priority || 'P3'} task` });
      }

      for (const event of (calendarRes.data || []) as any[]) {
        const minsAway = Math.max(0, (new Date(event.start_time).getTime() - now.getTime()) / 60000);
        candidates.push({ action: `Prep for meeting: "${event.title}" (in ${Math.round(minsAway)} min)`, score: minsAway < 30 ? 200 : 120, reason: `Meeting in ${Math.round(minsAway)} minutes` });
      }

      for (const opp of (oppsRes.data || []) as any[]) {
        if (!opp.last_touch_date) continue;
        const daysSinceTouch = Math.ceil((now.getTime() - new Date(opp.last_touch_date).getTime()) / 86400000);
        if (daysSinceTouch >= 7) {
          candidates.push({ action: `Re-engage stale deal: "${opp.name}" ($${((opp.arr || 0) / 1000).toFixed(0)}k)`, score: (opp.arr || 0) / 1000 * (daysSinceTouch / 7), reason: `${daysSinceTouch} days since last touch, $${((opp.arr || 0) / 1000).toFixed(0)}k ARR` });
        }
      }

      const journal = journalRes.data as any;
      if (!journal?.checked_in && now.getHours() >= 16) {
        candidates.push({ action: 'Complete your daily journal check-in', score: 40, reason: 'After 4pm and not checked in yet' });
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length === 0) return '✅ Nothing urgent — you\'re caught up! Consider prospecting or prepping for tomorrow.';

      const top = candidates[0];
      const runners = candidates.slice(1, 3);

      return `🎯 #1 Priority Right Now:\n${top.action}\nWhy: ${top.reason}${runners.length ? `\n\nAlso consider:\n${runners.map((r, i) => `${i + 2}. ${r.action} (${r.reason})`).join('\n')}` : ''}`;
    },

    kill_switch: async () => {
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

      const killCandidates = opps.filter((o: any) => {
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
      killCandidates.forEach((o: any) => {
        const arrK = (o.arr || 0) / 1000;
        const daysSinceTouch = o.last_touch_date
          ? Math.ceil((now - new Date(o.last_touch_date).getTime()) / 86400000)
          : 999;
        result += `• **${o.name}** — $${arrK.toFixed(0)}k, ${daysSinceTouch}d since touch, stage: ${o.stage || '?'}\n`;
      });
      result += `\nSay "close lost" or "deprioritize" for any of these to free up focus.`;
      return result;
    },

    behavior_summary: () => {
      try {
        const raw = localStorage.getItem('jarvis-action-memory');
        if (!raw) return 'No action history yet — keep using the system and I\'ll learn your patterns.';
        const records = JSON.parse(raw) as any[];
        const monthAgo = Date.now() - 30 * 86400000;
        const recent = records.filter((r: any) => r.timestamp > monthAgo);
        if (recent.length < 5) return 'Not enough data yet — need a few more days of usage.';

        const completed = recent.filter((r: any) => r.outcome === 'completed').length;
        const ignored = recent.filter((r: any) => r.outcome === 'ignored').length;
        const deferred = recent.filter((r: any) => r.outcome === 'deferred').length;
        const rate = Math.round((completed / recent.length) * 100);

        const typeStats: Record<string, { c: number; t: number }> = {};
        for (const r of recent) {
          const t = r.entityType || 'unknown';
          if (!typeStats[t]) typeStats[t] = { c: 0, t: 0 };
          typeStats[t].t++;
          if (r.outcome === 'completed') typeStats[t].c++;
        }

        let summary = `📈 Action completion: ${rate}% (${completed} done, ${deferred} deferred, ${ignored} ignored).\n`;
        for (const [type, stats] of Object.entries(typeStats)) {
          if (stats.t >= 3) {
            summary += `${type}: ${Math.round((stats.c / stats.t) * 100)}% completion rate.\n`;
          }
        }
        return summary;
      } catch { return 'Unable to read behavior data.'; }
    },

    energy_match: async () => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data: whoop } = await supabase.from('whoop_daily_metrics').select('recovery_score, sleep_score, strain_score').eq('user_id', userId).eq('date', today).limit(1);
      const { data: journal } = await supabase.from('daily_journal_entries').select('energy, focus_quality, stress').eq('user_id', userId).eq('date', today).limit(1);

      const recovery = (whoop as any)?.[0]?.recovery_score;
      const energy = (journal as any)?.[0]?.energy;

      let energyLevel: 'high' | 'medium' | 'low' = 'medium';
      if (recovery !== undefined) energyLevel = recovery >= 67 ? 'high' : recovery >= 33 ? 'medium' : 'low';
      else if (energy !== undefined) energyLevel = energy >= 4 ? 'high' : energy >= 2 ? 'medium' : 'low';

      const recommendations: Record<string, string> = {
        high: '🟢 High energy — tackle strategy, prep, and complex deals. Best time for discovery calls and negotiations.',
        medium: '🟡 Moderate energy — good for follow-ups, CRM updates, and routine outreach. Save heavy thinking for later.',
        low: '🔴 Low energy — focus on admin, email clean-up, and light tasks. Avoid critical calls or negotiations.',
      };

      let result = recommendations[energyLevel];
      if (recovery !== undefined) result += `\nWHOOP recovery: ${recovery}%`;
      if (energy !== undefined) result += ` | Self-rated energy: ${energy}/5`;
      return result;
    },

    generate_content: async (params: { contentType: string; accountName?: string; opportunityName?: string; contactName?: string; customInstructions?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      let accountContext: any = null;
      let oppContext: any = null;
      let transcriptContext = '';
      let methodologyContext = '';

      if (params.accountName) {
        const { data: accounts } = await supabase.from('accounts').select('id, name, industry, notes').eq('user_id', userId).ilike('name', `%${params.accountName}%`).limit(1);
        if (accounts?.length) {
          accountContext = accounts[0];
          const { data: transcripts } = await supabase.from('call_transcripts').select('summary, call_date, call_type').eq('user_id', userId).eq('account_id', accountContext.id).order('call_date', { ascending: false }).limit(2);
          if (transcripts?.length) transcriptContext = (transcripts as any[]).map(t => `[${t.call_date} ${t.call_type}]: ${t.summary || 'No summary'}`).join('\n');
          const { data: contacts } = await supabase.from('contacts').select('name, title, buyer_role').eq('user_id', userId).eq('account_id', accountContext.id).limit(5);
          if (contacts?.length) accountContext.contacts = (contacts as any[]).map(c => `${c.name} (${c.title || 'N/A'}, ${c.buyer_role || 'N/A'})`).join(', ');
        }
      }

      if (params.opportunityName) {
        const { data: opps } = await supabase.from('opportunities').select('id, name, stage, arr, close_date, next_step').eq('user_id', userId).ilike('name', `%${params.opportunityName}%`).limit(1);
        if (opps?.length) {
          oppContext = opps[0];
          const { data: meth } = await supabase.from('opportunity_methodology' as any).select('*').eq('opportunity_id', oppContext.id).maybeSingle();
          if (meth) {
            const m = meth as any;
            const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].filter(f => !m[`${f}_confirmed`]);
            methodologyContext = `MEDDICC gaps: ${gaps.length ? gaps.join(', ') : 'All confirmed'}`;
          }
        }
      }

      const contextParts: string[] = [];
      if (accountContext) contextParts.push(`Account: ${accountContext.name} (${accountContext.industry || 'N/A'})`);
      if (oppContext) contextParts.push(`Deal: ${oppContext.name} — Stage: ${oppContext.stage}, ARR: $${oppContext.arr}, Close: ${oppContext.close_date}`);
      if (methodologyContext) contextParts.push(methodologyContext);
      if (transcriptContext) contextParts.push(`Recent calls:\n${transcriptContext}`);
      if (params.contactName) contextParts.push(`Key contact: ${params.contactName}`);

      const fullPrompt = `${params.customInstructions || `Generate a professional ${params.contentType}`}\n\nContext:\n${contextParts.join('\n')}`;

      try {
        const { streamToString } = await import('@/lib/streamingFetch');
        const { text: result, error } = await streamToString({
          functionName: 'build-resource',
          body: { type: 'generate', prompt: fullPrompt, outputType: params.contentType || 'email', accountContext: accountContext ? { name: accountContext.name, industry: accountContext.industry, contacts: accountContext.contacts } : undefined },
        });

        if (error) throw new Error(error);
        if (result && navigator.clipboard) { try { await navigator.clipboard.writeText(result); } catch {} }

        toast.success(`${params.contentType} generated`, { description: 'Copied to clipboard' });
        return `✅ Generated ${params.contentType}:\n\n${result.slice(0, 2000)}${result.length > 2000 ? '\n\n[...truncated, full content copied to clipboard]' : ''}`;
      } catch (e: any) {
        return `Failed to generate content: ${e.message}`;
      }
    },

    meeting_brief: async (params: { meetingTitle?: string }) => {
      const userId = await ctx.getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: events } = await supabase.from('calendar_events').select('id, title, start_time, end_time, description').eq('user_id', userId).gte('start_time', now).lte('start_time', tomorrow).order('start_time', { ascending: true }).limit(10);

      if (!events?.length) return 'No upcoming meetings found in the next 24 hours.';

      let target = events[0] as any;
      if (params.meetingTitle) {
        const match = (events as any[]).find(e => e.title.toLowerCase().includes(params.meetingTitle!.toLowerCase()));
        if (match) target = match;
      }

      const { data: accounts } = await supabase.from('accounts').select('id, name, industry, tier, notes, last_touch_date, account_status').eq('user_id', userId);

      const matchedAccount = (accounts || []).find((a: any) =>
        target.title.toLowerCase().includes(a.name.toLowerCase()) ||
        a.name.toLowerCase().includes(target.title.toLowerCase().replace(/meeting|call|sync|review|check-in|intro/gi, '').trim())
      ) as any;

      if (!matchedAccount) {
        return `📅 Next meeting: "${target.title}" at ${new Date(target.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\nCouldn't match to an account — try "prep meeting for [account name]" for a full brief.`;
      }

      const { data: opps } = await supabase.from('opportunities').select('id, name, stage, arr, close_date, next_step').eq('user_id', userId).eq('account_id', matchedAccount.id).not('status', 'eq', 'closed-won').not('status', 'eq', 'closed-lost').limit(3);

      let methSummary = '';
      if (opps?.length) {
        const { data: meth } = await supabase.from('opportunity_methodology' as any).select('*').eq('opportunity_id', opps[0].id).maybeSingle();
        if (meth) {
          const m = meth as any;
          const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'].filter(f => !m[`${f}_confirmed`]);
          methSummary = gaps.length ? `\n⚠️ MEDDICC Gaps: ${gaps.join(', ')}` : '\n✅ All MEDDICC confirmed';
        }
      }

      const { data: transcripts } = await supabase.from('call_transcripts').select('summary, call_date').eq('user_id', userId).eq('account_id', matchedAccount.id).order('call_date', { ascending: false }).limit(1);
      const { data: contacts } = await supabase.from('contacts').select('name, title, buyer_role').eq('user_id', userId).eq('account_id', matchedAccount.id).limit(5);

      const meetTime = new Date(target.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const minsAway = Math.round((new Date(target.start_time).getTime() - Date.now()) / 60000);

      let brief = `📋 MEETING BRIEF: "${target.title}" at ${meetTime} (${minsAway > 0 ? `in ${minsAway} min` : 'now'})\n\n`;
      brief += `🏢 ${matchedAccount.name} | ${matchedAccount.industry || 'N/A'} | Tier ${matchedAccount.tier || 'N/A'} | Status: ${matchedAccount.account_status || 'N/A'}\n`;

      if (opps?.length) {
        brief += `\n💼 Active Deals:\n${(opps as any[]).map(o => `• ${o.name} — ${o.stage} — $${((o.arr || 0) / 1000).toFixed(0)}k${o.close_date ? ` — Close: ${o.close_date}` : ''}`).join('\n')}`;
        brief += methSummary;
      }

      if (contacts?.length) {
        brief += `\n\n👥 Key Contacts:\n${(contacts as any[]).map(c => `• ${c.name}${c.title ? ` (${c.title})` : ''}${c.buyer_role ? ` — ${c.buyer_role}` : ''}`).join('\n')}`;
      }

      if (transcripts?.length) {
        const t = transcripts[0] as any;
        brief += `\n\n📞 Last Call (${t.call_date}):\n${(t.summary || 'No summary').slice(0, 300)}`;
      }

      return brief;
    },
  };
}
