/**
 * Execution Binding — resolves bottleneck fixes and strategy
 * recommendations into a single, concrete next action tied to
 * real accounts, contacts, and current work context.
 *
 * Output contract: exactly ONE action, with account, contact,
 * script/phrasing, and rationale.
 */
import { supabase } from '@/integrations/supabase/client';
import type { ToolContext } from '../../toolTypes';
import {
  getPipelineForecast,
  type FunnelStage,
  type FunnelDiagnosis,
  type BottleneckFix,
} from '@/data/pipeline-forecast';

// ── Types ───────────────────────────────────────────────────────

interface BoundAction {
  accountName: string;
  accountId: string;
  contactName?: string;
  contactTitle?: string;
  action: string;
  script?: string;
  rationale: string;
  workContext: string;
}

type WorkBlock = 'prospecting' | 'calls' | 'meetings' | 'admin' | 'unknown';

// ── Detect current work block ───────────────────────────────────

async function detectWorkBlock(userId: string): Promise<WorkBlock> {
  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const nowIso = now.toISOString();

  // Check time blocks for today
  const { data: plans } = await supabase
    .from('daily_time_blocks')
    .select('blocks')
    .eq('user_id', userId)
    .eq('plan_date', todayStr)
    .limit(1);

  if (plans?.length) {
    const blocks = (plans[0].blocks || []) as Array<{
      label?: string;
      type?: string;
      start?: string;
      end?: string;
    }>;

    for (const b of blocks) {
      const start = b.start ? new Date(b.start) : null;
      const end = b.end ? new Date(b.end) : null;
      if (start && end && now >= start && now <= end) {
        const label = (b.label || b.type || '').toLowerCase();
        if (label.includes('prospect') || label.includes('hunter') || label.includes('power hour'))
          return 'prospecting';
        if (label.includes('call') || label.includes('dial'))
          return 'calls';
        if (label.includes('meeting') || label.includes('prep'))
          return 'meetings';
        if (label.includes('admin'))
          return 'admin';
      }
    }
  }

  // Check if there's a meeting soon (within 30 min)
  const thirtyMin = new Date(now.getTime() + 30 * 60_000).toISOString();
  const { data: upcoming } = await supabase
    .from('calendar_events')
    .select('id')
    .eq('user_id', userId)
    .gte('start_time', nowIso)
    .lte('start_time', thirtyMin)
    .limit(1);

  if (upcoming?.length) return 'meetings';

  // Default: infer from time of day
  const hour = now.getHours();
  if (hour < 10) return 'prospecting'; // morning = hunt
  if (hour < 12) return 'calls';
  return 'unknown';
}

// ── Find best account for the bottleneck stage ──────────────────

async function findTargetAccount(
  userId: string,
  stage: FunnelStage,
): Promise<{ id: string; name: string; tier: string | null; icpScore: number | null } | null> {
  if (stage === 'dial_to_connect' || stage === 'connect_to_meeting') {
    // Need accounts in active outreach or ready to work
    const { data } = await supabase
      .from('accounts')
      .select('id, name, tier, icp_fit_score, outreach_status, priority_score')
      .eq('user_id', userId)
      .in('outreach_status', ['in-progress', 'working', 'not-started'])
      .order('priority_score', { ascending: false })
      .limit(1);

    if (data?.length) {
      return { id: data[0].id, name: data[0].name, tier: data[0].tier, icpScore: data[0].icp_fit_score };
    }

    // Fallback: any account with high ICP
    const { data: fallback } = await supabase
      .from('accounts')
      .select('id, name, tier, icp_fit_score')
      .eq('user_id', userId)
      .order('icp_fit_score', { ascending: false })
      .limit(1);

    return fallback?.length
      ? { id: fallback[0].id, name: fallback[0].name, tier: fallback[0].tier, icpScore: fallback[0].icp_fit_score }
      : null;
  }

  // meeting_to_opp: find accounts with recent meetings but no opp
  const { data: accts } = await supabase
    .from('accounts')
    .select('id, name, tier, icp_fit_score, account_status')
    .eq('user_id', userId)
    .in('account_status', ['meeting booked', 'meeting held', 'researching'])
    .order('icp_fit_score', { ascending: false })
    .limit(1);

  return accts?.length
    ? { id: accts[0].id, name: accts[0].name, tier: accts[0].tier, icpScore: accts[0].icp_fit_score }
    : null;
}

// ── Find best contact for the account ───────────────────────────

async function findTargetContact(
  userId: string,
  accountId: string,
): Promise<{ name: string; title: string | null } | null> {
  const { data } = await supabase
    .from('contacts')
    .select('name, title, influence_level, last_touch_date')
    .eq('user_id', userId)
    .eq('account_id', accountId)
    .order('influence_level', { ascending: false })
    .limit(1);

  return data?.length ? { name: data[0].name, title: data[0].title } : null;
}

// ── Build script for the fix ────────────────────────────────────

function buildScript(
  fix: BottleneckFix,
  accountName: string,
  contactName?: string,
  contactTitle?: string,
): string {
  // Personalize the fix example with real names
  let script = fix.example || fix.detail;
  script = script.replace(/\[Company\]/gi, accountName);
  script = script.replace(/\[account\]/gi, accountName);
  if (contactName) {
    script = script.replace(/\[contact\]/gi, contactName);
    script = script.replace(/\[name\]/gi, contactName);
  }
  if (contactTitle) {
    script = script.replace(/\[title\]/gi, contactTitle);
  }
  return script;
}

// ── Main tool: execution_next ───────────────────────────────────

/** Where to execute the action — inferred from stage */
function inferExternalSystem(stage: FunnelStage): string {
  if (stage === 'dial_to_connect' || stage === 'connect_to_meeting') return 'Outreach / Salesloft';
  return 'Salesforce';
}

/** Suggest where in the external tool to go */
function externalHint(stage: FunnelStage, accountName: string): string {
  if (stage === 'dial_to_connect') return `Open ${accountName}'s cadence in Outreach/Salesloft and dial.`;
  if (stage === 'connect_to_meeting') return `Find ${accountName} in Outreach/Salesloft — use the opener below.`;
  return `Open ${accountName} in Salesforce and log discovery notes.`;
}

export interface ExecutionNextResult {
  formatted: string;
  actionId: string;
  accountId: string;
  accountName: string;
  contactName?: string;
  contactTitle?: string;
  stage: string;
  script?: string;
  externalSystem: string;
}

export async function executionNext(ctx: ToolContext, opts?: { liveMode?: boolean }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  // 1. Get forecast and diagnosis
  let diagnosis: FunnelDiagnosis | null = null;
  try {
    const forecast = await getPipelineForecast(userId);
    diagnosis = forecast.funnelDiagnosis;
  } catch { /* proceed without diagnosis */ }

  // 2. Detect current work block
  const workBlock = await detectWorkBlock(userId);

  // Auto-engage live mode during execution blocks
  const liveMode = opts?.liveMode ?? (workBlock === 'prospecting' || workBlock === 'calls');

  // 3. Choose stage to fix (from diagnosis or infer from work block)
  const stage: FunnelStage = diagnosis?.stage
    || (workBlock === 'prospecting' ? 'dial_to_connect'
      : workBlock === 'calls' ? 'connect_to_meeting'
      : 'meeting_to_opp');

  // 4. Find target account
  const account = await findTargetAccount(userId, stage);
  if (!account) {
    return workBlock === 'prospecting'
      ? 'No target accounts. Say "suggest next accounts".'
      : 'No accounts match current focus.';
  }

  // 5. Find contact
  const contact = await findTargetContact(userId, account.id);

  // 6. Pick the top fix
  const fix = diagnosis?.fixes?.[0] || {
    action: stage === 'dial_to_connect' ? 'Make the call'
      : stage === 'connect_to_meeting' ? 'Open with a pain-based hook'
      : 'Run deep discovery',
    detail: stage === 'dial_to_connect' ? 'Dial the highest-priority contact at this account.'
      : stage === 'connect_to_meeting' ? 'Lead with a specific business challenge, not your product.'
      : 'Uncover the metric, the pain, and the decision process before any pitch.',
    example: stage === 'connect_to_meeting'
      ? `"Hi ${contact?.name || '[contact]'}, I noticed ${account.name} is [trigger]. Teams in that phase often struggle with [pain] — is that on your radar?"`
      : undefined,
  };

  // 7. Build personalized script
  const script = buildScript(fix, account.name, contact?.name, contact?.title);
  const actionId = `exec-${stage}-${account.id}`;

  // ── LIVE MODE: 3-5 lines max ──────────────────────────────────
  if (liveMode) {
    const who = contact
      ? `${contact.name}${contact.title ? ` (${contact.title})` : ''} @ ${account.name}`
      : account.name;
    const reason = diagnosis
      ? `${diagnosis.label} at ${Math.round(diagnosis.rate * 100)}%`
      : 'top priority';

    const lines: string[] = [];
    lines.push(`🎯 **${fix.action}** → ${who}`);
    lines.push(`_${reason}_`);
    if (fix.example || stage === 'connect_to_meeting') {
      lines.push(`> ${script}`);
    }
    lines.push(`[action_id: ${actionId}] [live_mode]`);
    return lines.join('\n');
  }

  // ── FULL MODE: detailed output ────────────────────────────────
  const BLOCK_LABELS: Record<WorkBlock, string> = {
    prospecting: 'Prospecting Block',
    calls: 'Call Block',
    meetings: 'Meeting Prep',
    admin: 'Admin',
    unknown: 'Current Focus',
  };

  const extSystem = inferExternalSystem(stage);
  const hint = externalHint(stage, account.name);

  const lines: string[] = [];
  lines.push(`🎯 **${fix.action}**`);
  lines.push('');
  lines.push(`**Account:** ${account.name}${account.icpScore ? ` (ICP ${account.icpScore}%)` : ''}`);
  if (contact) {
    lines.push(`**Contact:** ${contact.name}${contact.title ? ` — ${contact.title}` : ''}`);
  } else {
    lines.push('**Contact:** None found — say "discover contacts for ' + account.name + '" first');
  }
  lines.push(`**Context:** ${BLOCK_LABELS[workBlock]}`);
  lines.push(`**Execute in:** ${extSystem}`);
  lines.push('');

  // External system guidance
  lines.push(`📍 ${hint}`);
  lines.push('');

  if (diagnosis) {
    lines.push(`**Why this:** Your ${diagnosis.label} rate is ${Math.round(diagnosis.rate * 100)}% (benchmark: ${Math.round(diagnosis.benchmark * 100)}%). This action targets that gap.`);
  } else {
    lines.push(`**Why this:** Highest-priority account for your current work block.`);
  }

  lines.push('');
  lines.push('**Script:**');
  lines.push(`> ${script}`);

  if (!contact && (stage === 'connect_to_meeting' || stage === 'dial_to_connect')) {
    lines.push('\n_Tip: Add contacts first for a personalized opener._');
  }

  lines.push('');
  lines.push(`_When done, say "done", "blocked", "skip", or "snooze" — I'll keep you moving._`);
  lines.push(`[action_id: ${actionId}]`);

  return lines.join('\n');
}

// ── Action resolution tools (lag-tolerant) ──────────────────────

type ActionOutcome = 'done' | 'blocked' | 'skipped' | 'snoozed';

function recordOutcome(actionId: string, outcome: ActionOutcome, extra?: Record<string, any>) {
  try {
    const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
    records.push({ actionId, outcome, timestamp: Date.now(), ...extra });
    localStorage.setItem('jarvis-action-memory', JSON.stringify(records.slice(-300)));
  } catch {}
}

/** User confirms they completed the action in an external system */
export async function confirmExecution(params: { actionId: string }): Promise<string> {
  recordOutcome(params.actionId, 'done');
  return 'Confirmed ✓ — ask for "next action" to keep moving.';
}

/** User is blocked on this action */
export async function blockExecution(params: { actionId: string; reason?: string }): Promise<string> {
  recordOutcome(params.actionId, 'blocked', { blockReason: params.reason });
  return `Blocked${params.reason ? ` (${params.reason})` : ''} — moving past this. Ask for "next action".`;
}

/** User skips — not now */
export async function skipExecution(params: { actionId: string; reason?: string }): Promise<string> {
  recordOutcome(params.actionId, 'skipped');
  return 'Skipped — this will be deprioritized. Ask for "next action" to continue.';
}

/** User wants to come back to this later */
export async function snoozeExecution(params: { actionId: string; minutes?: number }): Promise<string> {
  const mins = params.minutes || 30;
  recordOutcome(params.actionId, 'snoozed', { snoozeUntil: Date.now() + mins * 60_000 });
  return `Snoozed for ${mins} min — I'll resurface this later. Ask for "next action" now.`;
}

/** Reconcile a past recommendation with delayed data (transcript/CRM sync) */
export async function reconcileExecution(params: { actionId: string; source: string }): Promise<string> {
  try {
    const records = JSON.parse(localStorage.getItem('jarvis-action-memory') || '[]');
    const idx = records.findIndex((r: any) => r.actionId === params.actionId && !r.reconciled);
    if (idx >= 0) {
      records[idx].reconciled = true;
      records[idx].reconciledAt = Date.now();
      records[idx].reconciledSource = params.source;
      localStorage.setItem('jarvis-action-memory', JSON.stringify(records));
      return `Reconciled with ${params.source} data — learning updated.`;
    }
  } catch {}
  return 'No matching unreconciled action found.';
}
