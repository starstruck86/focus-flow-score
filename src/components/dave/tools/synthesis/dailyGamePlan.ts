/**
 * Dave tool: daily_game_plan
 * Reads the STORED Daily Game Plan from daily_time_blocks table.
 * Two modes: summary (fast ~60s) and detailed (block-by-block guided).
 * Single source of truth — same data shown on the dashboard.
 */
import { supabase } from '@/integrations/supabase/client';
import { formatTimeETLabel, todayInAppTz } from '@/lib/timeFormat';
import type { ToolContext } from '../../toolTypes';

interface TimeBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: string;
  workstream?: string;
  goals: string[];
  reasoning: string;
  actual_dials?: number;
  actual_emails?: number;
  linked_accounts?: { id: string; name: string }[];
}

interface DailyPlan {
  id: string;
  plan_date: string;
  blocks: TimeBlock[];
  meeting_load_hours: number | null;
  focus_hours_available: number | null;
  ai_reasoning: string | null;
  key_metric_targets: Record<string, number> | null;
  completed_goals: string[] | null;
}

// ── Shared helpers ──

function formatBlockTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix} ET`;
}

function blockDurationMin(block: TimeBlock): number {
  const [sh, sm] = block.start_time.split(':').map(Number);
  const [eh, em] = block.end_time.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function getCurrentMinutesET(): number {
  const etNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  return etNow.getHours() * 60 + etNow.getMinutes();
}

function findCurrentAndNext(blocks: TimeBlock[]): { current: TimeBlock | null; next: TimeBlock | null } {
  const now = getCurrentMinutesET();
  let current: TimeBlock | null = null;
  let next: TimeBlock | null = null;
  for (const b of blocks) {
    const [sh, sm] = b.start_time.split(':').map(Number);
    const [eh, em] = b.end_time.split(':').map(Number);
    if (now >= sh * 60 + sm && now < eh * 60 + em) current = b;
    else if (now < sh * 60 + sm && !next) next = b;
  }
  return { current, next };
}

async function fetchTodayPlan(ctx: ToolContext): Promise<{ plan: DailyPlan | null; error: string | null }> {
  const userId = await ctx.getUserId();
  if (!userId) return { plan: null, error: 'Not authenticated' };

  const today = todayInAppTz();
  const { data, error } = await supabase
    .from('daily_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', today)
    .maybeSingle();

  if (error) return { plan: null, error: `Failed to load Daily Game Plan: ${error.message}` };
  if (!data) return { plan: null, error: `📋 No Daily Game Plan exists for today (${today}). Open the dashboard and generate one, or say "generate my daily plan."` };

  const p = data as unknown as DailyPlan;
  p.blocks = Array.isArray(p.blocks) ? p.blocks : [];
  return { plan: p, error: null };
}

// ── Summary mode (~60 seconds spoken) ──

export async function dailyGamePlanSummary(ctx: ToolContext): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error!;

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const parts: string[] = [];

  parts.push(`📋 DAILY GAME PLAN — ${plan.plan_date}`);

  // Strategy
  if (plan.ai_reasoning) parts.push(`\n💡 Strategy: ${plan.ai_reasoning}`);

  // Structure
  const focusHrs = plan.focus_hours_available ?? 0;
  const meetingHrs = plan.meeting_load_hours ?? 0;
  parts.push(`\n⏱️ ${focusHrs.toFixed(1)}h focus time, ${meetingHrs.toFixed(1)}h meetings`);

  // Targets
  const targetParts: string[] = [];
  if (targets.dials) targetParts.push(`${targets.dials} dials`);
  if (targets.conversations) targetParts.push(`${targets.conversations} convos`);
  if (targets.accounts_researched) targetParts.push(`${targets.accounts_researched} accounts researched`);
  if (targets.contacts_prepped) targetParts.push(`${targets.contacts_prepped} contacts prepped`);
  if (targetParts.length) parts.push(`🎯 Targets: ${targetParts.join(', ')}`);

  // Current / next
  if (blocks.length) {
    const { current, next } = findCurrentAndNext(blocks);
    if (current) {
      parts.push(`\n🔴 NOW: ${current.label} (${formatBlockTime(current.start_time)}–${formatBlockTime(current.end_time)})`);
    }
    if (next) {
      const now = getCurrentMinutesET();
      const [nh, nm] = next.start_time.split(':').map(Number);
      parts.push(`⏭️ NEXT: ${next.label} at ${formatBlockTime(next.start_time)} (in ${(nh * 60 + nm) - now} min)`);
    }

    // Key meetings
    const meetings = blocks.filter(b => b.type === 'meeting');
    if (meetings.length) {
      parts.push(`\n📅 ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''}:`);
      for (const m of meetings) parts.push(`  • ${formatBlockTime(m.start_time)} — ${m.label}`);
    }

    // Rust buster
    const rust = blocks.filter(b => b.label.toLowerCase().includes('rust'));
    if (rust.length) parts.push(`\n🔥 Rust Buster at ${formatBlockTime(rust[0].start_time)}`);
  }

  // First focus
  const first = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
  if (first) {
    parts.push(`\n🎯 Start here: ${first.label} at ${formatBlockTime(first.start_time)}`);
    if (first.goals?.length) parts.push(`   → ${first.goals[0]}`);
  }

  return parts.join('\n');
}

// ── Detailed step-by-step mode ──

export async function dailyGamePlanDetailed(ctx: ToolContext): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error!;

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const completedGoals = new Set(plan.completed_goals || []);
  const parts: string[] = [];

  parts.push(`📋 DAILY GAME PLAN — DETAILED WALKTHROUGH — ${plan.plan_date}`);

  // Strategy context
  if (plan.ai_reasoning) parts.push(`\n💡 Today's strategy: ${plan.ai_reasoning}`);

  // Day shape
  const focusHrs = plan.focus_hours_available ?? 0;
  const meetingHrs = plan.meeting_load_hours ?? 0;
  parts.push(`\n⏱️ Day shape: ${focusHrs.toFixed(1)}h focus, ${meetingHrs.toFixed(1)}h meetings, ${blocks.length} blocks total`);

  // Targets
  const targetParts: string[] = [];
  if (targets.dials) targetParts.push(`${targets.dials} dials`);
  if (targets.conversations) targetParts.push(`${targets.conversations} conversations`);
  if (targets.accounts_researched) targetParts.push(`${targets.accounts_researched} accounts researched`);
  if (targets.contacts_prepped) targetParts.push(`${targets.contacts_prepped} contacts prepped`);
  if (targetParts.length) parts.push(`🎯 Daily targets: ${targetParts.join(', ')}`);

  // Current position
  const { current, next } = findCurrentAndNext(blocks);
  if (current) {
    parts.push(`\n🔴 You are currently in: ${current.label} (${formatBlockTime(current.start_time)}–${formatBlockTime(current.end_time)})`);
  }

  // Block-by-block walkthrough
  parts.push(`\n${'═'.repeat(40)}`);
  parts.push(`BLOCK-BY-BLOCK WALKTHROUGH`);
  parts.push(`${'═'.repeat(40)}`);

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const dur = blockDurationMin(b);
    const isCurrent = b === current;
    const marker = isCurrent ? '🔴' : '⬜';
    const hasCompleted = b.goals?.some((_, gi) => completedGoals.has(`${i}-${gi}`));
    const statusTag = hasCompleted ? ' ✅' : '';

    parts.push(`\n${marker} Block ${i + 1}: ${b.label}${statusTag}`);
    parts.push(`   ⏰ ${formatBlockTime(b.start_time)} → ${formatBlockTime(b.end_time)} (${dur} min)`);
    parts.push(`   📂 Type: ${b.type}${b.workstream ? ` — ${b.workstream}` : ''}`);

    // Purpose
    if (b.reasoning) {
      parts.push(`   💡 Why: ${b.reasoning}`);
    }

    // Goals = what success looks like
    if (b.goals?.length) {
      parts.push(`   ✅ Success looks like:`);
      for (const g of b.goals) {
        const goalDone = completedGoals.has(`${i}-${b.goals.indexOf(g)}`);
        parts.push(`      ${goalDone ? '✓' : '○'} ${g}`);
      }
    }

    // Linked accounts
    if (b.linked_accounts?.length) {
      parts.push(`   🏢 Accounts: ${b.linked_accounts.map(a => a.name).join(', ')}`);
    }

    // Actuals (if tracking has started)
    if (b.actual_dials || b.actual_emails) {
      const actuals: string[] = [];
      if (b.actual_dials) actuals.push(`${b.actual_dials} dials`);
      if (b.actual_emails) actuals.push(`${b.actual_emails} emails`);
      parts.push(`   📊 Progress: ${actuals.join(', ')}`);
    }
  }

  // Wrap-up
  parts.push(`\n${'═'.repeat(40)}`);

  // What to do right now
  if (current) {
    parts.push(`\n🎯 Focus now: ${current.label}`);
    if (current.goals?.length) parts.push(`   → ${current.goals[0]}`);
  } else if (next) {
    const now = getCurrentMinutesET();
    const [nh, nm] = next.start_time.split(':').map(Number);
    parts.push(`\n🎯 Next up: ${next.label} at ${formatBlockTime(next.start_time)} (in ${(nh * 60 + nm) - now} min)`);
    if (next.goals?.length) parts.push(`   → ${next.goals[0]}`);
  } else {
    parts.push(`\n✅ All blocks complete or past. Great work today.`);
  }

  parts.push(`\nAsk me about any specific block for more detail.`);

  return parts.join('\n');
}

// ── Legacy alias — defaults to summary ──

export async function dailyGamePlanWalkthrough(ctx: ToolContext): Promise<string> {
  return dailyGamePlanSummary(ctx);
}

/**
 * Answer specific questions about the daily plan.
 */
export async function queryDailyPlan(ctx: ToolContext, params: { question: string }): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error || 'No Daily Game Plan for today.';

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const q = params.question.toLowerCase();

  // Block-specific follow-up: "tell me about block 3" or "block 3"
  const blockNumMatch = q.match(/block\s*(\d+)/);
  if (blockNumMatch) {
    const idx = parseInt(blockNumMatch[1], 10) - 1;
    if (idx >= 0 && idx < blocks.length) {
      const b = blocks[idx];
      const dur = blockDurationMin(b);
      const lines = [
        `Block ${idx + 1}: ${b.label}`,
        `⏰ ${formatBlockTime(b.start_time)} → ${formatBlockTime(b.end_time)} (${dur} min)`,
        `Type: ${b.type}${b.workstream ? ` — ${b.workstream}` : ''}`,
      ];
      if (b.reasoning) lines.push(`Why: ${b.reasoning}`);
      if (b.goals?.length) lines.push(`Goals: ${b.goals.join('; ')}`);
      if (b.linked_accounts?.length) lines.push(`Accounts: ${b.linked_accounts.map(a => a.name).join(', ')}`);
      return lines.join('\n');
    }
  }

  // Time blocks question
  if (q.includes('time block') || q.includes('schedule') || q.includes('blocks')) {
    return blocks.map(b => `${formatBlockTime(b.start_time)}–${formatBlockTime(b.end_time)}: ${b.label} (${b.type})`).join('\n');
  }

  // Account research question
  if (q.includes('research') || q.includes('account')) {
    const target = targets.accounts_researched || 0;
    const prepBlocks = blocks.filter(b => b.type === 'prep' || b.type === 'research');
    return `Today's target: ${target} accounts researched.\n${prepBlocks.length} prep/research blocks:\n${prepBlocks.map(b => `• ${formatBlockTime(b.start_time)} — ${b.label}: ${b.goals?.join('; ') || 'No specific goals'}`).join('\n')}`;
  }

  // Rust buster question
  if (q.includes('rust') || q.includes('warm up') || q.includes('warmup')) {
    const rust = blocks.filter(b => b.label.toLowerCase().includes('rust'));
    if (!rust.length) return 'No Rust Buster block in today\'s plan.';
    return rust.map(b => `🔥 ${formatBlockTime(b.start_time)}–${formatBlockTime(b.end_time)}: ${b.label}\nGoals: ${b.goals?.join('; ') || 'Warm up dials'}`).join('\n');
  }

  // Prospecting/dials question
  if (q.includes('prospect') || q.includes('dial') || q.includes('call')) {
    const prospBlocks = blocks.filter(b => b.type === 'prospecting');
    const totalMin = prospBlocks.reduce((s, b) => s + blockDurationMin(b), 0);
    return `Today's dial target: ${targets.dials || '?'}\n${prospBlocks.length} prospecting blocks (${Math.round(totalMin / 60 * 10) / 10}h):\n${prospBlocks.map(b => `• ${formatBlockTime(b.start_time)} — ${b.label}: ${b.goals?.join('; ')}`).join('\n')}`;
  }

  // Focus question
  if (q.includes('focus') || q.includes('first') || q.includes('start')) {
    const first = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
    if (!first) return 'All blocks are meetings today.';
    return `🎯 Start with: ${first.label} at ${formatBlockTime(first.start_time)}\n→ ${first.goals?.[0] || first.reasoning}`;
  }

  // Meeting question
  if (q.includes('meeting')) {
    const meetings = blocks.filter(b => b.type === 'meeting');
    return `${meetings.length} meetings today (${plan.meeting_load_hours || 0}h):\n${meetings.map(b => `• ${formatBlockTime(b.start_time)}–${formatBlockTime(b.end_time)}: ${b.label}`).join('\n')}`;
  }

  // Default
  return `Strategy: ${plan.ai_reasoning || 'No strategy notes'}\nTargets: ${JSON.stringify(targets)}\nFocus hours: ${plan.focus_hours_available || 0}h, Meeting load: ${plan.meeting_load_hours || 0}h`;
}
