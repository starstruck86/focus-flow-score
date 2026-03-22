import { NavigateFunction } from 'react-router-dom';
import { trackedInvoke } from '@/lib/trackedInvoke';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { emitMetricsUpdated, emitDataChanged } from '@/lib/daveEvents';

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
  const allTools: Record<string, any> = {
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

      // Build reminder_at from dueTime + dueDate
      let reminderAt: string | null = null;
      if (params.dueTime && dueDate) {
        const time = parseTime(params.dueTime);
        if (time) {
          reminderAt = new Date(`${dueDate}T${time}:00`).toISOString();
        }
      }

      const { error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: params.title,
        priority: params.priority || 'P2',
        status: 'next',
        workstream: 'pg',
        linked_account_id: linkedAccountId,
        category: 'voice-created',
        due_date: dueDate,
        reminder_at: reminderAt,
      });

      if (error) {
        console.error('Voice create_task error:', error);
        return `Failed to create task: ${error.message}`;
      }
      emitDataChanged('tasks');

      // Also create a voice reminder for backwards compat
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

      toast.success('Task created', { description: `${params.title}${dueDate ? ` (due ${dueDate})` : ''}${reminderAt ? ' 🔔' : ''}` });
      return `Task created: ${params.title}${dueDate ? ` due ${dueDate}` : ''}${reminderAt ? ' with reminder' : ''}`;
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
      emitDataChanged('accounts');
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
      emitDataChanged('opportunities');
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

      const { error } = await supabase.from('opportunity_methodology')
        .upsert({
          user_id: userId,
          opportunity_id: opps[0].id,
          ...updates,
        }, { onConflict: 'user_id,opportunity_id' });

      if (error) return `Failed to update methodology: ${error.message}`;
      emitDataChanged('opportunities');
      
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
      emitDataChanged('accounts');
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
      emitDataChanged('opportunities');
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

    // ── Daily Metrics ──────────────────────────────────────────────

    update_daily_metrics: async (params: { metric: string; value: number; mode?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const METRIC_MAP: Record<string, string> = {
        dials: 'dials', calls: 'dials',
        conversations: 'conversations', connects: 'conversations',
        'meetings set': 'meetings_set', meetings: 'meetings_set',
        'manual emails': 'manual_emails', emails: 'manual_emails',
        'prospects added': 'prospects_added', prospects: 'prospects_added',
        'customer meetings': 'customer_meetings_held',
        'opportunities created': 'opportunities_created', 'opps created': 'opportunities_created',
        'accounts researched': 'accounts_researched',
        'contacts prepped': 'contacts_prepped',
        'expansion touchpoints': 'expansion_touchpoints',
        'prospecting minutes': 'prospecting_block_minutes',
        'deep work minutes': 'account_deep_work_minutes',
      };

      const dbField = METRIC_MAP[params.metric.toLowerCase()] || METRIC_MAP[params.metric.toLowerCase().replace(/_/g, ' ')];
      if (!dbField) return `Unknown metric "${params.metric}". Try: calls, connects, emails, meetings, prospects, customer meetings, opps created, accounts researched, contacts prepped.`;

      const today = new Date().toISOString().split('T')[0];
      const mode = params.mode || 'add';

      // Get or create today's entry
      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      let oldValue = 0;
      let newValue = params.value;

      if (existing?.length) {
        oldValue = (existing[0] as any)[dbField] || 0;
        newValue = mode === 'add' ? oldValue + params.value : params.value;
        const { error } = await supabase
          .from('daily_journal_entries')
          .update({ [dbField]: newValue, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id);
        if (error) return `Failed to update: ${error.message}`;
      } else {
        const { error } = await supabase
          .from('daily_journal_entries')
          .insert({ user_id: userId, date: today, [dbField]: newValue });
        if (error) return `Failed to create entry: ${error.message}`;
      }

      const label = params.metric.charAt(0).toUpperCase() + params.metric.slice(1);
      toast.success(`${label} updated`, { description: `${oldValue} → ${newValue} (${mode === 'add' ? '+' : '='}${params.value})` });
      emitMetricsUpdated({ [dbField]: newValue });
      return `Updated ${params.metric}: ${oldValue} → ${newValue}`;
    },

    get_daily_metrics: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_journal_entries')
        .select('dials, conversations, meetings_set, manual_emails, prospects_added, customer_meetings_held, opportunities_created, accounts_researched, contacts_prepped, checked_in, daily_score, goal_met')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (!data?.length) return 'No journal entry for today yet. All metrics at zero.';
      const d = data[0];
      return `Today's metrics: ${d.dials} dials, ${d.conversations} connects, ${d.meetings_set} meetings set, ${d.manual_emails} emails, ${d.prospects_added} prospects added, ${d.customer_meetings_held} customer meetings, ${d.opportunities_created} opps created, ${d.accounts_researched} accounts researched, ${d.contacts_prepped} contacts prepped. Checked in: ${d.checked_in ? 'yes' : 'no'}. Daily score: ${d.daily_score ?? 'not set'}. Goal met: ${d.goal_met ? 'yes' : 'no'}.`;
    },

    // ── Contact Management ─────────────────────────────────────────

    add_contact: async (params: { name: string; title?: string; email?: string; accountName?: string; department?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        accountId = accts?.[0]?.id ?? null;
      }

      const { error } = await supabase.from('contacts').insert({
        user_id: userId,
        name: params.name,
        title: params.title || null,
        email: params.email || null,
        account_id: accountId,
        department: params.department || null,
        discovery_source: 'voice',
      });

      if (error) return `Failed to add contact: ${error.message}`;
      emitDataChanged('contacts');
      toast.success('Contact added', { description: `${params.name}${params.title ? ` — ${params.title}` : ''}` });
      return `Added contact ${params.name}${params.accountName ? ` at ${params.accountName}` : ''}`;
    },

    lookup_contact: async (params: { accountName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { data: contacts } = await supabase
        .from('contacts')
        .select('name, title, email, buyer_role, influence_level, department, status')
        .eq('account_id', accts[0].id)
        .limit(20);

      if (!contacts?.length) return `No contacts found for ${accts[0].name}`;
      return `Contacts at ${accts[0].name}:\n` + contacts.map(c =>
        `• ${c.name}${c.title ? ` (${c.title})` : ''}${c.department ? ` — ${c.department}` : ''}${c.buyer_role ? ` [${c.buyer_role}]` : ''}${c.email ? ` ${c.email}` : ''}`
      ).join('\n');
    },

    // ── Opportunity Creation ───────────────────────────────────────

    create_opportunity: async (params: { name: string; accountName?: string; arr?: number; stage?: string; dealType?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        accountId = accts?.[0]?.id ?? null;
      }

      const { error } = await supabase.from('opportunities').insert({
        user_id: userId,
        name: params.name,
        account_id: accountId,
        arr: params.arr || 0,
        stage: params.stage || 'Discovery',
        deal_type: params.dealType || 'new-logo',
        status: 'open',
      });

      if (error) return `Failed to create opportunity: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Opportunity created', { description: `${params.name} — $${Math.round((params.arr || 0) / 1000)}k` });
      return `Created opportunity ${params.name}${params.arr ? ` at $${Math.round(params.arr / 1000)}k ARR` : ''}`;
    },

    // ── Renewal Intelligence ───────────────────────────────────────

    lookup_renewal: async (params: { timeframe?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      let endDate: Date;
      const tf = (params.timeframe || 'quarter').toLowerCase();
      if (tf.includes('month')) {
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
      } else if (tf.includes('year')) {
        endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      } else {
        endDate = new Date(now.getFullYear(), now.getMonth() + 3, now.getDate());
      }

      const { data: renewals } = await supabase
        .from('renewals')
        .select('account_name, arr, renewal_due, health_status, churn_risk, renewal_stage, next_step')
        .eq('user_id', userId)
        .gte('renewal_due', now.toISOString().split('T')[0])
        .lte('renewal_due', endDate.toISOString().split('T')[0])
        .order('renewal_due')
        .limit(20);

      if (!renewals?.length) return `No renewals found in the next ${tf}.`;
      const totalArr = renewals.reduce((s, r) => s + Number(r.arr || 0), 0);
      return `${renewals.length} renewals ($${Math.round(totalArr / 1000)}k) in the next ${tf}:\n` +
        renewals.map(r => `• ${r.account_name}: $${Math.round(Number(r.arr || 0) / 1000)}k due ${r.renewal_due} [${r.health_status || '—'}/${r.churn_risk || '—'}]${r.next_step ? ` → ${r.next_step}` : ''}`).join('\n');
    },

    update_renewal: async (params: { accountName: string; field: string; value: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const RENEWAL_FIELDS: Record<string, string> = {
        health: 'health_status', 'health status': 'health_status',
        risk: 'churn_risk', 'churn risk': 'churn_risk',
        'risk reason': 'risk_reason',
        stage: 'renewal_stage', 'renewal stage': 'renewal_stage',
        'next step': 'next_step', next_step: 'next_step',
        notes: 'notes',
      };

      const dbField = RENEWAL_FIELDS[params.field.toLowerCase()];
      if (!dbField) return `Invalid renewal field "${params.field}". Valid: ${Object.keys(RENEWAL_FIELDS).join(', ')}`;

      const { data: renewals } = await supabase
        .from('renewals')
        .select('id, account_name')
        .eq('user_id', userId)
        .ilike('account_name', `%${params.accountName}%`)
        .limit(1);

      if (!renewals?.length) return `Renewal for "${params.accountName}" not found`;

      const { error } = await supabase
        .from('renewals')
        .update({ [dbField]: params.value, updated_at: new Date().toISOString() })
        .eq('id', renewals[0].id);

      if (error) return `Failed to update renewal: ${error.message}`;
      emitDataChanged('renewals');
      toast.success('Renewal updated', { description: `${renewals[0].account_name}: ${params.field} → ${params.value}` });
      return `Updated ${renewals[0].account_name} renewal ${params.field} to ${params.value}`;
    },

    // ── Task Management ────────────────────────────────────────────

    complete_task: async (params: { taskTitle: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, status')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .ilike('title', `%${params.taskTitle}%`)
        .limit(1);

      if (!tasks?.length) return `Task matching "${params.taskTitle}" not found`;

      const { error } = await supabase
        .from('tasks')
        .update({ status: 'done', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) return `Failed to complete task: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Task completed', { description: tasks[0].title });
      return `Completed: ${tasks[0].title}`;
    },

    list_tasks: async (params: { filter?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      let query = supabase
        .from('tasks')
        .select('title, priority, status, due_date, linked_account_id')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .order('priority')
        .limit(15);

      const filter = (params.filter || 'today').toLowerCase();
      if (filter === 'today' || filter === 'due today') {
        query = query.eq('due_date', today);
      } else if (filter === 'overdue') {
        query = query.lt('due_date', today);
      }

      const { data: tasks } = await query;
      if (!tasks?.length) return filter === 'today' ? 'No tasks due today.' : 'No matching tasks found.';

      // Resolve linked_account_id to account names
      const accountIds = [...new Set(tasks.map(t => t.linked_account_id).filter(Boolean))];
      let accountMap: Record<string, string> = {};
      if (accountIds.length) {
        const { data: accts } = await supabase.from('accounts').select('id, name').in('id', accountIds);
        if (accts) accountMap = Object.fromEntries(accts.map(a => [a.id, a.name]));
      }

      return `${tasks.length} tasks${filter === 'today' ? ' for today' : ''}:\n` +
        tasks.map(t => {
          const acctName = t.linked_account_id ? accountMap[t.linked_account_id] : null;
          return `• [${t.priority || 'P2'}] ${t.title}${acctName ? ` (${acctName})` : ''}${t.due_date ? ` due ${t.due_date}` : ''} — ${t.status}`;
        }).join('\n');
    },

    // ── Calendar ───────────────────────────────────────────────────

    get_calendar: async (params: { day?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const target = params.day?.toLowerCase() === 'tomorrow'
        ? new Date(Date.now() + 86400000)
        : new Date();
      const dayStart = new Date(target.getFullYear(), target.getMonth(), target.getDate()).toISOString();
      const dayEnd = new Date(target.getFullYear(), target.getMonth(), target.getDate() + 1).toISOString();

      const { data: events } = await supabase
        .from('calendar_events')
        .select('title, start_time, end_time, description, location')
        .eq('user_id', userId)
        .gte('start_time', dayStart)
        .lt('start_time', dayEnd)
        .order('start_time')
        .limit(20);

      if (!events?.length) return `No meetings ${params.day === 'tomorrow' ? 'tomorrow' : 'today'}.`;
      const label = params.day === 'tomorrow' ? 'Tomorrow' : 'Today';
      return `${label}'s calendar (${events.length} events):\n` +
        events.map(e => {
          const start = new Date(e.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const end = e.end_time ? new Date(e.end_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
          return `• ${start}${end ? `–${end}` : ''} ${e.title}${e.location ? ` (${e.location})` : ''}`;
        }).join('\n');
    },

    // ── Quota Status ───────────────────────────────────────────────

    quota_status: async () => {
      const userId = await getUserId();
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

    // ── Journal / Check-in ─────────────────────────────────────────

    log_reflection: async (params: { whatWorked?: string; blocker?: string; tomorrowPriority?: string; reflection?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const updates: Record<string, any> = { updated_at: new Date().toISOString() };
      if (params.whatWorked) updates.what_worked_today = params.whatWorked;
      if (params.blocker) updates.biggest_blocker = params.blocker;
      if (params.tomorrowPriority) updates.tomorrow_priority = params.tomorrowPriority;
      if (params.reflection) updates.daily_reflection = params.reflection;

      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        await supabase.from('daily_journal_entries').update(updates).eq('id', existing[0].id);
      } else {
        await supabase.from('daily_journal_entries').insert({ user_id: userId, date: today, ...updates });
      }

      toast.success('Reflection logged');
      return 'Reflection captured for today.';
    },

    check_in: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const now = new Date().toISOString();

      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id, checked_in')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        if (existing[0].checked_in) return 'Already checked in for today.';
        await supabase.from('daily_journal_entries')
          .update({ checked_in: true, check_in_timestamp: now, updated_at: now })
          .eq('id', existing[0].id);
      } else {
        await supabase.from('daily_journal_entries')
          .insert({ user_id: userId, date: today, checked_in: true, check_in_timestamp: now });
      }

      toast.success('Checked in ✓');
      return 'Checked in for today. Let\'s get after it.';
    },

    // ── Transcript Lookup ──────────────────────────────────────────

    lookup_transcript: async (params: { accountName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      const { data: transcripts } = await supabase
        .from('call_transcripts')
        .select('title, call_date, call_type, summary, participants, duration_minutes')
        .eq('account_id', accts[0].id)
        .order('call_date', { ascending: false })
        .limit(5);

      if (!transcripts?.length) return `No call transcripts found for ${accts[0].name}`;
      return `Recent calls with ${accts[0].name}:\n` +
        transcripts.map(t => `• ${t.call_date}: ${t.title} (${t.call_type || 'call'}${t.duration_minutes ? `, ${t.duration_minutes}min` : ''})${t.summary ? `\n  Summary: ${t.summary.slice(0, 150)}` : ''}`).join('\n');
    },

    // ── Power Hour ─────────────────────────────────────────────────

    start_power_hour: () => {
      window.dispatchEvent(new CustomEvent('voice-start-power-hour'));
      return 'Starting power hour timer. Go get it.';
    },

    // ══════════════════════════════════════════════════════════════
    // NEW TOOLS — Expansion Pack (15 tools)
    // ══════════════════════════════════════════════════════════════

    // ── Create Account ─────────────────────────────────────────────

    create_account: async (params: { name: string; tier?: string; motion?: string; industry?: string; website?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Check for duplicate
      const { data: existing } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .eq('name', params.name)
        .limit(1);

      if (existing?.length) return `Account "${existing[0].name}" already exists. Use update_account instead.`;

      const { error } = await supabase.from('accounts').insert({
        user_id: userId,
        name: params.name,
        tier: params.tier || null,
        motion: params.motion || null,
        industry: params.industry || null,
        website: params.website || null,
        account_status: 'active',
      });

      if (error) return `Failed to create account: ${error.message}`;
      emitDataChanged('accounts');
      toast.success('Account created', { description: `${params.name}${params.tier ? ` [${params.tier}]` : ''}` });
      return `Created account ${params.name}${params.tier ? ` (Tier ${params.tier})` : ''}${params.motion ? `, ${params.motion} motion` : ''}`;
    },

    // ── Enrich Account ─────────────────────────────────────────────

    enrich_account: async (params: { accountName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, website, industry')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      toast.info(`Enriching ${accts[0].name}...`, { duration: 3000 });

      const { data, error } = await trackedInvoke<any>('enrich-account', {
        body: {
          url: accts[0].website || '',
          accountName: accts[0].name,
          accountId: accts[0].id,
          industry: accts[0].industry || '',
        },
      });

      if (error) return `Enrichment failed: ${error.message}`;
      if (!data?.success) return `Enrichment failed: ${data?.error || 'unknown error'}`;

      const scores = data.scores || {};
      toast.success(`Enriched ${accts[0].name}`, {
        description: `ICP ${scores.icp_fit_score || '—'} • Tier ${scores.lifecycle_tier || '—'}`,
      });
      return `Enriched ${accts[0].name}: ICP fit ${scores.icp_fit_score || '—'}/100, Tier ${scores.lifecycle_tier || '—'}, priority ${scores.priority_score || '—'}. ${data.summary || ''}`;
    },

    // ── Search CRM ─────────────────────────────────────────────────

    search_crm: async (params: { query: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const q = `%${params.query}%`;
      const [accts, opps, contacts, transcripts] = await Promise.all([
        supabase.from('accounts').select('name, tier, account_status').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},industry.ilike.${q}`).limit(5),
        supabase.from('opportunities').select('name, stage, arr').eq('user_id', userId).or(`name.ilike.${q},notes.ilike.${q},next_step.ilike.${q}`).limit(5),
        supabase.from('contacts').select('name, title, email').eq('user_id', userId).or(`name.ilike.${q},title.ilike.${q},email.ilike.${q}`).limit(5),
        supabase.from('call_transcripts').select('title, call_date, summary').eq('user_id', userId).or(`title.ilike.${q},content.ilike.${q},summary.ilike.${q}`).limit(5),
      ]);

      const results: string[] = [];
      if (accts.data?.length) results.push(`Accounts: ${accts.data.map(a => `${a.name} [${a.tier || '—'}]`).join(', ')}`);
      if (opps.data?.length) results.push(`Deals: ${opps.data.map(o => `${o.name} (${o.stage || '—'}, $${Math.round((o.arr || 0) / 1000)}k)`).join(', ')}`);
      if (contacts.data?.length) results.push(`Contacts: ${contacts.data.map(c => `${c.name}${c.title ? ` (${c.title})` : ''}`).join(', ')}`);
      if (transcripts.data?.length) results.push(`Transcripts: ${transcripts.data.map(t => `${t.title} (${t.call_date})`).join(', ')}`);

      if (!results.length) return `No results found for "${params.query}"`;
      return `Search results for "${params.query}":\n${results.join('\n')}`;
    },

    // ── Weekly Battle Plan ─────────────────────────────────────────

    weekly_battle_plan: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Check for existing plan this week
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

      // Trigger generation via edge function
      toast.info('Generating battle plan...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('weekly-battle-plan', {
        body: {},
      });

      if (error) return `Failed to generate battle plan: ${error.message}`;
      return data?.strategy_summary || 'Battle plan generated. Check your dashboard for the full plan.';
    },

    // ── Weekly Review ──────────────────────────────────────────────

    weekly_review: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      toast.info('Running weekly review...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('weekly-patterns', {
        body: {},
      });

      if (error) return `Failed to run weekly review: ${error.message}`;
      return data?.summary || data?.patterns_summary || 'Weekly review complete. Check the dashboard for details.';
    },

    // ── Commission Detail ──────────────────────────────────────────

    commission_detail: async () => {
      const userId = await getUserId();
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

    // ── Account Prioritization ─────────────────────────────────────

    account_prioritize: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      toast.info('AI prioritizing accounts...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('prioritize-accounts', {
        body: {},
      });

      if (error) return `Failed to prioritize: ${error.message}`;

      const ranked = data?.ranked || data?.accounts || [];
      if (!ranked.length) return 'No accounts to prioritize. Add accounts first.';

      return `Top priority accounts:\n` +
        ranked.slice(0, 8).map((a: any, i: number) =>
          `${i + 1}. ${a.name || a.account_name} — ${a.reason || a.rationale || 'Priority account'}`
        ).join('\n');
    },

    // ── Trend Query ────────────────────────────────────────────────

    trend_query: async (params: { metric: string; period?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const METRIC_MAP: Record<string, string> = {
        dials: 'dials', calls: 'dials',
        connects: 'conversations', conversations: 'conversations',
        meetings: 'meetings_set', 'meetings set': 'meetings_set',
        emails: 'manual_emails',
        prospects: 'prospects_added',
        'customer meetings': 'customer_meetings_held',
        opps: 'opportunities_created',
        'accounts researched': 'accounts_researched',
        score: 'daily_score',
      };

      const dbField = METRIC_MAP[params.metric.toLowerCase()] || params.metric;
      const period = (params.period || 'week').toLowerCase();
      const daysBack = period.includes('month') ? 30 : period.includes('quarter') ? 90 : 7;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      const { data: entries } = await supabase
        .from('daily_journal_entries')
        .select(`date, ${dbField}`)
        .eq('user_id', userId)
        .gte('date', startDate.toISOString().split('T')[0])
        .order('date');

      if (!entries?.length) return `No data for ${params.metric} in the last ${daysBack} days.`;

      const values = entries.map(e => (e as any)[dbField] || 0);
      const total = values.reduce((s: number, v: number) => s + v, 0);
      const avg = Math.round((total / values.length) * 10) / 10;
      const latest = values[values.length - 1];

      // Compare first half vs second half for trend
      const mid = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, mid);
      const secondHalf = values.slice(mid);
      const firstAvg = firstHalf.length ? firstHalf.reduce((s: number, v: number) => s + v, 0) / firstHalf.length : 0;
      const secondAvg = secondHalf.length ? secondHalf.reduce((s: number, v: number) => s + v, 0) / secondHalf.length : 0;
      const trend = secondAvg > firstAvg * 1.1 ? '📈 trending up' : secondAvg < firstAvg * 0.9 ? '📉 trending down' : '➡️ stable';

      return `${params.metric} over last ${daysBack} days: Total ${total}, Avg ${avg}/day, Latest ${latest}. ${trend} (early avg ${Math.round(firstAvg * 10) / 10} → recent avg ${Math.round(secondAvg * 10) / 10}).`;
    },

    // ── Stakeholder Query ──────────────────────────────────────────

    stakeholder_query: async (params: { accountName: string; role?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      if (!accts?.length) return `Account "${params.accountName}" not found`;

      let query = supabase
        .from('contacts')
        .select('name, title, department, buyer_role, influence_level, email, reporting_to, status, seniority')
        .eq('account_id', accts[0].id);

      if (params.role) {
        query = query.or(`buyer_role.ilike.%${params.role}%,title.ilike.%${params.role}%`);
      }

      const { data: contacts } = await query.limit(20);
      if (!contacts?.length) return `No stakeholders found at ${accts[0].name}${params.role ? ` matching "${params.role}"` : ''}`;

      const byInfluence = contacts.sort((a, b) => {
        const levels: Record<string, number> = { high: 3, medium: 2, low: 1 };
        return (levels[b.influence_level || ''] || 0) - (levels[a.influence_level || ''] || 0);
      });

      return `Stakeholders at ${accts[0].name}:\n` +
        byInfluence.map(c =>
          `• ${c.name}${c.title ? ` — ${c.title}` : ''}${c.department ? ` (${c.department})` : ''}\n  Role: ${c.buyer_role || '—'} | Influence: ${c.influence_level || '—'} | Status: ${c.status || '—'}${c.reporting_to ? ` | Reports to: ${c.reporting_to}` : ''}`
        ).join('\n');
    },

    // ── Territory Analysis ─────────────────────────────────────────

    territory_analysis: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accounts } = await supabase
        .from('accounts')
        .select('name, tier, motion, account_status, last_touch_date, touches_this_week, priority_score, icp_fit_score')
        .eq('user_id', userId)
        .eq('account_status', 'active')
        .limit(200);

      if (!accounts?.length) return 'No active accounts found.';

      const now = new Date();
      const staleThreshold = new Date(now);
      staleThreshold.setDate(staleThreshold.getDate() - 14);

      const byTier: Record<string, number> = {};
      const byMotion: Record<string, number> = {};
      const staleAccounts: string[] = [];
      const untouched: string[] = [];

      accounts.forEach(a => {
        byTier[a.tier || 'untiered'] = (byTier[a.tier || 'untiered'] || 0) + 1;
        byMotion[a.motion || 'unset'] = (byMotion[a.motion || 'unset'] || 0) + 1;
        if (!a.last_touch_date) {
          untouched.push(a.name);
        } else if (new Date(a.last_touch_date) < staleThreshold) {
          staleAccounts.push(a.name);
        }
      });

      let summary = `Territory snapshot (${accounts.length} active accounts):\n`;
      summary += `By tier: ${Object.entries(byTier).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;
      summary += `By motion: ${Object.entries(byMotion).map(([k, v]) => `${k}: ${v}`).join(', ')}\n`;
      if (staleAccounts.length) summary += `⚠️ ${staleAccounts.length} stale (14+ days): ${staleAccounts.slice(0, 5).join(', ')}${staleAccounts.length > 5 ? ` +${staleAccounts.length - 5} more` : ''}\n`;
      if (untouched.length) summary += `🚫 ${untouched.length} never touched: ${untouched.slice(0, 5).join(', ')}${untouched.length > 5 ? ` +${untouched.length - 5} more` : ''}`;

      return summary;
    },

    // ── Start Focus Timer ──────────────────────────────────────────

    start_focus_timer: (params: { duration_minutes?: number; focus_type?: string; accountName?: string }) => {
      window.dispatchEvent(new CustomEvent('voice-start-focus-timer', {
        detail: {
          duration: params.duration_minutes || 25,
          type: params.focus_type || 'prospecting',
          account: params.accountName,
        },
      }));
      toast.success('Focus timer started', {
        description: `${params.duration_minutes || 25} min ${params.focus_type || 'prospecting'} block${params.accountName ? ` — ${params.accountName}` : ''}`,
      });
      return `Started ${params.duration_minutes || 25}-minute ${params.focus_type || 'prospecting'} block${params.accountName ? ` for ${params.accountName}` : ''}`;
    },

    // ── Search Resources ───────────────────────────────────────────

    search_resources: async (params: { query: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const q = `%${params.query}%`;
      const { data: resources } = await supabase
        .from('resources')
        .select('title, resource_type, template_category, created_at')
        .eq('user_id', userId)
        .or(`title.ilike.${q},content.ilike.${q},resource_type.ilike.${q}`)
        .limit(10);

      if (!resources?.length) return `No resources found matching "${params.query}"`;

      return `Resources matching "${params.query}":\n` +
        resources.map(r => `• ${r.title} [${r.resource_type || '—'}]${r.template_category ? ` (${r.template_category})` : ''}`).join('\n');
    },

    // ── Bulk Update ────────────────────────────────────────────────

    bulk_update: async (params: { entity: string; filter_field: string; filter_value: string; update_field: string; update_value: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const entity = params.entity.toLowerCase();

      // Whitelist valid fields per entity to prevent invalid column errors
      const VALID_FIELDS: Record<string, string[]> = {
        accounts: ['account_status', 'tier', 'priority', 'motion', 'notes', 'next_step', 'outreach_status', 'industry', 'cadence_name'],
        opportunities: ['stage', 'status', 'arr', 'close_date', 'next_step', 'notes', 'deal_type'],
        tasks: ['status', 'priority', 'due_date', 'notes', 'category'],
      };

      if (!VALID_FIELDS[entity]) {
        return `Bulk update only supports accounts, opportunities, and tasks.`;
      }

      const filterField = ACCOUNT_FIELDS[params.filter_field.toLowerCase()] || params.filter_field;
      const updateField = (entity === 'accounts' ? ACCOUNT_FIELDS[params.update_field.toLowerCase()] : null) || params.update_field;

      if (!VALID_FIELDS[entity].includes(filterField) && filterField !== 'name' && filterField !== 'title') {
        return `Invalid filter field "${params.filter_field}" for ${entity}. Valid: name, ${VALID_FIELDS[entity].join(', ')}`;
      }
      if (!VALID_FIELDS[entity].includes(updateField)) {
        return `Invalid update field "${params.update_field}" for ${entity}. Valid: ${VALID_FIELDS[entity].join(', ')}`;
      }

      const table = entity as 'accounts' | 'opportunities' | 'tasks';

      const { data: matches, count } = await supabase
        .from(table)
        .select('id', { count: 'exact' })
        .eq('user_id', userId)
        .ilike(filterField, `%${params.filter_value}%`)
        .limit(50);

      const matchCount = count || matches?.length || 0;
      if (!matchCount) return `No ${entity} found matching ${params.filter_field} = "${params.filter_value}"`;

      const ids = (matches || []).map(m => m.id);
      const { error } = await supabase
        .from(table)
        .update({ [updateField]: params.update_value, updated_at: new Date().toISOString() })
        .in('id', ids);

      if (error) return `Bulk update failed: ${error.message}`;
      emitDataChanged(entity);
      toast.success(`Bulk updated ${matchCount} ${entity}`, { description: `${params.update_field} → ${params.update_value}` });
      return `Updated ${matchCount} ${entity} where ${params.filter_field} matches "${params.filter_value}": set ${params.update_field} = "${params.update_value}"`;
    },

    // ── Create Recurring Task ──────────────────────────────────────

    create_recurring_task: async (params: { title: string; recurrence: string; accountName?: string; priority?: string }) => {
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

      // Create as a regular task with recurrence info in the category
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 1);
      while (dueDate.getDay() === 0 || dueDate.getDay() === 6) dueDate.setDate(dueDate.getDate() + 1);

      const { error } = await supabase.from('tasks').insert({
        user_id: userId,
        title: `🔄 ${params.title}`,
        priority: params.priority || 'P2',
        status: 'next',
        workstream: 'pg',
        linked_account_id: linkedAccountId,
        category: `recurring:${params.recurrence}`,
        due_date: dueDate.toISOString().split('T')[0],
      });

      if (error) return `Failed to create recurring task: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Recurring task created', { description: `${params.title} — ${params.recurrence}` });
      return `Created recurring task: "${params.title}" (${params.recurrence})${params.accountName ? ` linked to ${params.accountName}` : ''}`;
    },

    // ── Smart Debrief (with auto-tasks) ────────────────────────────

    smart_debrief: async (params: { accountName: string; summary: string; nextSteps?: string; sentiment?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: accts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.accountName}%`)
        .limit(1);

      const timestamp = new Date().toLocaleString();
      const today = new Date().toISOString().split('T')[0];
      const debriefText = `\n\n---\n**Voice Debrief** (${timestamp})\n` +
        `**Summary:** ${params.summary}\n` +
        (params.nextSteps ? `**Next Steps:** ${params.nextSteps}\n` : '') +
        (params.sentiment ? `**Sentiment:** ${params.sentiment}\n` : '');

      if (accts?.length) {
        await supabase
          .from('accounts')
          .update({
            notes: (accts[0].notes || '') + debriefText,
            next_step: params.nextSteps || undefined,
            last_touch_date: today,
            last_touch_type: 'meeting',
            updated_at: new Date().toISOString(),
          })
          .eq('id', accts[0].id);
      }

      // Auto-create tasks from next steps
      const tasksCreated: string[] = [];
      if (params.nextSteps) {
        const steps = params.nextSteps.split(/[,;]|(?:\band\b)/i).map(s => s.trim()).filter(s => s.length > 5);
        for (const step of steps.slice(0, 5)) {
          // Set due date to 3 business days from now
          const due = new Date();
          let added = 0;
          while (added < 3) {
            due.setDate(due.getDate() + 1);
            if (due.getDay() !== 0 && due.getDay() !== 6) added++;
          }

          await supabase.from('tasks').insert({
            user_id: userId,
            title: step,
            priority: 'P2',
            status: 'next',
            workstream: 'pg',
            linked_account_id: accts?.[0]?.id ?? null,
            category: 'debrief-generated',
            due_date: due.toISOString().split('T')[0],
          });
          tasksCreated.push(step);
        }
      }

      emitDataChanged('accounts');
      if (tasksCreated.length) emitDataChanged('tasks');
      toast.success('Smart debrief captured', {
        description: `${params.accountName}${tasksCreated.length ? ` + ${tasksCreated.length} tasks` : ''}`,
      });
      return `Debrief logged for ${params.accountName}. ${tasksCreated.length ? `Created ${tasksCreated.length} follow-up tasks: ${tasksCreated.join('; ')}` : 'No follow-up tasks extracted.'}`;
    },

    // ── Pipeline Hygiene ───────────────────────────────────────────

    pipeline_hygiene: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Check for recent scan first
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

      // Trigger new scan
      toast.info('Running pipeline hygiene scan...', { duration: 3000 });
      const { data, error } = await trackedInvoke<any>('pipeline-hygiene', {
        body: {},
      });

      if (error) return `Pipeline hygiene scan failed: ${error.message}`;
      return `Pipeline hygiene: Health ${data?.health_score || '—'}/100, ${data?.total_issues || 0} issues found (${data?.critical_issues || 0} critical). ${data?.summary?.top_issues ? `Top: ${data.summary.top_issues.join(', ')}` : 'Check dashboard for details.'}`;
    },

    // ── Guided Journal ─────────────────────────────────────────────

    guided_journal: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      const entry = data?.[0] as any;
      const missing: string[] = [];
      const completed: string[] = [];

      // Activity metrics
      const metrics = [
        { field: 'dials', label: 'Dials', default: 0 },
        { field: 'conversations', label: 'Connects/Conversations', default: 0 },
        { field: 'manual_emails', label: 'Manual Emails', default: 0 },
        { field: 'meetings_set', label: 'Meetings Set', default: 0 },
        { field: 'customer_meetings_held', label: 'Customer Meetings Held', default: 0 },
        { field: 'opportunities_created', label: 'Opportunities Created', default: 0 },
        { field: 'prospects_added', label: 'Prospects Added', default: 0 },
        { field: 'accounts_researched', label: 'Accounts Researched', default: 0 },
        { field: 'contacts_prepped', label: 'Contacts Prepped', default: 0 },
      ];

      for (const m of metrics) {
        const val = entry?.[m.field] ?? m.default;
        if (val === 0 || val === m.default) missing.push(`📊 ${m.label} (currently ${val})`);
        else completed.push(`✅ ${m.label}: ${val}`);
      }

      // Qualitative fields
      const qualFields = [
        { field: 'what_worked_today', label: 'What worked today' },
        { field: 'biggest_blocker', label: 'Biggest blocker' },
        { field: 'tomorrow_priority', label: 'Tomorrow\'s top priority' },
        { field: 'daily_reflection', label: 'Daily reflection' },
      ];
      for (const q of qualFields) {
        if (!entry?.[q.field]) missing.push(`💬 ${q.label}`);
        else completed.push(`✅ ${q.label}`);
      }

      // Wellness
      const wellnessFields = [
        { field: 'energy', label: 'Energy level (1-5)' },
        { field: 'focus_quality', label: 'Focus quality (1-5)' },
        { field: 'stress', label: 'Stress level (1-5)' },
      ];
      for (const w of wellnessFields) {
        if (!entry?.[w.field]) missing.push(`🧠 ${w.label}`);
        else completed.push(`✅ ${w.label}: ${entry[w.field]}`);
      }

      // Accountability
      if (!entry?.personal_development) missing.push('📚 Personal development (yes/no)');
      else completed.push('✅ Personal development');

      if (!entry) {
        return `No journal entry for today yet. Let's walk through it step by step.\n\nMISSING (${missing.length}):\n${missing.join('\n')}\n\nStart by asking about the activity metrics first (dials, connects, emails, etc.), then move to reflections and wellness.`;
      }

      return `Journal progress for today:\n\nCOMPLETED (${completed.length}):\n${completed.join('\n')}\n\nSTILL NEEDED (${missing.length}):\n${missing.join('\n')}\n\nAsk about the missing items one by one, starting with activity metrics.`;
    },

    update_journal_field: async (params: { field: string; value: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const JOURNAL_FIELDS: Record<string, { column: string; type: 'text' | 'number' | 'boolean' }> = {
        what_worked_today: { column: 'what_worked_today', type: 'text' },
        what_worked: { column: 'what_worked_today', type: 'text' },
        biggest_blocker: { column: 'biggest_blocker', type: 'text' },
        blocker: { column: 'biggest_blocker', type: 'text' },
        tomorrow_priority: { column: 'tomorrow_priority', type: 'text' },
        tomorrow: { column: 'tomorrow_priority', type: 'text' },
        daily_reflection: { column: 'daily_reflection', type: 'text' },
        reflection: { column: 'daily_reflection', type: 'text' },
        energy: { column: 'energy', type: 'number' },
        focus_quality: { column: 'focus_quality', type: 'number' },
        focus: { column: 'focus_quality', type: 'number' },
        stress: { column: 'stress', type: 'number' },
        personal_development: { column: 'personal_development', type: 'boolean' },
        clarity: { column: 'clarity', type: 'number' },
        what_drained_you: { column: 'what_drained_you', type: 'text' },
        drained: { column: 'what_drained_you', type: 'text' },
      };

      const fieldDef = JOURNAL_FIELDS[params.field.toLowerCase().replace(/\s+/g, '_')];
      if (!fieldDef) return `Unknown journal field "${params.field}". Valid: ${Object.keys(JOURNAL_FIELDS).filter(k => !k.includes('_') || k === params.field).join(', ')}`;

      let dbValue: any;
      if (fieldDef.type === 'number') {
        dbValue = parseInt(params.value) || 0;
        if (['energy', 'focus_quality', 'stress', 'clarity'].includes(fieldDef.column)) {
          dbValue = Math.max(1, Math.min(5, dbValue));
        }
      } else if (fieldDef.type === 'boolean') {
        dbValue = ['yes', 'true', '1', 'yeah', 'yep'].includes(params.value.toLowerCase());
      } else {
        dbValue = params.value;
      }

      const today = new Date().toISOString().split('T')[0];
      const { data: existing } = await supabase
        .from('daily_journal_entries')
        .select('id')
        .eq('user_id', userId)
        .eq('date', today)
        .limit(1);

      if (existing?.length) {
        const { error } = await supabase
          .from('daily_journal_entries')
          .update({ [fieldDef.column]: dbValue, updated_at: new Date().toISOString() })
          .eq('id', existing[0].id);
        if (error) return `Failed to update: ${error.message}`;
      } else {
        const { error } = await supabase
          .from('daily_journal_entries')
          .insert({ user_id: userId, date: today, [fieldDef.column]: dbValue });
        if (error) return `Failed to create entry: ${error.message}`;
      }

      emitMetricsUpdated({ [fieldDef.column]: dbValue });
      toast.success('Journal updated', { description: `${params.field}: ${params.value}` });
      return `Updated ${params.field} to "${params.value}"`;
    },

    // ── Task Reminder ──────────────────────────────────────────────

    set_task_reminder: async (params: { taskTitle: string; reminderTime: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title')
        .eq('user_id', userId)
        .not('status', 'in', '("done","dropped")')
        .ilike('title', `%${params.taskTitle}%`)
        .limit(1);

      if (!tasks?.length) return `Task matching "${params.taskTitle}" not found`;

      // Parse reminderTime — support relative ("in 30 minutes") or absolute
      let reminderAt: Date;
      const lower = params.reminderTime.toLowerCase().trim();
      const relativeMatch = lower.match(/in\s+(\d+)\s*(minute|min|hour|hr|h|m)/i);
      if (relativeMatch) {
        const amount = parseInt(relativeMatch[1]);
        const unit = relativeMatch[2].startsWith('h') ? 60 : 1;
        reminderAt = new Date(Date.now() + amount * unit * 60 * 1000);
      } else {
        // Try as date/time string
        reminderAt = new Date(params.reminderTime);
        if (isNaN(reminderAt.getTime())) {
          // Try as time today
          const time = parseTime(params.reminderTime);
          if (time) {
            const today = new Date().toISOString().split('T')[0];
            reminderAt = new Date(`${today}T${time}:00`);
          } else {
            return `Could not parse reminder time: "${params.reminderTime}". Try "in 30 minutes" or "3pm".`;
          }
        }
      }

      const { error } = await supabase
        .from('tasks')
        .update({ reminder_at: reminderAt.toISOString(), updated_at: new Date().toISOString() } as any)
        .eq('id', tasks[0].id);

      if (error) return `Failed to set reminder: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Reminder set', { description: `${tasks[0].title} — ${reminderAt.toLocaleString()}` });
      return `Reminder set for "${tasks[0].title}" at ${reminderAt.toLocaleString()}`;
    },

    // ═══════════════════════════════════════════════════════════════
    // SYNTHESIS TOOLS — Cross-entity intelligence layer
    // ═══════════════════════════════════════════════════════════════

    // ── Add Note to Opportunity ────────────────────────────────────
    add_opportunity_note: async (params: { opportunityName: string; note: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `Opportunity matching "${params.opportunityName}" not found`;

      const opp = opps[0];
      const updatedNotes = ((opp.notes || '') + `\n\n🎙️ ${new Date().toLocaleDateString()}: ${params.note}`).trim();

      const { error } = await supabase
        .from('opportunities')
        .update({ notes: updatedNotes, updated_at: new Date().toISOString() })
        .eq('id', opp.id);

      if (error) return `Failed to add note: ${error.message}`;
      emitDataChanged('opportunities');
      toast.success('Note added to opportunity', { description: opp.name });
      return `Added note to opportunity "${opp.name}"`;
    },

    // ── Read Resource Content ──────────────────────────────────────
    read_resource: async (params: { title: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: resources } = await supabase
        .from('resources')
        .select('id, title, content, type')
        .eq('user_id', userId)
        .ilike('title', `%${params.title}%`)
        .limit(1);

      if (!resources?.length) return `Resource matching "${params.title}" not found`;

      const r = resources[0] as any;
      const content = (r.content || '').substring(0, 3000);
      return `📚 "${r.title}" (${r.type || 'document'}):\n\n${content}${(r.content || '').length > 3000 ? '\n\n... [truncated]' : ''}`;
    },

    // ── MEDDICC Gap Analysis (Cross-Deal) ──────────────────────────
    methodology_gaps: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Get active opportunities
      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, arr, close_date, stage, status')
        .eq('user_id', userId)
        .in('status', ['active', 'stalled'])
        .order('arr', { ascending: false })
        .limit(20);

      if (!opps?.length) return 'No active opportunities found';

      // Get methodology for all active opps
      const oppIds = opps.map(o => o.id);
      const { data: methodologies } = await supabase
        .from('opportunity_methodology')
        .select('*')
        .eq('user_id', userId)
        .in('opportunity_id', oppIds);

      const methMap = new Map((methodologies || []).map((m: any) => [m.opportunity_id, m]));
      const fields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
      const fieldLabels: Record<string, string> = { metrics: 'Metrics', economic_buyer: 'Economic Buyer', decision_criteria: 'Decision Criteria', decision_process: 'Decision Process', identify_pain: 'Identify Pain', champion: 'Champion', competition: 'Competition' };

      const gaps: { opp: string; arr: number; closeDate: string; missing: string[]; urgency: number }[] = [];

      for (const opp of opps) {
        const meth = methMap.get(opp.id) as any;
        const missing = fields.filter(f => !meth || !meth[`${f}_confirmed`]).map(f => fieldLabels[f]);
        if (missing.length === 0) continue;

        // Urgency = ARR weight * close date proximity
        const daysToClose = opp.close_date ? Math.max(1, Math.ceil((new Date(opp.close_date).getTime() - Date.now()) / 86400000)) : 90;
        const urgency = (opp.arr || 0) / daysToClose;

        gaps.push({ opp: opp.name, arr: opp.arr || 0, closeDate: opp.close_date || 'none', missing, urgency });
      }

      gaps.sort((a, b) => b.urgency - a.urgency);

      if (gaps.length === 0) return '✅ All active deals have full MEDDICC coverage!';

      return `🎯 MEDDICC Gaps (ranked by urgency):\n\n${gaps.slice(0, 5).map((g, i) => 
        `${i + 1}. ${g.opp} ($${(g.arr / 1000).toFixed(0)}k, close: ${g.closeDate})\n   Missing: ${g.missing.join(', ')}`
      ).join('\n\n')}${gaps.length > 5 ? `\n\n...and ${gaps.length - 5} more deals with gaps` : ''}`;
    },

    // ── Next Action Synthesizer ────────────────────────────────────
    next_action: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const now = new Date();

      // Fetch in parallel: overdue tasks, upcoming meetings, stale deals, journal status
      const [tasksRes, calendarRes, oppsRes, journalRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, due_date, priority, linked_account_id, linked_opportunity_id')
          .eq('user_id', userId)
          .not('status', 'in', '("done","dropped")')
          .lte('due_date', today)
          .order('priority', { ascending: true })
          .limit(10),
        supabase
          .from('calendar_events')
          .select('id, title, start_time, description')
          .eq('user_id', userId)
          .gte('start_time', now.toISOString())
          .lte('start_time', new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString())
          .order('start_time', { ascending: true })
          .limit(3),
        supabase
          .from('opportunities')
          .select('id, name, arr, close_date, last_touch_date, status')
          .eq('user_id', userId)
          .eq('status', 'active')
          .order('arr', { ascending: false })
          .limit(20),
        supabase
          .from('daily_journal_entries')
          .select('checked_in, dials, conversations')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle(),
      ]);

      const candidates: { action: string; score: number; reason: string }[] = [];

      // Score overdue tasks
      for (const task of (tasksRes.data || []) as any[]) {
        const priorityWeight = task.priority === 'P1' ? 3 : task.priority === 'P2' ? 2 : 1;
        candidates.push({
          action: `Complete overdue task: "${task.title}"`,
          score: 60 * priorityWeight,
          reason: `Overdue ${task.priority || 'P3'} task`,
        });
      }

      // Score upcoming meetings needing prep
      for (const event of (calendarRes.data || []) as any[]) {
        const minsAway = Math.max(0, (new Date(event.start_time).getTime() - now.getTime()) / 60000);
        candidates.push({
          action: `Prep for meeting: "${event.title}" (in ${Math.round(minsAway)} min)`,
          score: minsAway < 30 ? 200 : 120,
          reason: `Meeting in ${Math.round(minsAway)} minutes`,
        });
      }

      // Score stale high-value deals
      for (const opp of (oppsRes.data || []) as any[]) {
        if (!opp.last_touch_date) continue;
        const daysSinceTouch = Math.ceil((now.getTime() - new Date(opp.last_touch_date).getTime()) / 86400000);
        if (daysSinceTouch >= 7) {
          candidates.push({
            action: `Re-engage stale deal: "${opp.name}" ($${((opp.arr || 0) / 1000).toFixed(0)}k)`,
            score: (opp.arr || 0) / 1000 * (daysSinceTouch / 7),
            reason: `${daysSinceTouch} days since last touch, $${((opp.arr || 0) / 1000).toFixed(0)}k ARR`,
          });
        }
      }

      // Journal check
      const journal = journalRes.data as any;
      if (!journal?.checked_in && now.getHours() >= 16) {
        candidates.push({
          action: 'Complete your daily journal check-in',
          score: 40,
          reason: 'After 4pm and not checked in yet',
        });
      }

      candidates.sort((a, b) => b.score - a.score);

      if (candidates.length === 0) return '✅ Nothing urgent — you\'re caught up! Consider prospecting or prepping for tomorrow.';

      const top = candidates[0];
      const runners = candidates.slice(1, 3);

      return `🎯 #1 Priority Right Now:\n${top.action}\nWhy: ${top.reason}${runners.length ? `\n\nAlso consider:\n${runners.map((r, i) => `${i + 2}. ${r.action} (${r.reason})`).join('\n')}` : ''}`;
    },

    // ── Contact Engagement Timeline ────────────────────────────────
    contact_timeline: async (params: { contactName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Find the contact
      const { data: contacts } = await supabase
        .from('contacts')
        .select('id, name, title, account_id, last_touch_date')
        .eq('user_id', userId)
        .ilike('name', `%${params.contactName}%`)
        .limit(1);

      if (!contacts?.length) return `Contact matching "${params.contactName}" not found`;
      const contact = contacts[0] as any;

      // Find transcripts mentioning this contact
      const { data: transcripts } = await supabase
        .from('call_transcripts')
        .select('id, title, call_date, call_type')
        .eq('user_id', userId)
        .or(`participants.ilike.%${params.contactName}%,title.ilike.%${params.contactName}%`)
        .order('call_date', { ascending: false })
        .limit(5);

      // Find calendar events with this contact
      const { data: events } = await supabase
        .from('calendar_events')
        .select('id, title, start_time')
        .eq('user_id', userId)
        .ilike('title', `%${params.contactName}%`)
        .order('start_time', { ascending: false })
        .limit(5);

      const engagements: string[] = [];
      for (const t of (transcripts || []) as any[]) {
        engagements.push(`📞 ${t.call_date}: ${t.title} (${t.call_type || 'call'})`);
      }
      for (const e of (events || []) as any[]) {
        engagements.push(`📅 ${new Date(e.start_time).toLocaleDateString()}: ${e.title}`);
      }

      engagements.sort().reverse();

      const staleDays = contact.last_touch_date
        ? Math.ceil((Date.now() - new Date(contact.last_touch_date).getTime()) / 86400000)
        : null;

      return `👤 ${contact.name}${contact.title ? ` — ${contact.title}` : ''}\n${staleDays !== null ? `Last touch: ${staleDays} days ago${staleDays > 14 ? ' ⚠️ Going cold!' : ''}` : 'No touch date recorded'}\n\nEngagement History:\n${engagements.length ? engagements.slice(0, 8).join('\n') : 'No engagements found — consider reaching out!'}`;
    },

    // ── Save Commitment ────────────────────────────────────────────
    save_commitment: async (params: { commitment: string; accountName?: string; dueDate?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      let accountId: string | null = null;
      if (params.accountName) {
        const { data: accounts } = await supabase
          .from('accounts')
          .select('id, name, notes')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        if (accounts?.length) {
          accountId = accounts[0].id;
          // Append to account notes
          const existing = (accounts[0] as any).notes || '';
          await supabase
            .from('accounts')
            .update({ notes: `${existing}\n\n🤝 Commitment (${new Date().toLocaleDateString()}): ${params.commitment}`.trim() })
            .eq('id', accountId);
        }
      }

      // Create a task for the commitment
      const dueDate = params.dueDate ? parseDueDate(params.dueDate) : new Date().toISOString().split('T')[0];
      const { error } = await supabase
        .from('tasks')
        .insert({
          user_id: userId,
          title: `🤝 ${params.commitment}`,
          priority: 'P2',
          status: 'todo',
          due_date: dueDate,
          linked_account_id: accountId,
          source: 'dave-commitment',
        } as any);

      if (error) return `Failed to save commitment: ${error.message}`;
      emitDataChanged('tasks');
      toast.success('Commitment saved', { description: params.commitment });
      return `Saved commitment: "${params.commitment}"${accountId ? ` (linked to account)` : ''} — task created for ${dueDate}`;
    },

    // ═══════════════════════════════════════════════════════════════
    // PHASE 4: Advanced Synthesis & Workflow Tools
    // ═══════════════════════════════════════════════════════════════

    // ── Voice-Triggered Content Generation ─────────────────────────
    generate_content: async (params: { contentType: string; accountName?: string; opportunityName?: string; contactName?: string; customInstructions?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Resolve account
      let accountContext: any = null;
      let oppContext: any = null;
      let transcriptContext = '';
      let methodologyContext = '';

      if (params.accountName) {
        const { data: accounts } = await supabase
          .from('accounts')
          .select('id, name, industry, notes')
          .eq('user_id', userId)
          .ilike('name', `%${params.accountName}%`)
          .limit(1);
        if (accounts?.length) {
          accountContext = accounts[0];

          // Get latest transcript for this account
          const { data: transcripts } = await supabase
            .from('call_transcripts')
            .select('summary, call_date, call_type')
            .eq('user_id', userId)
            .eq('account_id', accountContext.id)
            .order('call_date', { ascending: false })
            .limit(2);
          if (transcripts?.length) {
            transcriptContext = (transcripts as any[]).map(t => `[${t.call_date} ${t.call_type}]: ${t.summary || 'No summary'}`).join('\n');
          }

          // Get contacts
          const { data: contacts } = await supabase
            .from('contacts')
            .select('name, title, buyer_role')
            .eq('user_id', userId)
            .eq('account_id', accountContext.id)
            .limit(5);
          if (contacts?.length) {
            accountContext.contacts = (contacts as any[]).map(c => `${c.name} (${c.title || 'N/A'}, ${c.buyer_role || 'N/A'})`).join(', ');
          }
        }
      }

      if (params.opportunityName) {
        const { data: opps } = await supabase
          .from('opportunities')
          .select('id, name, stage, arr, close_date, next_step')
          .eq('user_id', userId)
          .ilike('name', `%${params.opportunityName}%`)
          .limit(1);
        if (opps?.length) {
          oppContext = opps[0];

          // Get methodology
          const { data: meth } = await supabase
            .from('opportunity_methodology' as any)
            .select('*')
            .eq('opportunity_id', oppContext.id)
            .maybeSingle();
          if (meth) {
            const m = meth as any;
            const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
              .filter(f => !m[`${f}_confirmed`]);
            methodologyContext = `MEDDICC gaps: ${gaps.length ? gaps.join(', ') : 'All confirmed'}`;
          }
        }
      }

      // Build the prompt for build-resource
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
          body: {
            type: 'generate',
            prompt: fullPrompt,
            outputType: params.contentType || 'email',
            accountContext: accountContext ? { name: accountContext.name, industry: accountContext.industry, contacts: accountContext.contacts } : undefined,
          },
        });

        if (error) throw new Error(error);

        // Copy to clipboard
        if (result && navigator.clipboard) {
          try { await navigator.clipboard.writeText(result); } catch {}
        }

        toast.success(`${params.contentType} generated`, { description: 'Copied to clipboard' });
        return `✅ Generated ${params.contentType}:\n\n${result.slice(0, 2000)}${result.length > 2000 ? '\n\n[...truncated, full content copied to clipboard]' : ''}`;
      } catch (e: any) {
        return `Failed to generate content: ${e.message}`;
      }
    },

    // ── Open Content Builder in Prep Hub ────────────────────────────
    open_content_builder: (params: { accountName?: string; opportunityName?: string; contentType?: string; customInstructions?: string }) => {
      navigate('/prep');
      // Dispatch event for Prep Hub to pick up
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('dave-open-content-builder', {
          detail: {
            accountName: params.accountName,
            opportunityName: params.opportunityName,
            contentType: params.contentType || 'email',
            customInstructions: params.customInstructions,
          },
        }));
      }, 500);
      toast.info('Opening Prep Hub', { description: params.contentType || 'Content builder' });
      return `Opened Prep Hub content builder${params.accountName ? ` for ${params.accountName}` : ''}`;
    },

    // ── AI Deal Risk Assessment ────────────────────────────────────
    assess_deal_risk: async (params: { opportunityName?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Get all active opps or a specific one
      const query = supabase
        .from('opportunities')
        .select('id, name, stage, arr, close_date, last_touch_date, next_step, next_step_date, notes, account_id')
        .eq('user_id', userId)
        .not('status', 'eq', 'closed-won')
        .not('status', 'eq', 'closed-lost');

      if (params.opportunityName) {
        query.ilike('name', `%${params.opportunityName}%`);
      }

      const { data: opps } = await query.order('arr', { ascending: false }).limit(params.opportunityName ? 1 : 10);
      if (!opps?.length) return params.opportunityName ? `No active deal matching "${params.opportunityName}"` : 'No active deals found';

      const risks: { name: string; arr: number; score: number; factors: string[] }[] = [];

      for (const opp of opps as any[]) {
        const factors: string[] = [];
        let riskScore = 0;

        // Staleness
        if (opp.last_touch_date) {
          const daysSince = Math.ceil((Date.now() - new Date(opp.last_touch_date).getTime()) / 86400000);
          if (daysSince > 14) { riskScore += 30; factors.push(`${daysSince}d since last touch`); }
          else if (daysSince > 7) { riskScore += 15; factors.push(`${daysSince}d since last touch`); }
        } else {
          riskScore += 20; factors.push('No touch date recorded');
        }

        // Close date proximity
        if (opp.close_date) {
          const daysToClose = Math.ceil((new Date(opp.close_date).getTime() - Date.now()) / 86400000);
          if (daysToClose < 0) { riskScore += 40; factors.push(`Close date ${Math.abs(daysToClose)}d overdue`); }
          else if (daysToClose < 14) { riskScore += 20; factors.push(`Closing in ${daysToClose}d`); }
        }

        // MEDDICC gaps
        const { data: meth } = await supabase
          .from('opportunity_methodology' as any)
          .select('*')
          .eq('opportunity_id', opp.id)
          .maybeSingle();

        if (meth) {
          const m = meth as any;
          const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
            .filter(f => !m[`${f}_confirmed`]);
          if (gaps.length >= 4) { riskScore += 30; factors.push(`${gaps.length} MEDDICC gaps: ${gaps.join(', ')}`); }
          else if (gaps.length >= 2) { riskScore += 15; factors.push(`${gaps.length} MEDDICC gaps: ${gaps.join(', ')}`); }
        } else {
          riskScore += 25; factors.push('No MEDDICC data');
        }

        // No next step
        if (!opp.next_step) { riskScore += 10; factors.push('No next step defined'); }

        risks.push({ name: opp.name, arr: opp.arr || 0, score: riskScore, factors });
      }

      risks.sort((a, b) => b.score - a.score);

      const riskLevel = (score: number) => score >= 50 ? '🔴 HIGH' : score >= 25 ? '🟡 MEDIUM' : '🟢 LOW';

      if (params.opportunityName && risks.length === 1) {
        const r = risks[0];
        return `${riskLevel(r.score)} Risk — ${r.name} ($${(r.arr / 1000).toFixed(0)}k)\nRisk Score: ${r.score}/100\n\nRisk Factors:\n${r.factors.map(f => `• ${f}`).join('\n')}\n\nRecommendation: ${r.score >= 50 ? 'Needs immediate attention — schedule a call, confirm champion, and update next steps.' : r.score >= 25 ? 'Monitor closely — address the gaps above this week.' : 'On track — keep momentum.'}`;
      }

      return `📊 Deal Risk Assessment:\n\n${risks.slice(0, 5).map(r =>
        `${riskLevel(r.score)} ${r.name} ($${(r.arr / 1000).toFixed(0)}k) — Score: ${r.score}\n  ${r.factors.slice(0, 3).join(' | ')}`
      ).join('\n\n')}`;
    },

    // ── Competitive Intelligence Query ─────────────────────────────
    competitive_intel: async (params: { query: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const searchTerm = params.query.toLowerCase();

      // Search transcripts
      const { data: transcripts } = await supabase
        .from('call_transcripts')
        .select('id, title, call_date, account_id, content')
        .eq('user_id', userId)
        .ilike('content', `%${params.query}%`)
        .order('call_date', { ascending: false })
        .limit(10);

      // Search account notes
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name, notes')
        .eq('user_id', userId)
        .ilike('notes', `%${params.query}%`)
        .limit(10);

      // Search opportunity notes
      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, notes, account_id')
        .eq('user_id', userId)
        .ilike('notes', `%${params.query}%`)
        .limit(10);

      // Get transcript grades with competitor mentions
      const { data: grades } = await supabase
        .from('transcript_grades')
        .select('transcript_id, competitors_mentioned')
        .eq('user_id', userId)
        .not('competitors_mentioned', 'is', null)
        .limit(50);

      const gradeMatches = (grades || []).filter((g: any) =>
        (g.competitors_mentioned || []).some((c: string) => c.toLowerCase().includes(searchTerm))
      );

      // Resolve account names for transcript matches
      const accountIds = [...new Set((transcripts || []).map((t: any) => t.account_id).filter(Boolean))];
      let accountMap: Record<string, string> = {};
      if (accountIds.length) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id, name')
          .in('id', accountIds);
        accountMap = Object.fromEntries((accts || []).map((a: any) => [a.id, a.name]));
      }

      const results: string[] = [];

      for (const t of (transcripts || []) as any[]) {
        const acctName = accountMap[t.account_id] || 'Unknown';
        // Extract snippet around mention
        const idx = (t.content || '').toLowerCase().indexOf(searchTerm);
        const snippet = idx >= 0 ? (t.content || '').slice(Math.max(0, idx - 50), idx + searchTerm.length + 100).trim() : '';
        results.push(`📞 ${t.call_date} — ${acctName}: "${snippet.slice(0, 150)}..."`);
      }

      for (const a of (accounts || []) as any[]) {
        results.push(`🏢 Account "${a.name}" notes mention "${params.query}"`);
      }

      for (const o of (opps || []) as any[]) {
        results.push(`💼 Deal "${o.name}" notes mention "${params.query}"`);
      }

      if (gradeMatches.length) {
        results.push(`📊 ${gradeMatches.length} call grade(s) flagged "${params.query}" as a competitor`);
      }

      if (!results.length) return `No mentions of "${params.query}" found in your transcripts, accounts, or deals.`;

      return `🔍 Competitive Intel for "${params.query}":\n\n${results.slice(0, 10).join('\n\n')}${results.length > 10 ? `\n\n...and ${results.length - 10} more mentions` : ''}`;
    },

    // ── Create Methodology Tasks from Gaps ─────────────────────────
    create_methodology_tasks: async (params: { opportunityName: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, close_date, arr, account_id')
        .eq('user_id', userId)
        .ilike('name', `%${params.opportunityName}%`)
        .limit(1);

      if (!opps?.length) return `No opportunity matching "${params.opportunityName}"`;
      const opp = opps[0] as any;

      const { data: meth } = await supabase
        .from('opportunity_methodology' as any)
        .select('*')
        .eq('opportunity_id', opp.id)
        .maybeSingle();

      if (!meth) return `No methodology data for "${opp.name}" — update MEDDICC first.`;

      const m = meth as any;
      const MEDDICC_TASK_MAP: Record<string, string> = {
        metrics: 'Confirm Metrics: Ask what success metrics they\'ll measure — tie to their KPIs',
        economic_buyer: 'Identify Economic Buyer: Ask who signs off on budget and what their approval process looks like',
        decision_criteria: 'Map Decision Criteria: Ask what they\'re evaluating vendors on — technical, commercial, and cultural fit',
        decision_process: 'Map Decision Process: Ask about timeline, stakeholders involved, and approval steps',
        identify_pain: 'Quantify Pain: Ask about the cost of inaction — lost revenue, wasted time, risk exposure',
        champion: 'Test Champion: Ask your champion to introduce you to the economic buyer or set up a technical validation',
        competition: 'Assess Competition: Ask who else they\'re evaluating and what criteria matter most',
      };

      const gaps = Object.entries(MEDDICC_TASK_MAP)
        .filter(([field]) => !m[`${field}_confirmed`]);

      if (!gaps.length) return `✅ All MEDDICC elements confirmed for "${opp.name}" — no tasks needed!`;

      // Calculate due dates based on close date
      const closeDate = opp.close_date ? new Date(opp.close_date) : new Date();
      const now = new Date();
      const daysToClose = Math.max(1, Math.ceil((closeDate.getTime() - now.getTime()) / 86400000));
      const interval = Math.max(1, Math.floor(daysToClose / gaps.length));

      const created: string[] = [];
      for (let i = 0; i < gaps.length; i++) {
        const [, taskTitle] = gaps[i];
        const dueDate = new Date(now);
        dueDate.setDate(dueDate.getDate() + Math.min(interval * (i + 1), daysToClose));

        await supabase
          .from('tasks')
          .insert({
            user_id: userId,
            title: `[${opp.name}] ${taskTitle}`,
            priority: i < 2 ? 'P1' : 'P2',
            status: 'todo',
            due_date: dueDate.toISOString().split('T')[0],
            linked_account_id: opp.account_id,
            source: 'dave-methodology',
          } as any);

        created.push(`• ${taskTitle} (due ${dueDate.toLocaleDateString()})`);
      }

      emitDataChanged('tasks');
      toast.success(`${created.length} MEDDICC tasks created`, { description: opp.name });
      return `Created ${created.length} tasks to close MEDDICC gaps on "${opp.name}":\n\n${created.join('\n')}`;
    },

    // ── Meeting Brief (Inline) ─────────────────────────────────────
    meeting_brief: async (params: { meetingTitle?: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Get upcoming calendar events
      const now = new Date().toISOString();
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const { data: events } = await supabase
        .from('calendar_events')
        .select('id, title, start_time, end_time, description')
        .eq('user_id', userId)
        .gte('start_time', now)
        .lte('start_time', tomorrow)
        .order('start_time', { ascending: true })
        .limit(10);

      if (!events?.length) return 'No upcoming meetings found in the next 24 hours.';

      // Find the target meeting
      let target = events[0] as any;
      if (params.meetingTitle) {
        const match = (events as any[]).find(e =>
          e.title.toLowerCase().includes(params.meetingTitle!.toLowerCase())
        );
        if (match) target = match;
      }

      // Fuzzy match against accounts
      const { data: accounts } = await supabase
        .from('accounts')
        .select('id, name, industry, tier, notes, last_touch_date, account_status')
        .eq('user_id', userId);

      const matchedAccount = (accounts || []).find((a: any) =>
        target.title.toLowerCase().includes(a.name.toLowerCase()) ||
        a.name.toLowerCase().includes(target.title.toLowerCase().replace(/meeting|call|sync|review|check-in|intro/gi, '').trim())
      ) as any;

      if (!matchedAccount) {
        return `📅 Next meeting: "${target.title}" at ${new Date(target.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}\n\nCouldn't match to an account — try "prep meeting for [account name]" for a full brief.`;
      }

      // Get opportunity context
      const { data: opps } = await supabase
        .from('opportunities')
        .select('id, name, stage, arr, close_date, next_step')
        .eq('user_id', userId)
        .eq('account_id', matchedAccount.id)
        .not('status', 'eq', 'closed-won')
        .not('status', 'eq', 'closed-lost')
        .limit(3);

      // Get methodology for top opp
      let methSummary = '';
      if (opps?.length) {
        const { data: meth } = await supabase
          .from('opportunity_methodology' as any)
          .select('*')
          .eq('opportunity_id', opps[0].id)
          .maybeSingle();
        if (meth) {
          const m = meth as any;
          const gaps = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition']
            .filter(f => !m[`${f}_confirmed`]);
          methSummary = gaps.length ? `\n⚠️ MEDDICC Gaps: ${gaps.join(', ')}` : '\n✅ All MEDDICC confirmed';
        }
      }

      // Get latest transcript
      const { data: transcripts } = await supabase
        .from('call_transcripts')
        .select('summary, call_date')
        .eq('user_id', userId)
        .eq('account_id', matchedAccount.id)
        .order('call_date', { ascending: false })
        .limit(1);

      // Get key contacts
      const { data: contacts } = await supabase
        .from('contacts')
        .select('name, title, buyer_role')
        .eq('user_id', userId)
        .eq('account_id', matchedAccount.id)
        .limit(5);

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

    // ═══════════════════════════════════════════════════════════════
    // WHOOP & RESOURCE INTELLIGENCE TOOLS
    // ═══════════════════════════════════════════════════════════════

    get_whoop_status: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const today = new Date().toISOString().split('T')[0];
      const { data: metrics } = await supabase
        .from('whoop_daily_metrics')
        .select('*')
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(3);

      if (!metrics?.length) return 'No WHOOP data available. You may need to connect or sync WHOOP in Settings.';

      const todayMetric = (metrics as any[]).find(m => m.date === today);
      const latest = (metrics as any[])[0];
      const m = todayMetric || latest;
      const dateLabel = m.date === today ? 'Today' : m.date;

      const recoveryZone = m.recovery_score >= 67 ? '🟢 Green (go hard)' : m.recovery_score >= 34 ? '🟡 Yellow (moderate)' : '🔴 Red (take it easy)';

      let result = `📊 WHOOP Status (${dateLabel}):\n`;
      result += `Recovery: ${m.recovery_score ?? 'N/A'}% — ${recoveryZone}\n`;
      result += `Sleep: ${m.sleep_score ?? 'N/A'}%\n`;
      result += `Strain: ${m.strain_score ?? 'N/A'}\n`;

      if (m.recovery_score !== null && m.recovery_score < 34) {
        result += '\n⚠️ Low recovery — consider lighter prospecting blocks, more account research, skip the power hour.';
      } else if (m.recovery_score !== null && m.recovery_score >= 67) {
        result += '\n💪 High recovery — great day for heavy calling, difficult conversations, and power hours.';
      }

      return result;
    },

    sync_whoop: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      try {
        const { trackedInvoke } = await import('@/lib/trackedInvoke');
        const { data: result, error } = await trackedInvoke<any>('whoop-sync', {
          body: { action: 'sync' },
        });
        if (error) return `WHOOP sync failed: ${error.message}`;
        if (result?.error) return `WHOOP sync failed: ${result.error}`;

        toast.success('WHOOP synced', { description: `${result?.synced || 0} days of data updated` });
        return `WHOOP sync complete — ${result?.synced || 0} days of data synced.`;
      } catch (err: any) {
        return `WHOOP sync error: ${err.message}`;
      }
    },

    read_resource_digest: async (params: { title: string }) => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      // Find the resource by title match
      const { data: resources } = await supabase
        .from('resources')
        .select('id, title')
        .eq('user_id', userId)
        .ilike('title', `%${params.title}%`)
        .limit(5);

      if (!resources?.length) return `No resource found matching "${params.title}". Try a different title.`;

      const resourceIds = (resources as any[]).map(r => r.id);

      const { data: digests } = await supabase
        .from('resource_digests')
        .select('*')
        .eq('user_id', userId)
        .in('resource_id', resourceIds);

      if (!digests?.length) {
        const titles = (resources as any[]).map(r => r.title).join(', ');
        return `Found resources (${titles}) but none have been operationalized yet. Use "Operationalize" in the Prep Hub to extract intelligence.`;
      }

      const d = digests[0] as any;
      const resource = (resources as any[]).find(r => r.id === d.resource_id);

      let result = `📚 "${resource?.title || params.title}" — Intelligence Digest\n\n`;
      result += `📝 Summary:\n${d.summary || 'No summary'}\n\n`;

      if (d.takeaways?.length) {
        result += `🎯 Key Takeaways:\n${(d.takeaways as string[]).map((t: string) => `• ${t}`).join('\n')}\n\n`;
      }

      if (d.use_cases?.length) {
        result += `📋 Use Cases:\n${(d.use_cases as string[]).map((u: string) => `• ${u}`).join('\n')}\n\n`;
      }

      if (d.grading_criteria) {
        const criteria = d.grading_criteria as any;
        if (criteria.categories?.length) {
          result += `📊 Grading Criteria:\n${criteria.categories.map((c: any) => `• ${c.name}: ${c.description || ''}`).join('\n')}`;
        }
      }

      return result;
    },

    // ═══════════════════════════════════════════════════════════════
    // JARVIS LAYER — Execution Loop Tools
    // ═══════════════════════════════════════════════════════════════

    operating_state: async () => {
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];

      const [tasksRes, oppsRes, renewalsRes] = await Promise.all([
        supabase.from('tasks').select('id, status, due_date, priority')
          .eq('user_id', userId).not('status', 'in', '("done","dropped")'),
        supabase.from('opportunities').select('id, status, next_step, next_step_date, last_touch_date, arr')
          .eq('user_id', userId).eq('status', 'active'),
        supabase.from('renewals').select('id, churn_risk, renewal_due, next_step, arr')
          .eq('user_id', userId),
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
      const userId = await getUserId();
      if (!userId) return 'Not authenticated';

      const now = new Date();
      const todayStr = now.toISOString().split('T')[0];

      const [tasksRes, oppsRes, renewalsRes, calendarRes] = await Promise.all([
        supabase.from('tasks').select('id, title, due_date, priority, linked_account_id')
          .eq('user_id', userId).not('status', 'in', '("done","dropped")')
          .lte('due_date', todayStr).order('priority').limit(10),
        supabase.from('opportunities').select('id, name, arr, next_step, next_step_date, last_touch_date, status')
          .eq('user_id', userId).eq('status', 'active').order('arr', { ascending: false }).limit(20),
        supabase.from('renewals').select('id, account_name, arr, renewal_due, churn_risk, next_step')
          .eq('user_id', userId).limit(20),
        supabase.from('calendar_events').select('id, title, start_time')
          .eq('user_id', userId)
          .gte('start_time', now.toISOString())
          .lte('start_time', new Date(now.getTime() + 2 * 3600000).toISOString())
          .order('start_time').limit(3),
      ]);

      interface Candidate { id: string; action: string; why: string; nextStep: string; score: number }
      const candidates: Candidate[] = [];

      // Upcoming meeting prep
      for (const e of (calendarRes.data || []) as any[]) {
        const mins = Math.max(0, (new Date(e.start_time).getTime() - now.getTime()) / 60000);
        candidates.push({
          id: `meeting-${e.id}`,
          action: `Prep for "${e.title}" (${Math.round(mins)} min away)`,
          why: 'Upcoming meeting needs preparation',
          nextStep: 'Review account context and set your call goals.',
          score: mins < 30 ? 250 : 150,
        });
      }

      // At-risk renewals
      for (const r of (renewalsRes.data || []) as any[]) {
        const days = Math.ceil((new Date(r.renewal_due).getTime() - now.getTime()) / 86400000);
        if (days <= 30 && (r.churn_risk === 'high' || r.churn_risk === 'certain')) {
          candidates.push({
            id: `renewal-${r.id}`,
            action: `Address renewal risk: ${r.account_name}`,
            why: `$${((r.arr || 0) / 1000).toFixed(0)}k renewal in ${days} days, ${r.churn_risk} risk`,
            nextStep: r.next_step || 'Schedule a risk mitigation call.',
            score: 200 + (r.arr || 0) / 1000,
          });
        }
      }

      // Overdue tasks
      for (const t of (tasksRes.data || []) as any[]) {
        const pw = t.priority === 'P0' ? 5 : t.priority === 'P1' ? 4 : t.priority === 'P2' ? 2 : 1;
        candidates.push({
          id: `task-${t.id}`,
          action: t.title,
          why: `${t.priority} task overdue`,
          nextStep: 'Complete or reschedule now.',
          score: 60 * pw,
        });
      }

      // Deals missing next step
      for (const o of (oppsRes.data || []) as any[]) {
        if (!o.next_step && !o.next_step_date) {
          candidates.push({
            id: `opp-ns-${o.id}`,
            action: `Set next step on "${o.name}"`,
            why: `$${((o.arr || 0) / 1000).toFixed(0)}k deal with no defined next step`,
            nextStep: 'Define what advances this deal.',
            score: 100 + (o.arr || 0) / 2000,
          });
        }
      }

      // Apply action memory adjustments
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
      // Compose operating_state + primary_action in one call
      const stateResult = await allTools.operating_state();
      const actionResult = await allTools.primary_action();
      return `${stateResult}\n\n${actionResult}`;
    },
  };

  // ── Wrap all DB-writing tools with toast + activity log ────────
  const DB_WRITE_TOOLS = [
    'create_task', 'update_account', 'update_opportunity', 'update_methodology',
    'log_touch', 'move_deal', 'debrief', 'add_note', 'update_daily_metrics',
    'add_contact', 'create_opportunity', 'create_account', 'update_renewal',
    'complete_task', 'set_task_reminder', 'save_commitment',
    'complete_action', 'defer_action',
  ];

  const today = new Date().toISOString().split('T')[0];
  const logKey = `dave-activity-${today}`;

  for (const toolName of DB_WRITE_TOOLS) {
    if (toolName in allTools) {
      const original = (allTools as any)[toolName];
      (allTools as any)[toolName] = async (...args: any[]) => {
        const result = await original(...args);
        try {
          const existing = JSON.parse(localStorage.getItem(logKey) || '[]');
          existing.push({ tool: toolName, result: typeof result === 'string' ? result.slice(0, 200) : '', ts: Date.now() });
          localStorage.setItem(logKey, JSON.stringify(existing.slice(-100)));
        } catch {}
        return result;
      };
    }
  }

  return allTools;
}
