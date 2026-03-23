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

export async function executionNext(ctx: ToolContext): Promise<string> {
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

  // 3. Choose stage to fix (from diagnosis or infer from work block)
  const stage: FunnelStage = diagnosis?.stage
    || (workBlock === 'prospecting' ? 'dial_to_connect'
      : workBlock === 'calls' ? 'connect_to_meeting'
      : 'meeting_to_opp');

  // 4. Find target account
  const account = await findTargetAccount(userId, stage);
  if (!account) {
    return workBlock === 'prospecting'
      ? 'No target accounts available. Say "suggest next accounts" to start sourcing.'
      : 'No accounts match the current focus. Add target accounts first.';
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

  // 8. Format output
  const BLOCK_LABELS: Record<WorkBlock, string> = {
    prospecting: 'Prospecting Block',
    calls: 'Call Block',
    meetings: 'Meeting Prep',
    admin: 'Admin',
    unknown: 'Current Focus',
  };

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

  return lines.join('\n');
}
