import { NavigateFunction } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

type AskCopilot = (question: string, mode: string) => void;

// Field mappings for voice updates
const ACCOUNT_FIELDS: Record<string, string> = {
  next_step: 'next_step',
  'next step': 'next_step',
  priority: 'priority',
  tier: 'tier',
  status: 'account_status',
  'account status': 'account_status',
  notes: 'notes',
  motion: 'motion',
  'outreach status': 'outreach_status',
  outreach: 'outreach_status',
  industry: 'industry',
};

const OPP_FIELDS: Record<string, string> = {
  stage: 'stage',
  'next step': 'next_step',
  next_step: 'next_step',
  'close date': 'close_date',
  close_date: 'close_date',
  notes: 'notes',
  status: 'status',
  arr: 'arr',
};

const MEDDICC_FIELDS: Record<string, string> = {
  metrics: 'metrics',
  'economic buyer': 'economic_buyer',
  economic_buyer: 'economic_buyer',
  'decision criteria': 'decision_criteria',
  decision_criteria: 'decision_criteria',
  'decision process': 'decision_process',
  decision_process: 'decision_process',
  pain: 'identify_pain',
  identify_pain: 'identify_pain',
  champion: 'champion',
  competition: 'competition',
};

async function getUserId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  return user?.id ?? null;
}

function parseDueDate(input: string): string {
  const lower = input.toLowerCase().trim();
  const now = new Date();
  
  if (lower === 'today') return now.toISOString().split('T')[0];
  if (lower === 'tomorrow') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return d.toISOString().split('T')[0];
  }
  
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayIndex = days.indexOf(lower);
  if (dayIndex >= 0) {
    const d = new Date(now);
    const diff = (dayIndex - d.getDay() + 7) % 7 || 7;
    d.setDate(d.getDate() + diff);
    return d.toISOString().split('T')[0];
  }
  
  // Try ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;
  
  // Default to today
  return now.toISOString().split('T')[0];
}

function parseTime(input: string): string | null {
  const match = input.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || '0');
  const ampm = match[3]?.toLowerCase();
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function createClientTools(navigate: NavigateFunction, askCopilot: AskCopilot) {
  return {
    navigate: (params: { path: string }) => {
      navigate(params.path);
      return `Navigated to ${params.path}`;
    },

    create_task: async (params: { title: string; priority?: string; accountName?: string; dueDate?: string; dueTime?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      let linkedAccountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        linkedAccountId = accts?.[0]?.id ?? null;
      }

      const dueDate = params.dueDate ? parseDueDate(params.dueDate) : null;

      const { error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: params.title,
        priority: params.priority || 'medium',
        status: 'next',
        linked_account_id: linkedAccountId,
        category: 'voice-created',
        due_date: dueDate,
      });

      if (error) {
        console.error('Voice create_task error:', error);
        return `Failed to create task: ${error.message}`;
      }

      // If a specific time was given, also create a voice reminder
      if (params.dueTime && dueDate) {
        const time = parseTime(params.dueTime);
        if (time) {
          const remindAt = new Date(`${dueDate}T${time}:00`);
          await supabase.from('voice_reminders').insert({
            user_id: userId,
            message: params.title,
            remind_at: remindAt.toISOString(),
          });
        }
      }

      toast.success('Task created', { description: `${params.title}${dueDate ? ` (due ${dueDate})` : ''}` });
      return `Task created: ${params.title}${dueDate ? ` due ${dueDate}` : ''}`;
    },

    open_copilot: (params: { question: string; mode?: string }) => {
      askCopilot(params.question, (params.mode as any) || 'quick');
      return `Opened copilot with: ${params.question}`;
    },

    prep_meeting: (params: { accountName?: string; meetingTitle?: string }) => {
      const q = params.accountName
        ? `Prep me for my meeting with ${params.accountName}${params.meetingTitle ? ` — ${params.meetingTitle}` : ''}`
        : 'Prep me for my next meeting';
      askCopilot(q, 'meeting');
      return `Preparing meeting brief`;
    },

    update_account: async (params: { accountName: string; field: string; value: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const dbField = ACCOUNT_FIELDS[params.field.toLowerCase()] || params.field;
      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { error } = await supabase
        .from('accounts')
        .update({ [dbField]: params.value, updated_at: new Date().toISOString() })
        .eq('id', accts[0].id);

      if (error) return `Failed to update: ${error.message}`;
      toast.success('Account updated', { description: `${accts[0].name}: ${params.field} → ${params.value}` });
      return `Updated ${accts[0].name} ${params.field} to ${params.value}`;
    },

    update_opportunity: async (params: { opportunityName: string; field: string; value: string }) => {
      const userId = await getUserId();
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
      toast.success('Deal updated', { description: `${opps[0].name}: ${params.field} → ${params.value}` });
      return `Updated ${opps[0].name} ${params.field} to ${params.value}`;
    },

    update_methodology: async (params: { opportunityName: string; field: string; confirmed?: boolean; notes?: string }) => {
      const userId = await getUserId();
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

      const { error } = await (supabase.from('opportunity_methodology' as any) as any)
        .upsert({
          user_id: userId,
          opportunity_id: opps[0].id,
          ...updates,
        }, { onConflict: 'user_id,opportunity_id' });

      if (error) return `Failed to update methodology: ${error.message}`;
      
      const action = params.confirmed ? '✅ Confirmed' : params.notes ? '📝 Updated' : 'Updated';
      toast.success('MEDDICC updated', { description: `${opps[0].name}: ${params.field} ${action}` });
      return `${action} ${params.field} for ${opps[0].name}${params.notes ? `: ${params.notes}` : ''}`;
    },

    log_touch: async (params: { accountName: string; touchType: string; notes?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes, touches_this_week')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const timestamp = new Date().toLocaleString();
      const touchNote = params.notes
        ? `\n\n**${params.touchType}** (${timestamp}): ${params.notes}`
        : '';

      const { error } = await supabase
        .from('accounts')
        .update({
          last_touch_date: new Date().toISOString().split('T')[0],
          last_touch_type: params.touchType,
          touches_this_week: (accts[0].touches_this_week || 0) + 1,
          notes: (accts[0].notes || '') + touchNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accts[0].id);

      if (error) return `Failed to log touch: ${error.message}`;
      toast.success('Touch logged', { description: `${accts[0].name}: ${params.touchType}` });
      return `Logged ${params.touchType} touch for ${accts[0].name}`;
    },

    move_deal: async (params: { opportunityName: string; newStage: string }) => {
      const userId = await getUserId();
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
      toast.success('Deal moved', { description: `${opps[0].name}: ${oldStage || '—'} → ${params.newStage}` });
      return `Moved ${opps[0].name} from ${oldStage || 'no stage'} to ${params.newStage}`;
    },

    scenario_calc: async (params: { dealNames: string[] }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Fetch quota targets and all opps in parallel
      const [quotaRes, allOppsRes, closedWonRes] = await Promise.all([
        supabase.from('quota_targets').select('new_arr_quota, renewal_arr_quota').eq('user_id', userId).limit(1),
        supabase.from('opportunities').select('name, arr, deal_type, status').eq('user_id', userId).not('status', 'eq', 'closed-lost'),
        supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
      ]);

      const quota = quotaRes.data?.[0];
      const allOpps = allOppsRes.data || [];
      const closedWon = closedWonRes.data || [];

      if (!allOpps.length) return 'No active pipeline deals found.';

      // Match requested deals
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

    lookup_account: async (params: { accountName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('*')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;
      const acct = accts[0];

      // Fetch related data in parallel
      const [contactsRes, oppsRes, transcriptsRes] = await Promise.all([
        supabase.from('contacts').select('name, title, buyer_role, influence_level, email, department').eq('account_id', acct.id).limit(10),
        supabase.from('opportunities').select('name, stage, arr, close_date, next_step, deal_type, status').eq('account_id', acct.id).not('status', 'eq', 'closed-lost').limit(10),
        supabase.from('call_transcripts').select('title, call_date, call_type, summary').eq('account_id', acct.id).order('call_date', { ascending: false }).limit(5),
      ]);

      let summary = `📋 ${acct.name} [${acct.tier || '—'}/${acct.priority || '—'}]\n`;
      summary += `Status: ${acct.account_status || '—'} | Motion: ${acct.motion || '—'} | Industry: ${acct.industry || '—'}\n`;
      summary += `Last touch: ${acct.last_touch_date || 'never'} (${acct.last_touch_type || '—'})\n`;
      if (acct.next_step) summary += `Next step: ${acct.next_step}\n`;
      if (acct.notes) summary += `Notes: ${acct.notes.slice(0, 200)}\n`;

      if (oppsRes.data?.length) {
        const totalArr = oppsRes.data.reduce((s: number, o: any) => s + (o.arr || 0), 0);
        summary += `\nPipeline ($${Math.round(totalArr / 1000)}k): ${oppsRes.data.map((o: any) => `${o.name} [${o.stage || '—'}] $${Math.round((o.arr || 0) / 1000)}k${o.next_step ? ` → ${o.next_step}` : ''}`).join('; ')}\n`;
      }

      if (contactsRes.data?.length) {
        summary += `\nContacts: ${contactsRes.data.map((c: any) => `${c.name}${c.title ? ` (${c.title})` : ''} ${c.buyer_role || ''} ${c.influence_level || ''}`).join('; ')}\n`;
      }

      if (transcriptsRes.data?.length) {
        summary += `\nRecent calls: ${transcriptsRes.data.map((t: any) => `${t.call_date}: ${t.title}${t.summary ? ` — ${t.summary.slice(0, 80)}` : ''}`).join('; ')}\n`;
      }

      return summary;
    },

    start_roleplay: (params: { call_type?: string; difficulty?: number; industry?: string }) => {
      navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-start-roleplay', { detail: params }));
      }, 500);
      return `Launching ${params.call_type || 'discovery'} roleplay`;
    },

    start_drill: () => {
      navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-start-drill'));
      }, 500);
      return 'Opening objection drills';
    },

    grade_call: () => {
      navigate('/coach');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('voice-grade-call'));
      }, 500);
      return 'Grading latest transcript';
    },

    log_activity: () => {
      window.dispatchEvent(new CustomEvent('voice-quick-log'));
      return 'Opening quick log';
    },

    set_reminder: async (params: { message: string; minutes_from_now: number }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';
      const remindAt = new Date(Date.now() + params.minutes_from_now * 60 * 1000);
      await supabase.from('voice_reminders').insert({
        user_id: userId,
        message: params.message,
        remind_at: remindAt.toISOString(),
      });
      return `Reminder set for ${params.minutes_from_now} minutes from now: ${params.message}`;
    },

    pipeline_pulse: async () => {
      const userId = await getUserId();
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

    daily_briefing: () => {
      askCopilot('Walk me through my day — priorities, meetings, risks, and what I should focus on', 'quick');
      return 'Building daily briefing in copilot';
    },

    debrief: async (params: { accountName: string; keyTakeaways?: string; nextSteps?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      const timestamp = new Date().toLocaleString();
      const debriefText = `\n\n---\n**Voice Debrief** (${timestamp})\n` +
        (params.keyTakeaways ? `**Takeaways:** ${params.keyTakeaways}\n` : '') +
        (params.nextSteps ? `**Next Steps:** ${params.nextSteps}\n` : '');

      if (accts?.length) {
        const existingNotes = accts[0].notes || '';
        await supabase
          .from('accounts')
          .update({
            notes: existingNotes + debriefText,
            next_step: params.nextSteps || undefined,
            last_touch_date: new Date().toISOString().split('T')[0],
            last_touch_type: 'meeting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', accts[0].id);
      }

      toast.success('Debrief logged', { description: params.accountName });
      return `Debrief captured for ${params.accountName}`;
    },

    add_note: async (params: { accountName: string; note: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const timestamp = new Date().toLocaleString();
      const existingNotes = accts[0].notes || '';
      const newNote = `\n\n**Voice Note** (${timestamp}): ${params.note}`;

      const { error } = await supabase
        .from('accounts')
        .update({
          notes: existingNotes + newNote,
          updated_at: new Date().toISOString(),
        })
        .eq('id', accts[0].id);

      if (error) return `Failed to add note: ${error.message}`;
      toast.success('Note added', { description: `${accts[0].name}: ${params.note.slice(0, 60)}...` });
      return `Note added to ${accts[0].name}`;
    },

    draft_email: (params: { to: string; subject: string; body: string }) => {
      const emailText = `To: ${params.to}\nSubject: ${params.subject}\n\n${params.body}`;
      navigator.clipboard?.writeText(emailText).catch(() => {});
      toast.success('Email drafted & copied', { description: params.subject });
      return `Email drafted for ${params.to}: "${params.subject}". I've copied it to your clipboard.`;
    },
  };
}
