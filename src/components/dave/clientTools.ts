import { NavigateFunction } from 'react-router-dom';
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
        priority: params.priority || 'P2',
        status: 'next',
        workstream: 'pg',
        linked_account_id: linkedAccountId,
        category: 'voice-created',
        due_date: dueDate,
      });

      if (error) {
        console.error('Voice create_task error:', error);
        return `Failed to create task: ${error.message}`;
      }
      emitDataChanged('tasks');

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

      const dbField = RENEWAL_FIELDS[params.field.toLowerCase()] || params.field;

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
        .update({ status: 'done', updated_at: new Date().toISOString() })
        .eq('id', tasks[0].id);

      if (error) return `Failed to complete task: ${error.message}`;
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
        .ilike('name', `%${params.name}%`)
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

      const { data, error } = await supabase.functions.invoke('enrich-account', {
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
      const { data, error } = await supabase.functions.invoke('weekly-battle-plan', {
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
      const { data, error } = await supabase.functions.invoke('weekly-patterns', {
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
      const { data, error } = await supabase.functions.invoke('prioritize-accounts', {
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
      const { data, error } = await supabase.functions.invoke('pipeline-hygiene', {
        body: {},
      });

      if (error) return `Pipeline hygiene scan failed: ${error.message}`;
      return `Pipeline hygiene: Health ${data?.health_score || '—'}/100, ${data?.total_issues || 0} issues found (${data?.critical_issues || 0} critical). ${data?.summary?.top_issues ? `Top: ${data.summary.top_issues.join(', ')}` : 'Check dashboard for details.'}`;
    },
  };
}
