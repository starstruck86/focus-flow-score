import type { NavigateFunction } from 'react-router-dom';

export type AskCopilot = (question: string, mode: string) => void;

export interface ToolContext {
  navigate: NavigateFunction;
  askCopilot: AskCopilot;
  getUserId: () => Promise<string | null>;
}

/** Each domain module returns a partial tool map */
export type ToolMap = Record<string, (...args: any[]) => any>;

// ── Field Mappings ──────────────────────────────────────────────

export const ACCOUNT_FIELDS: Record<string, string> = {
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

export const OPP_FIELDS: Record<string, string> = {
  stage: 'stage',
  'next step': 'next_step',
  next_step: 'next_step',
  'close date': 'close_date',
  close_date: 'close_date',
  notes: 'notes',
  status: 'status',
  arr: 'arr',
};

export const MEDDICC_FIELDS: Record<string, string> = {
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

export const METRIC_MAP: Record<string, string> = {
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

// ── Helpers ──────────────────────────────────────────────────────

export function parseDueDate(input: string): string {
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

  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;

  return now.toISOString().split('T')[0];
}

export function parseTime(input: string): string | null {
  const match = input.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i);
  if (!match) return null;
  let hours = parseInt(match[1]);
  const minutes = parseInt(match[2] || '0');
  const ampm = match[3]?.toLowerCase();
  if (ampm === 'pm' && hours < 12) hours += 12;
  if (ampm === 'am' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function nextBusinessDay(daysAhead: number): Date {
  const d = new Date();
  let added = 0;
  while (added < daysAhead) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d;
}
