/**
 * Dave tool: daily_game_plan
 * Reads the STORED Daily Game Plan from daily_time_blocks table.
 * This is the single source of truth — same data shown on the dashboard.
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

export async function dailyGamePlanWalkthrough(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = todayInAppTz();

  // Read the STORED plan — same data the dashboard displays
  const { data: plan, error } = await supabase
    .from('daily_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', today)
    .maybeSingle();

  if (error) return `Failed to load Daily Game Plan: ${error.message}`;

  if (!plan) {
    return `📋 No Daily Game Plan exists for today (${today}). Open the dashboard and generate one, or say "generate my daily plan" to create it now.`;
  }

  const p = plan as unknown as DailyPlan;
  const blocks = (Array.isArray(p.blocks) ? p.blocks : []) as TimeBlock[];
  const targets = (p.key_metric_targets || {}) as Record<string, number>;
  const completedGoals = new Set(p.completed_goals || []);

  const parts: string[] = [];

  // ── Header ──
  parts.push(`📋 DAILY GAME PLAN — ${today}`);

  // ── Strategy overview ──
  if (p.ai_reasoning) {
    parts.push(`\n💡 Strategy: ${p.ai_reasoning}`);
  }

  // ── Structure summary ──
  const focusHrs = p.focus_hours_available ?? 0;
  const meetingHrs = p.meeting_load_hours ?? 0;
  parts.push(`\n⏱️ ${focusHrs.toFixed(1)}h focus time, ${meetingHrs.toFixed(1)}h meetings`);

  // ── Targets ──
  if (Object.keys(targets).length > 0) {
    const targetParts: string[] = [];
    if (targets.dials) targetParts.push(`${targets.dials} dials`);
    if (targets.conversations) targetParts.push(`${targets.conversations} convos`);
    if (targets.accounts_researched) targetParts.push(`${targets.accounts_researched} accounts researched`);
    if (targets.contacts_prepped) targetParts.push(`${targets.contacts_prepped} contacts prepped`);
    if (targetParts.length) parts.push(`🎯 Today's targets: ${targetParts.join(', ')}`);
  }

  // ── Time blocks walkthrough ──
  if (blocks.length > 0) {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    // Find what's current/next
    let currentBlock: TimeBlock | null = null;
    let nextBlock: TimeBlock | null = null;

    for (const b of blocks) {
      const [sh, sm] = b.start_time.split(':').map(Number);
      const [eh, em] = b.end_time.split(':').map(Number);
      const startMin = sh * 60 + sm;
      const endMin = eh * 60 + em;

      if (currentMinutes >= startMin && currentMinutes < endMin) {
        currentBlock = b;
      } else if (currentMinutes < startMin && !nextBlock) {
        nextBlock = b;
      }
    }

    // Current/next focus
    if (currentBlock) {
      parts.push(`\n🔴 RIGHT NOW: ${currentBlock.label} (${formatBlockTime(currentBlock.start_time)}–${formatBlockTime(currentBlock.end_time)})`);
      if (currentBlock.goals?.length) {
        parts.push(`   Goals: ${currentBlock.goals.join('; ')}`);
      }
    }
    if (nextBlock) {
      const [nh, nm] = nextBlock.start_time.split(':').map(Number);
      const minsUntil = (nh * 60 + nm) - currentMinutes;
      parts.push(`\n⏭️ UP NEXT: ${nextBlock.label} at ${formatBlockTime(nextBlock.start_time)} (in ${minsUntil} min)`);
    }

    // Categorized summary
    const meetings = blocks.filter(b => b.type === 'meeting');
    const prospecting = blocks.filter(b => b.type === 'prospecting');
    const prepBlocks = blocks.filter(b => b.type === 'prep');
    const rustBuster = prospecting.filter(b => b.label.toLowerCase().includes('rust'));

    if (meetings.length) {
      parts.push(`\n📅 Meetings (${meetings.length}):`);
      for (const m of meetings) {
        parts.push(`  • ${formatBlockTime(m.start_time)} — ${m.label}`);
      }
    }

    if (rustBuster.length) {
      parts.push(`\n🔥 Rust Buster: ${formatBlockTime(rustBuster[0].start_time)} — ${rustBuster[0].label}`);
    }

    if (prospecting.length) {
      const totalProspectingMin = prospecting.reduce((s, b) => s + blockDurationMin(b), 0);
      const nonRust = prospecting.filter(b => !b.label.toLowerCase().includes('rust'));
      parts.push(`\n📞 Prospecting: ${nonRust.length} block${nonRust.length !== 1 ? 's' : ''} (${Math.round(totalProspectingMin / 60 * 10) / 10}h total)`);
      for (const b of nonRust.slice(0, 3)) {
        parts.push(`  • ${formatBlockTime(b.start_time)} — ${b.label}`);
      }
    }

    if (prepBlocks.length) {
      parts.push(`\n📚 Prep: ${prepBlocks.length} block${prepBlocks.length !== 1 ? 's' : ''}`);
      for (const b of prepBlocks.slice(0, 2)) {
        parts.push(`  • ${formatBlockTime(b.start_time)} — ${b.label}`);
      }
    }

    // Full schedule (compact)
    parts.push(`\n📝 Full schedule (${blocks.length} blocks):`);
    for (const b of blocks) {
      const dur = blockDurationMin(b);
      const check = b.goals?.some((_, gi) => completedGoals.has(`${blocks.indexOf(b)}-${gi}`)) ? '✅' : '⬜';
      parts.push(`  ${check} ${formatBlockTime(b.start_time)}–${formatBlockTime(b.end_time)} (${dur}m) ${b.label}`);
    }
  }

  // ── First focus recommendation ──
  const firstActionBlock = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
  if (firstActionBlock) {
    parts.push(`\n🎯 Start here: ${firstActionBlock.label} at ${formatBlockTime(firstActionBlock.start_time)}`);
    if (firstActionBlock.goals?.length) {
      parts.push(`   → ${firstActionBlock.goals[0]}`);
    }
  }

  return parts.join('\n');
}

/**
 * Answer specific questions about the daily plan.
 */
export async function queryDailyPlan(ctx: ToolContext, params: { question: string }): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated';

  const today = todayInAppTz();
  const { data: plan } = await supabase
    .from('daily_time_blocks')
    .select('blocks, key_metric_targets, ai_reasoning, focus_hours_available, meeting_load_hours')
    .eq('user_id', userId)
    .eq('plan_date', today)
    .maybeSingle();

  if (!plan) return `No Daily Game Plan for today. Generate one from the dashboard first.`;

  const blocks = (Array.isArray(plan.blocks) ? plan.blocks : []) as unknown as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const q = params.question.toLowerCase();

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

  // Default: return strategy + targets
  return `Strategy: ${plan.ai_reasoning || 'No strategy notes'}\nTargets: ${JSON.stringify(targets)}\nFocus hours: ${plan.focus_hours_available || 0}h, Meeting load: ${plan.meeting_load_hours || 0}h`;
}
