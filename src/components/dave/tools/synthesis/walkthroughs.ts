/**
 * Universal conversational walkthrough tools for Dave.
 * Reads real app data and returns voice-first, natural language summaries
 * or detailed item-by-item walkthroughs for any major entity.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';

// ── Shared filter model ─────────────────────────────────────────

export interface DaveQueryFilter {
  mode?: 'summary' | 'detailed';
  statuses?: string[];           // include only these statuses
  excludeStatuses?: string[];    // exclude these statuses
  dealType?: string;             // 'new-logo' | 'renewal' | etc.
  timeframe?: string;            // 'this-quarter' | 'this-month' | 'next-30' | 'next-45' | 'this-year'
  sortBy?: 'arr' | 'date' | 'priority' | 'risk' | 'name';
  groupBy?: 'stage' | 'quarter' | 'status' | 'priority';
  limit?: number;
  riskOnly?: boolean;
  stalledOnly?: boolean;
  question?: string;             // raw follow-up question
}

// ── Helpers ─────────────────────────────────────────────────────

function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

function dollars(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v}`;
}

function daysFromNow(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000);
}

function getQuarterBounds(): { start: string; end: string } {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3);
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), q * 3 + 3, 0);
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

function getMonthBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

function getDaysBounds(days: number): { start: string; end: string } {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + days);
  return { start: now.toISOString().split('T')[0], end: end.toISOString().split('T')[0] };
}

function parseFilterFromQuestion(q: string): DaveQueryFilter {
  const lower = q.toLowerCase();
  const filter: DaveQueryFilter = {};

  // Mode
  if (lower.includes('step by step') || lower.includes('in detail') || lower.includes('one by one') ||
      lower.includes('walk me through') || lower.includes('guide me') || lower.includes('go through each')) {
    filter.mode = 'detailed';
  } else {
    filter.mode = 'summary';
  }

  // Statuses to exclude
  const excludes: string[] = [];
  if (lower.includes('exclude closed won') || lower.includes('not closed won') || lower.includes('no closed won')) excludes.push('closed-won');
  if (lower.includes('exclude closed lost') || lower.includes('not closed lost') || lower.includes('no closed lost')) excludes.push('closed-lost');
  if (lower.includes('exclude churned') || lower.includes('not churned')) excludes.push('churned');
  // Default for "open" — exclude both closed states
  if (lower.includes('open ') || lower.includes('open,') || lower.match(/\bopen\b/)) {
    if (!excludes.includes('closed-won')) excludes.push('closed-won');
    if (!excludes.includes('closed-lost')) excludes.push('closed-lost');
  }
  if (excludes.length) filter.excludeStatuses = excludes;

  // Specific statuses
  if (lower.includes('stalled')) { filter.stalledOnly = true; filter.statuses = ['stalled']; }
  if (lower.includes('at risk') || lower.includes('at-risk') || lower.includes('risky')) filter.riskOnly = true;
  if (lower.includes('active only') || lower.match(/\bactive\b/)) filter.statuses = ['active', 'open'];

  // Deal type
  if (lower.includes('new logo') || lower.includes('new-logo')) filter.dealType = 'new-logo';
  if (lower.includes('renewal')) filter.dealType = 'renewal';

  // Timeframe
  if (lower.includes('this quarter') || lower.includes('closing this quarter') || lower.includes('due this quarter')) filter.timeframe = 'this-quarter';
  else if (lower.includes('this month') || lower.includes('due this month')) filter.timeframe = 'this-month';
  else if (lower.includes('next 30') || lower.includes('30 day')) filter.timeframe = 'next-30';
  else if (lower.includes('next 45') || lower.includes('45 day')) filter.timeframe = 'next-45';
  else if (lower.includes('this year')) filter.timeframe = 'this-year';

  // Sort
  if (lower.includes('biggest') || lower.includes('largest') || lower.includes('highest value')) filter.sortBy = 'arr';
  if (lower.includes('highest risk') || lower.includes('riskiest')) { filter.sortBy = 'risk'; filter.riskOnly = true; }
  if (lower.includes('focus on first') || lower.includes('prioritize')) filter.sortBy = 'priority';
  if (lower.includes('soonest') || lower.includes('earliest')) filter.sortBy = 'date';

  // Group
  if (lower.includes('by stage') || lower.includes('grouped by stage')) filter.groupBy = 'stage';
  if (lower.includes('by quarter') || lower.includes('grouped by quarter')) filter.groupBy = 'quarter';

  return filter;
}

function getTimeBounds(timeframe?: string): { start: string; end: string } | null {
  if (!timeframe) return null;
  switch (timeframe) {
    case 'this-quarter': return getQuarterBounds();
    case 'this-month': return getMonthBounds();
    case 'next-30': return getDaysBounds(30);
    case 'next-45': return getDaysBounds(45);
    case 'this-year': {
      const now = new Date();
      return { start: `${now.getFullYear()}-01-01`, end: `${now.getFullYear()}-12-31` };
    }
    default: return null;
  }
}

const transitions = ['', 'Next up, ', 'Then there\'s ', 'After that, ', 'Also, ', 'And then, ', 'Moving on, ', 'Following that, ', 'Then we\'ve got ', 'Finally, '];

// ── Decision / recommendation helpers ───────────────────────────

interface PrioritizedItem {
  name: string;
  arr?: number;
  urgencyScore: number;
  riskLabel?: string;
  reason: string;
  nextStep: string;
}

function scoreOppPriority(o: any): PrioritizedItem {
  let score = 0;
  const reasons: string[] = [];
  const arr = Number(o.arr || 0);

  // Deal size weight
  score += arr / 1000;

  // Close date urgency
  if (o.close_date) {
    const days = daysFromNow(o.close_date);
    if (days < 0) { score += 80; reasons.push(`${Math.abs(days)}d past close date`); }
    else if (days <= 14) { score += 50; reasons.push(`closing in ${days}d`); }
    else if (days <= 30) { score += 25; reasons.push(`closing in ${days}d`); }
  }

  // Stale
  if (o.last_touch_date && daysFromNow(o.last_touch_date) < -14) {
    const staleDays = Math.abs(daysFromNow(o.last_touch_date));
    score += 30; reasons.push(`${staleDays}d since last touch`);
  }

  // Risk
  if (o.churn_risk === 'high') { score += 40; reasons.push('high risk'); }
  else if (o.churn_risk === 'medium') { score += 15; reasons.push('moderate risk'); }

  // No next step
  if (!o.next_step) { score += 20; reasons.push('no next step defined'); }

  const nextStep = o.next_step
    ? `${o.next_step.charAt(0).toUpperCase()}${o.next_step.slice(1).replace(/\.$/, '')}`
    : 'Define a next step and reach out to your contact';

  return { name: o.name || o.account_name, arr, urgencyScore: score, riskLabel: o.churn_risk, reason: joinNatural(reasons) || 'high value', nextStep };
}

function scoreRenewalPriority(r: any): PrioritizedItem {
  let score = 0;
  const reasons: string[] = [];
  const arr = Number(r.arr || 0);

  score += arr / 1000;

  if (r.renewal_due) {
    const days = daysFromNow(r.renewal_due);
    if (days < 0) { score += 90; reasons.push(`${Math.abs(days)}d overdue`); }
    else if (days <= 14) { score += 60; reasons.push(`due in ${days}d`); }
    else if (days <= 30) { score += 30; reasons.push(`due in ${days}d`); }
  }

  if (r.churn_risk === 'high' || r.churn_risk === 'certain') { score += 50; reasons.push(`${r.churn_risk} churn risk`); }
  else if (r.churn_risk === 'medium') { score += 20; reasons.push('moderate risk'); }
  if (r.health_status === 'red') { score += 30; reasons.push('red health'); }
  if (!r.next_step) { score += 15; reasons.push('no next step'); }

  const nextStep = r.next_step
    ? `${r.next_step.charAt(0).toUpperCase()}${r.next_step.slice(1).replace(/\.$/, '')}`
    : 'Schedule a check-in with the account team';

  return { name: r.account_name, arr, urgencyScore: score, riskLabel: r.churn_risk || r.health_status, reason: joinNatural(reasons) || 'upcoming renewal', nextStep };
}

function scoreTaskPriority(t: any, accountMap: Record<string, string>): PrioritizedItem {
  let score = 0;
  const reasons: string[] = [];

  if (t.priority === 'P0') { score += 100; reasons.push('P0'); }
  else if (t.priority === 'P1') { score += 60; reasons.push('P1'); }
  else if (t.priority === 'P2') { score += 25; }

  const today = new Date().toISOString().split('T')[0];
  if (t.due_date && t.due_date < today) {
    const daysLate = Math.abs(daysFromNow(t.due_date));
    score += 40 + daysLate * 2;
    reasons.push(`${daysLate}d overdue`);
  } else if (t.due_date === today) {
    score += 30;
    reasons.push('due today');
  }

  const acct = t.linked_account_id ? accountMap[t.linked_account_id] : null;
  const name = `${t.title}${acct ? ` (${acct})` : ''}`;

  return { name, urgencyScore: score, reason: joinNatural(reasons) || 'pending task', nextStep: 'Complete or reschedule this task' };
}

function buildActionRecommendation(items: PrioritizedItem[]): string {
  if (!items.length) return '';
  const sorted = [...items].sort((a, b) => b.urgencyScore - a.urgencyScore);
  const top = sorted[0];

  let rec = `\n\nIf I had to pick one thing to focus on right now, it's ${top.name}`;
  if (top.reason) rec += ` — ${top.reason}`;
  rec += `. ${top.nextStep}.`;

  if (sorted.length > 1) {
    const second = sorted[1];
    rec += ` After that, turn to ${second.name}.`;
  }

  return rec;
}

// ── Opportunities walkthrough ───────────────────────────────────

export async function queryOpportunities(ctx: ToolContext, params: { question?: string; filter?: DaveQueryFilter }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const filter = params.filter || (params.question ? parseFilterFromQuestion(params.question) : { mode: 'summary' as const });
  const bounds = getTimeBounds(filter.timeframe);

  let query = supabase
    .from('opportunities')
    .select('id, name, stage, arr, close_date, status, deal_type, next_step, last_touch_date, churn_risk, account_id, notes')
    .eq('user_id', userId);

  // Exclude statuses
  const defaultExcludes = filter.excludeStatuses || ['closed-won', 'closed-lost'];
  for (const s of defaultExcludes) {
    query = query.not('status', 'eq', s);
  }

  // Include only specific statuses
  if (filter.statuses?.length) {
    query = query.in('status', filter.statuses);
  }

  // Deal type
  if (filter.dealType) {
    if (filter.dealType === 'new-logo') {
      query = query.eq('is_new_logo', true);
    } else {
      query = query.eq('deal_type', filter.dealType);
    }
  }

  // Time bounds on close_date
  if (bounds) {
    query = query.gte('close_date', bounds.start).lte('close_date', bounds.end);
  }

  // Sort
  const sortCol = filter.sortBy === 'date' ? 'close_date' : 'arr';
  query = query.order(sortCol, { ascending: filter.sortBy === 'date' }).limit(filter.limit || 30);

  const { data: opps } = await query;
  if (!opps?.length) {
    const desc = filter.dealType === 'new-logo' ? 'new logo opportunities' : filter.dealType === 'renewal' ? 'renewal opportunities' : 'opportunities';
    return `I don't see any ${desc} matching those filters right now.`;
  }

  // Sort by risk if requested
  let sorted = [...opps];
  if (filter.sortBy === 'arr') sorted.sort((a, b) => (b.arr || 0) - (a.arr || 0));
  if (filter.sortBy === 'risk') {
    sorted.sort((a, b) => {
      const riskA = a.churn_risk === 'high' ? 3 : a.churn_risk === 'medium' ? 2 : 1;
      const riskB = b.churn_risk === 'high' ? 3 : b.churn_risk === 'medium' ? 2 : 1;
      return riskB - riskA;
    });
  }

  // Filter risk only
  if (filter.riskOnly) {
    sorted = sorted.filter(o => o.churn_risk === 'high' || o.churn_risk === 'medium' || (o.last_touch_date && daysFromNow(o.last_touch_date) < -14));
  }

  const totalArr = sorted.reduce((s, o) => s + (o.arr || 0), 0);
  const dealLabel = filter.dealType === 'new-logo' ? 'new logo' : filter.dealType === 'renewal' ? 'renewal' : '';
  const timeLabel = filter.timeframe === 'this-quarter' ? ' closing this quarter' : filter.timeframe === 'this-month' ? ' closing this month' : '';

  if (filter.mode === 'detailed') {
    return buildDetailedOpps(sorted, totalArr, dealLabel, timeLabel);
  }
  return buildSummaryOpps(sorted, totalArr, dealLabel, timeLabel);
}

function buildSummaryOpps(opps: any[], totalArr: number, dealLabel: string, timeLabel: string): string {
  const sentences: string[] = [];
  sentences.push(`You've got ${opps.length} ${dealLabel} ${opps.length === 1 ? 'opportunity' : 'opportunities'}${timeLabel} worth ${dollars(totalArr)} total.`);

  // Group by stage
  const byStage: Record<string, any[]> = {};
  for (const o of opps) {
    const stage = o.stage || 'No Stage';
    if (!byStage[stage]) byStage[stage] = [];
    byStage[stage].push(o);
  }

  const stageEntries = Object.entries(byStage);
  if (stageEntries.length > 1 && stageEntries.length <= 6) {
    const stageParts = stageEntries.map(([stage, deals]) => {
      const total = deals.reduce((s: number, d: any) => s + (d.arr || 0), 0);
      return `${deals.length} in ${stage} at ${dollars(total)}`;
    });
    sentences.push(`Broken down, you have ${joinNatural(stageParts)}.`);
  }

  // Biggest deals
  const top3 = [...opps].sort((a, b) => (b.arr || 0) - (a.arr || 0)).slice(0, 3);
  if (top3.length) {
    const topParts = top3.map(o => `${o.name} at ${dollars(o.arr || 0)}`);
    sentences.push(`Your biggest ${top3.length === 1 ? 'deal is' : 'deals are'} ${joinNatural(topParts)}.`);
  }

  // Risk callout
  const atRisk = opps.filter(o => o.churn_risk === 'high' || (o.close_date && daysFromNow(o.close_date) < 14 && daysFromNow(o.close_date) >= 0));
  if (atRisk.length) {
    sentences.push(`${atRisk.length} ${atRisk.length === 1 ? 'deal needs' : 'deals need'} attention — ${joinNatural(atRisk.slice(0, 3).map(o => o.name))}${atRisk.length > 3 ? ` and ${atRisk.length - 3} more` : ''}.`);
  }

  // Stale
  const stale = opps.filter(o => o.last_touch_date && daysFromNow(o.last_touch_date) < -14);
  if (stale.length) {
    sentences.push(`${stale.length} haven't been touched in over two weeks.`);
  }

  sentences.push('Want me to go through them one by one?');
  return sentences.join(' ');
}

function buildDetailedOpps(opps: any[], totalArr: number, dealLabel: string, timeLabel: string): string {
  const sentences: string[] = [];
  sentences.push(`Let me walk you through your ${opps.length} ${dealLabel} ${opps.length === 1 ? 'opportunity' : 'opportunities'}${timeLabel}, totaling ${dollars(totalArr)}.`);

  for (let i = 0; i < opps.length; i++) {
    const o = opps[i];
    const trans = i < transitions.length ? transitions[i] : 'Then, ';
    let line = `${trans}${o.name}`;

    if (o.arr) line += `, worth ${dollars(o.arr)}`;
    if (o.stage) line += `, currently in ${o.stage}`;
    line += '.';
    sentences.push(line);

    // Close date context
    if (o.close_date) {
      const days = daysFromNow(o.close_date);
      if (days < 0) sentences.push(`This one is ${Math.abs(days)} days past its close date, so it needs attention.`);
      else if (days <= 14) sentences.push(`Closing in ${days} days, so time is tight.`);
      else if (days <= 30) sentences.push(`About ${days} days until close.`);
    }

    // Risk
    if (o.churn_risk === 'high') sentences.push('This deal is flagged as high risk.');
    if (o.last_touch_date && daysFromNow(o.last_touch_date) < -14) {
      sentences.push(`It's been ${Math.abs(daysFromNow(o.last_touch_date))} days since the last touch — that's gone stale.`);
    }

    // Next step
    if (o.next_step) {
      sentences.push(`Next step is to ${o.next_step.charAt(0).toLowerCase()}${o.next_step.slice(1).replace(/\.$/, '')}.`);
    } else {
      sentences.push('No next step defined yet — worth setting one.');
    }
  }

  sentences.push(`That's all ${opps.length}. Let me know if you want to drill into any specific deal.`);
  return sentences.join(' ');
}

// ── Renewals walkthrough ────────────────────────────────────────

export async function queryRenewals(ctx: ToolContext, params: { question?: string; filter?: DaveQueryFilter }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const filter = params.filter || (params.question ? parseFilterFromQuestion(params.question) : { mode: 'summary' as const });
  const bounds = getTimeBounds(filter.timeframe);

  let query = supabase
    .from('renewals')
    .select('id, account_name, arr, renewal_due, health_status, churn_risk, renewal_stage, next_step, notes, updated_at')
    .eq('user_id', userId);

  // Exclude stages that map to closed
  const excludeStages = filter.excludeStatuses || [];
  if (excludeStages.length || filter.mode) {
    // Default: exclude closed-won, closed-lost for "open" queries
    const defaultExcludes = ['Closed Won', 'Closed Lost', 'OOB/Churning'];
    const toExclude = excludeStages.length
      ? excludeStages.map(s => s === 'closed-won' ? 'Closed Won' : s === 'closed-lost' ? 'Closed Lost' : s === 'churned' ? 'OOB/Churning' : s)
      : defaultExcludes;
    for (const s of toExclude) {
      query = query.not('renewal_stage', 'eq', s);
    }
  }

  if (bounds) {
    query = query.gte('renewal_due', bounds.start).lte('renewal_due', bounds.end);
  }

  query = query.order('renewal_due').limit(filter.limit || 30);

  const { data: renewals } = await query;
  if (!renewals?.length) return 'No open renewals matching those filters right now.';

  let sorted = [...renewals];
  if (filter.sortBy === 'arr') sorted.sort((a, b) => Number(b.arr || 0) - Number(a.arr || 0));
  if (filter.riskOnly) {
    sorted = sorted.filter(r => r.churn_risk === 'high' || r.churn_risk === 'medium' || r.health_status === 'red');
  }

  const totalArr = sorted.reduce((s, r) => s + Number(r.arr || 0), 0);
  const timeLabel = filter.timeframe === 'this-quarter' ? ' due this quarter' : filter.timeframe === 'this-month' ? ' due this month' : '';

  if (filter.mode === 'detailed') {
    return buildDetailedRenewals(sorted, totalArr, timeLabel);
  }
  return buildSummaryRenewals(sorted, totalArr, timeLabel);
}

function buildSummaryRenewals(renewals: any[], totalArr: number, timeLabel: string): string {
  const sentences: string[] = [];
  sentences.push(`You have ${renewals.length} open ${renewals.length === 1 ? 'renewal' : 'renewals'}${timeLabel} worth ${dollars(totalArr)}.`);

  // Group by stage
  const byStage: Record<string, any[]> = {};
  for (const r of renewals) {
    const stage = r.renewal_stage || 'No Stage';
    if (!byStage[stage]) byStage[stage] = [];
    byStage[stage].push(r);
  }

  const stageEntries = Object.entries(byStage);
  if (stageEntries.length > 1 && stageEntries.length <= 6) {
    const stageParts = stageEntries.map(([stage, items]) => {
      const total = items.reduce((s: number, r: any) => s + Number(r.arr || 0), 0);
      return `${items.length} in ${stage} at ${dollars(total)}`;
    });
    sentences.push(`By stage, that's ${joinNatural(stageParts)}.`);
  }

  // Risk callout
  const atRisk = renewals.filter(r => r.churn_risk === 'high' || r.health_status === 'red');
  if (atRisk.length) {
    sentences.push(`${atRisk.length} ${atRisk.length === 1 ? 'is' : 'are'} flagged at risk — ${joinNatural(atRisk.slice(0, 3).map(r => r.account_name))}.`);
  }

  // Soonest
  const soonest = renewals.filter(r => r.renewal_due && daysFromNow(r.renewal_due) <= 30 && daysFromNow(r.renewal_due) >= 0);
  if (soonest.length) {
    sentences.push(`${soonest.length} coming due in the next 30 days.`);
  }

  // Biggest
  const top = [...renewals].sort((a, b) => Number(b.arr || 0) - Number(a.arr || 0)).slice(0, 3);
  if (top.length && renewals.length > 3) {
    sentences.push(`Your biggest are ${joinNatural(top.map(r => `${r.account_name} at ${dollars(Number(r.arr || 0))}`))}. `);
  }

  sentences.push('Want me to go through them one by one?');
  return sentences.join(' ');
}

function buildDetailedRenewals(renewals: any[], totalArr: number, timeLabel: string): string {
  const sentences: string[] = [];
  sentences.push(`Let me walk through your ${renewals.length} open renewals${timeLabel}, totaling ${dollars(totalArr)}.`);

  for (let i = 0; i < renewals.length; i++) {
    const r = renewals[i];
    const trans = i < transitions.length ? transitions[i] : 'Then, ';
    let line = `${trans}${r.account_name}, ${dollars(Number(r.arr || 0))}`;
    if (r.renewal_stage) line += ` in ${r.renewal_stage}`;
    if (r.renewal_due) line += `, due ${r.renewal_due}`;
    line += '.';
    sentences.push(line);

    // Days until due
    if (r.renewal_due) {
      const days = daysFromNow(r.renewal_due);
      if (days < 0) sentences.push(`This one is ${Math.abs(days)} days overdue.`);
      else if (days <= 14) sentences.push(`Only ${days} days out, so this needs focus.`);
    }

    // Health / risk
    if (r.health_status === 'red' || r.churn_risk === 'high') {
      sentences.push('This is flagged as at-risk — worth a proactive check-in.');
    } else if (r.churn_risk === 'medium') {
      sentences.push('Moderate risk on this one — keep monitoring.');
    }

    // Next step
    if (r.next_step) {
      sentences.push(`Next step here is to ${r.next_step.charAt(0).toLowerCase()}${r.next_step.slice(1).replace(/\.$/, '')}.`);
    }
  }

  sentences.push(`That covers all ${renewals.length}. Ask me about any specific renewal to dig deeper.`);
  return sentences.join(' ');
}

// ── Tasks walkthrough ───────────────────────────────────────────

export async function queryTasks(ctx: ToolContext, params: { question?: string; filter?: DaveQueryFilter }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const filter = params.filter || (params.question ? parseFilterFromQuestion(params.question) : { mode: 'summary' as const });
  const today = new Date().toISOString().split('T')[0];

  let query = supabase
    .from('tasks')
    .select('id, title, priority, status, due_date, linked_account_id, category, estimated_minutes')
    .eq('user_id', userId)
    .not('status', 'in', '("done","dropped")');

  // Default to today unless broader timeframe requested
  if (!filter.timeframe) {
    query = query.lte('due_date', today);
  } else {
    const bounds = getTimeBounds(filter.timeframe);
    if (bounds) {
      query = query.gte('due_date', bounds.start).lte('due_date', bounds.end);
    }
  }

  query = query.order('priority').order('due_date').limit(filter.limit || 25);

  const { data: tasks } = await query;
  if (!tasks?.length) return 'No tasks matching those filters. Looks like you\'re clear.';

  // Resolve account names
  const accountIds = [...new Set(tasks.map(t => t.linked_account_id).filter(Boolean))] as string[];
  let accountMap: Record<string, string> = {};
  if (accountIds.length) {
    const { data: accts } = await supabase.from('accounts').select('id, name').in('id', accountIds);
    if (accts) accountMap = Object.fromEntries(accts.map(a => [a.id, a.name]));
  }

  const overdue = tasks.filter(t => t.due_date && t.due_date < today);
  const dueToday = tasks.filter(t => t.due_date === today);
  const upcoming = tasks.filter(t => t.due_date && t.due_date > today);
  const p1s = tasks.filter(t => t.priority === 'P1');

  if (filter.mode === 'detailed') {
    return buildDetailedTasks(tasks, overdue, dueToday, upcoming, p1s, accountMap, today);
  }
  return buildSummaryTasks(tasks, overdue, dueToday, upcoming, p1s, accountMap);
}

function buildSummaryTasks(tasks: any[], overdue: any[], dueToday: any[], upcoming: any[], p1s: any[], accountMap: Record<string, string>): string {
  const sentences: string[] = [];

  sentences.push(`You've got ${tasks.length} active ${tasks.length === 1 ? 'task' : 'tasks'} on your plate.`);

  if (overdue.length) {
    sentences.push(`${overdue.length} ${overdue.length === 1 ? 'is' : 'are'} overdue — that's where I'd start.`);
  }
  if (dueToday.length) {
    sentences.push(`${dueToday.length} due today.`);
  }
  if (upcoming.length) {
    sentences.push(`${upcoming.length} coming up.`);
  }

  if (p1s.length) {
    const topNames = p1s.slice(0, 3).map(t => {
      const acct = t.linked_account_id ? accountMap[t.linked_account_id] : null;
      return `${t.title}${acct ? ` for ${acct}` : ''}`;
    });
    sentences.push(`Your top priority ${p1s.length === 1 ? 'item is' : 'items are'} ${joinNatural(topNames)}.`);
  }

  sentences.push('Say "walk me through them" for the full rundown.');
  return sentences.join(' ');
}

function buildDetailedTasks(tasks: any[], overdue: any[], dueToday: any[], upcoming: any[], p1s: any[], accountMap: Record<string, string>, today: string): string {
  const sentences: string[] = [];
  sentences.push(`Let me walk through your ${tasks.length} active tasks.`);

  if (overdue.length) {
    sentences.push(`First, you have ${overdue.length} overdue.`);
    for (const t of overdue.slice(0, 5)) {
      const acct = t.linked_account_id ? accountMap[t.linked_account_id] : null;
      const daysLate = Math.abs(daysFromNow(t.due_date));
      sentences.push(`${t.title}${acct ? ` for ${acct}` : ''} — ${daysLate} days overdue, ${t.priority}.`);
    }
    if (overdue.length > 5) sentences.push(`Plus ${overdue.length - 5} more overdue.`);
  }

  if (dueToday.length) {
    sentences.push(`For today, there ${dueToday.length === 1 ? 'is' : 'are'} ${dueToday.length}.`);
    for (const t of dueToday) {
      const acct = t.linked_account_id ? accountMap[t.linked_account_id] : null;
      sentences.push(`${t.title}${acct ? ` for ${acct}` : ''}, ${t.priority}.`);
    }
  }

  if (upcoming.length) {
    sentences.push(`Coming up you have ${upcoming.length} more.`);
    for (const t of upcoming.slice(0, 5)) {
      const acct = t.linked_account_id ? accountMap[t.linked_account_id] : null;
      sentences.push(`${t.title}${acct ? ` for ${acct}` : ''}, due ${t.due_date}, ${t.priority}.`);
    }
    if (upcoming.length > 5) sentences.push(`And ${upcoming.length - 5} more after that.`);
  }

  if (p1s.length) {
    sentences.push(`If I had to pick where to start, I'd go with ${p1s[0].title} since it's your highest priority.`);
  }

  return sentences.join(' ');
}

// ── Quota / pacing walkthrough ──────────────────────────────────

export async function queryQuota(ctx: ToolContext, params: { question?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const [quotaRes, closedWonRes, activeRes] = await Promise.all([
    supabase.from('quota_targets').select('new_arr_quota, renewal_arr_quota').eq('user_id', userId).limit(1),
    supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
    supabase.from('opportunities').select('name, arr, deal_type, stage, close_date, status').eq('user_id', userId).not('status', 'in', '("closed-won","closed-lost")').order('arr', { ascending: false }),
  ]);

  const quota = quotaRes.data?.[0];
  if (!quota) return 'You don\'t have quota targets set up yet. Head to Settings to configure them.';

  const closedWon = closedWonRes.data || [];
  const active = activeRes.data || [];
  const newClosed = closedWon.filter(o => o.deal_type === 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
  const renewalClosed = closedWon.filter(o => o.deal_type !== 'new-logo').reduce((s, o) => s + (o.arr || 0), 0);
  const totalClosed = newClosed + renewalClosed;
  const totalQuota = (quota.new_arr_quota || 0) + (quota.renewal_arr_quota || 0);
  const pct = totalQuota ? Math.round((totalClosed / totalQuota) * 100) : 0;
  const gap = Math.max(0, totalQuota - totalClosed);
  const activePipeline = active.reduce((s, o) => s + (o.arr || 0), 0);

  const sentences: string[] = [];
  sentences.push(`You're at ${pct}% of quota — ${dollars(totalClosed)} closed against a ${dollars(totalQuota)} target.`);

  if (gap > 0) {
    sentences.push(`That leaves a ${dollars(gap)} gap to close.`);
  } else {
    sentences.push('You\'re at or above quota — accelerators should be kicking in.');
  }

  const newPct = quota.new_arr_quota ? Math.round((newClosed / quota.new_arr_quota) * 100) : 0;
  const renewalPct = quota.renewal_arr_quota ? Math.round((renewalClosed / quota.renewal_arr_quota) * 100) : 0;
  sentences.push(`New logo is at ${newPct}% — ${dollars(newClosed)} of ${dollars(quota.new_arr_quota || 0)}.`);
  sentences.push(`Renewals at ${renewalPct}% — ${dollars(renewalClosed)} of ${dollars(quota.renewal_arr_quota || 0)}.`);

  if (activePipeline > 0) {
    const coverage = gap > 0 ? (activePipeline / gap).toFixed(1) : '∞';
    sentences.push(`You've got ${dollars(activePipeline)} in active pipeline, giving you ${coverage}x coverage on the remaining gap.`);
  }

  // Top deals to close the gap
  if (gap > 0 && active.length) {
    const top = active.slice(0, 3);
    sentences.push(`Your biggest open deals that could close the gap are ${joinNatural(top.map(o => `${o.name} at ${dollars(o.arr || 0)}`))}.`);
  }

  return sentences.join(' ');
}

// ── Pipeline overview walkthrough ───────────────────────────────

export async function queryPipeline(ctx: ToolContext, params: { question?: string; filter?: DaveQueryFilter }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const filter = params.filter || (params.question ? parseFilterFromQuestion(params.question) : { mode: 'summary' as const });

  const { data: opps } = await supabase
    .from('opportunities')
    .select('name, stage, arr, close_date, status, deal_type, next_step, last_touch_date')
    .eq('user_id', userId)
    .not('status', 'in', '("closed-won","closed-lost")')
    .order('arr', { ascending: false })
    .limit(50);

  if (!opps?.length) return 'Your pipeline is empty right now. Time to create some opportunities.';

  const totalArr = opps.reduce((s, o) => s + (o.arr || 0), 0);
  const today = new Date().toISOString().split('T')[0];

  // Group by stage
  const byStage: Record<string, { deals: any[]; arr: number }> = {};
  for (const o of opps) {
    const stage = o.stage || 'No Stage';
    if (!byStage[stage]) byStage[stage] = { deals: [], arr: 0 };
    byStage[stage].deals.push(o);
    byStage[stage].arr += (o.arr || 0);
  }

  const stale = opps.filter(o => o.last_touch_date && o.last_touch_date < new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0]);
  const noNextStep = opps.filter(o => !o.next_step);
  const closingSoon = opps.filter(o => o.close_date && o.close_date <= new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0] && o.close_date >= today);
  const overdue = opps.filter(o => o.close_date && o.close_date < today);

  const sentences: string[] = [];
  sentences.push(`Your pipeline has ${opps.length} active deals worth ${dollars(totalArr)}.`);

  // Stage breakdown
  const stageParts = Object.entries(byStage).map(([stage, info]) => `${info.deals.length} in ${stage} at ${dollars(info.arr)}`);
  if (stageParts.length > 1) {
    sentences.push(`By stage, that's ${joinNatural(stageParts)}.`);
  }

  // Health indicators
  if (closingSoon.length) {
    const csArr = closingSoon.reduce((s, o) => s + (o.arr || 0), 0);
    sentences.push(`${closingSoon.length} deals worth ${dollars(csArr)} are closing in the next 30 days.`);
  }
  if (overdue.length) {
    sentences.push(`${overdue.length} ${overdue.length === 1 ? 'has a' : 'have'} close date that's already passed — those need action.`);
  }
  if (stale.length) {
    sentences.push(`${stale.length} haven't been touched in over 2 weeks.`);
  }
  if (noNextStep.length) {
    sentences.push(`${noNextStep.length} are missing a next step.`);
  }

  // New logo vs renewal split
  const newLogos = opps.filter(o => o.deal_type === 'new-logo');
  const renewalDeals = opps.filter(o => o.deal_type !== 'new-logo');
  if (newLogos.length && renewalDeals.length) {
    sentences.push(`Split is ${newLogos.length} new logo deals at ${dollars(newLogos.reduce((s, o) => s + (o.arr || 0), 0))} and ${renewalDeals.length} renewal at ${dollars(renewalDeals.reduce((s, o) => s + (o.arr || 0), 0))}.`);
  }

  sentences.push('Ask me to dig into any segment — new logo, renewals, stalled, or at risk.');
  return sentences.join(' ');
}

// ── Dashboard overview walkthrough ──────────────────────────────

export async function queryDashboard(ctx: ToolContext, params: { question?: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = new Date().toISOString().split('T')[0];

  const [oppsRes, tasksRes, renewalsRes, journalRes, quotaRes, closedWonRes] = await Promise.all([
    supabase.from('opportunities').select('arr, status, stage, close_date, deal_type').eq('user_id', userId).not('status', 'in', '("closed-won","closed-lost")'),
    supabase.from('tasks').select('id, priority, status, due_date').eq('user_id', userId).not('status', 'in', '("done","dropped")').lte('due_date', today),
    supabase.from('renewals').select('arr, renewal_due, churn_risk, health_status, renewal_stage').eq('user_id', userId).not('renewal_stage', 'in', '("Closed Won","Closed Lost","OOB/Churning")'),
    supabase.from('daily_journal_entries').select('daily_score, dials, meetings_set, opportunities_created, checked_in').eq('user_id', userId).eq('date', today).maybeSingle(),
    supabase.from('quota_targets').select('new_arr_quota, renewal_arr_quota').eq('user_id', userId).limit(1),
    supabase.from('opportunities').select('arr, deal_type').eq('user_id', userId).eq('status', 'closed-won'),
  ]);

  const opps = oppsRes.data || [];
  const tasks = tasksRes.data || [];
  const renewals = renewalsRes.data || [];
  const journal = journalRes.data;
  const quota = quotaRes.data?.[0];
  const closedWon = closedWonRes.data || [];

  const sentences: string[] = [];
  sentences.push('Here\'s the state of things right now.');

  // Pipeline
  if (opps.length) {
    const pipelineArr = opps.reduce((s, o) => s + (o.arr || 0), 0);
    sentences.push(`Your pipeline has ${opps.length} active deals worth ${dollars(pipelineArr)}.`);
  }

  // Quota
  if (quota) {
    const totalQuota = (quota.new_arr_quota || 0) + (quota.renewal_arr_quota || 0);
    const totalClosed = closedWon.reduce((s, o) => s + (o.arr || 0), 0);
    const pct = totalQuota ? Math.round((totalClosed / totalQuota) * 100) : 0;
    sentences.push(`Quota attainment is at ${pct}% — ${dollars(totalClosed)} of ${dollars(totalQuota)}.`);
  }

  // Renewals
  if (renewals.length) {
    const renewalArr = renewals.reduce((s, r) => s + Number(r.arr || 0), 0);
    const atRisk = renewals.filter(r => r.churn_risk === 'high' || r.health_status === 'red');
    sentences.push(`${renewals.length} open renewals at ${dollars(renewalArr)}.`);
    if (atRisk.length) sentences.push(`${atRisk.length} of those are at risk.`);
  }

  // Tasks
  if (tasks.length) {
    const overdue = tasks.filter(t => t.due_date && t.due_date < today);
    const p1s = tasks.filter(t => t.priority === 'P1');
    sentences.push(`You have ${tasks.length} active tasks.`);
    if (overdue.length) sentences.push(`${overdue.length} are overdue.`);
    if (p1s.length) sentences.push(`${p1s.length} high priority.`);
  }

  // Journal
  if (journal) {
    if (journal.checked_in) {
      const parts: string[] = [];
      if (journal.dials) parts.push(`${journal.dials} dials`);
      if (journal.meetings_set) parts.push(`${journal.meetings_set} meetings set`);
      if (journal.daily_score) parts.push(`score of ${journal.daily_score}`);
      if (parts.length) sentences.push(`Today's scorecard so far: ${joinNatural(parts)}.`);
    } else {
      sentences.push('You haven\'t checked in yet today.');
    }
  }

  sentences.push('Ask me about any specific area to go deeper.');
  return sentences.join(' ');
}

// ── Master dispatcher ───────────────────────────────────────────

export { parseFilterFromQuestion };
