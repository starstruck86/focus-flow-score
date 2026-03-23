/**
 * Dave tool: daily_game_plan
 * Reads the STORED Daily Game Plan from daily_time_blocks table.
 * Two modes: summary (fast ~60s) and detailed (block-by-block guided).
 * Voice-first conversational output — optimized for spoken delivery.
 */
import { supabase } from '@/integrations/supabase/client';
import { todayInAppTz } from '@/lib/timeFormat';
import { startOfWeek, format } from 'date-fns';
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

function spokenTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  if (m === 0) return `${hour} ${suffix}`;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
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

  if (error) return { plan: null, error: `I couldn't pull up your plan right now. ${error.message}` };
  if (!data) return { plan: null, error: `You don't have a Daily Game Plan for today yet. Head to the dashboard and generate one, or just say "generate my daily plan."` };

  const p = data as unknown as DailyPlan;
  p.blocks = Array.isArray(p.blocks) ? p.blocks : [];
  return { plan: p, error: null };
}

const DAY_KEYS_MAP: Record<number, string> = { 1: 'monday', 2: 'tuesday', 3: 'wednesday', 4: 'thursday', 5: 'friday' };

interface QueueAccount { id: string; name: string; state: string; tier?: string }

async function fetchTodayQueue(ctx: ToolContext): Promise<{ today: QueueAccount[]; weeklyTotal: number; weeklyResearched: number; weeklyAddedToCadence: number } | null> {
  const userId = await ctx.getUserId();
  if (!userId) return null;
  const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const { data } = await supabase
    .from('weekly_research_queue' as any)
    .select('assignments')
    .eq('user_id', userId)
    .eq('week_start', weekStart)
    .maybeSingle();
  if (!data) return null;
  const a = (data as any).assignments as Record<string, QueueAccount[]>;
  const dayKey = DAY_KEYS_MAP[new Date().getDay()];
  const today = dayKey ? (a[dayKey] || []) : [];
  const allAccounts = Object.values(a).flat();
  return {
    today,
    weeklyTotal: allAccounts.length,
    weeklyResearched: allAccounts.filter(acc => acc.state === 'researched' || acc.state === 'added_to_cadence').length,
    weeklyAddedToCadence: allAccounts.filter(acc => acc.state === 'added_to_cadence').length,
  };
}


function joinNatural(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}

// ── Summary mode (conversational, ~60 seconds spoken) ──

export async function dailyGamePlanSummary(ctx: ToolContext): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error!;

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const sentences: string[] = [];

  // Opening with day shape
  const focusHrs = plan.focus_hours_available ?? 0;
  const meetingHrs = plan.meeting_load_hours ?? 0;
  const meetings = blocks.filter(b => b.type === 'meeting');

  let opener = `Alright, here's your day. You've got about ${focusHrs.toFixed(1)} hours of focus time`;
  if (meetings.length) {
    opener += ` and ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} taking up around ${meetingHrs.toFixed(1)} hours.`;
  } else {
    opener += ` with no meetings on the calendar — solid block day.`;
  }
  sentences.push(opener);

  // Strategy
  if (plan.ai_reasoning) {
    sentences.push(`The game plan today is to ${plan.ai_reasoning.charAt(0).toLowerCase()}${plan.ai_reasoning.slice(1).replace(/\.$/, '')}.`);
  }

  // Targets
  const targetParts: string[] = [];
  if (targets.dials) targetParts.push(`${targets.dials} dials`);
  if (targets.conversations) targetParts.push(`${targets.conversations} conversations`);
  if (targets.accounts_sourced) targetParts.push(`${targets.accounts_sourced} accounts sourced and added to cadence`);
  if (targets.accounts_researched) targetParts.push(`${targets.accounts_researched} accounts researched`);
  if (targets.contacts_prepped) targetParts.push(`${targets.contacts_prepped} contacts prepped`);
  if (targetParts.length) {
    sentences.push(`You're aiming for ${joinNatural(targetParts)} today.`);
  }

  // Meetings
  if (meetings.length) {
    if (meetings.length <= 3) {
      const meetingParts = meetings.map(m => `${m.label} at ${spokenTime(m.start_time)}`);
      sentences.push(`On the meeting side, you've got ${joinNatural(meetingParts)}.`);
    } else {
      const first = meetings[0];
      sentences.push(`You've got ${meetings.length} meetings today, starting with ${first.label} at ${spokenTime(first.start_time)}.`);
    }
  }

  // Build block
  const buildBlocks = blocks.filter(b => b.type === 'build');
  if (buildBlocks.length) {
    const b = buildBlocks[0];
    const done = (b as any).build_steps?.filter((s: any) => s.done).length || 0;
    const total = (b as any).build_steps?.length || 5;
    let buildSentence = `You've got a New Logo Build block at ${spokenTime(b.start_time)} — that's where you source ${targets.accounts_sourced || 3} fresh accounts, research them, find contacts, and add them to cadence.${done > 0 ? ` You've completed ${done} of ${total} steps so far.` : ''}`;
    // Include auto-selected accounts
    const selection = loadCachedSelection(todayInAppTz());
    if (selection && selection.accounts.length > 0) {
      buildSentence += ` I've auto-selected ${joinNatural(selection.accounts.map(a => a.name))} as today's targets based on ICP fit and freshness.`;
    }
    sentences.push(buildSentence);
  }

  // Rust buster
  const rust = blocks.filter(b => b.label.toLowerCase().includes('rust'));
  if (rust.length) {
    sentences.push(`Your Rust Buster warm-up kicks off at ${spokenTime(rust[0].start_time)}.`);
  }

  // Current / next awareness
  if (blocks.length) {
    const { current, next } = findCurrentAndNext(blocks);
    if (current) {
      sentences.push(`Right now you should be in your ${current.label} block, which runs until ${spokenTime(current.end_time)}.`);
    } else if (next) {
      const now = getCurrentMinutesET();
      const [nh, nm] = next.start_time.split(':').map(Number);
      const minsUntil = (nh * 60 + nm) - now;
      sentences.push(`Your next block is ${next.label} starting at ${spokenTime(next.start_time)}, about ${minsUntil} minutes from now.`);
    }
  }

  // First focus recommendation
  const first = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
  if (first) {
    let closer = `I'd start with ${first.label} at ${spokenTime(first.start_time)}`;
    if (first.goals?.length) {
      closer += ` — the goal there is to ${first.goals[0].charAt(0).toLowerCase()}${first.goals[0].slice(1).replace(/\.$/, '')}`;
    }
    closer += '. Let me know if you want the full block-by-block walkthrough.';
    sentences.push(closer);
  }

  return sentences.join(' ');
}

// ── Detailed step-by-step mode (conversational, chronological) ──

export async function dailyGamePlanDetailed(ctx: ToolContext): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error!;

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const completedGoals = new Set(plan.completed_goals || []);
  const sentences: string[] = [];

  // Opening
  const focusHrs = plan.focus_hours_available ?? 0;
  const meetingHrs = plan.meeting_load_hours ?? 0;
  sentences.push(`OK let's walk through your whole day. You've got ${blocks.length} blocks lined up — about ${focusHrs.toFixed(1)} hours of focus time and ${meetingHrs.toFixed(1)} hours of meetings.`);

  // Strategy
  if (plan.ai_reasoning) {
    sentences.push(`The overall strategy is to ${plan.ai_reasoning.charAt(0).toLowerCase()}${plan.ai_reasoning.slice(1).replace(/\.$/, '')}.`);
  }

  // Targets
  const targetParts: string[] = [];
  if (targets.dials) targetParts.push(`${targets.dials} dials`);
  if (targets.conversations) targetParts.push(`${targets.conversations} conversations`);
  if (targets.accounts_sourced) targetParts.push(`${targets.accounts_sourced} accounts sourced and added to cadence`);
  if (targets.accounts_researched) targetParts.push(`${targets.accounts_researched} accounts researched`);
  if (targets.contacts_prepped) targetParts.push(`${targets.contacts_prepped} contacts prepped`);
  if (targetParts.length) {
    sentences.push(`By end of day you're targeting ${joinNatural(targetParts)}.`);
  }

  // Current position
  const { current } = findCurrentAndNext(blocks);

  // Block-by-block
  const transitions = [
    'Starting off',
    'After that',
    'Then',
    'Next',
    'From there',
    'Moving on',
    'Following that',
    'Then you shift to',
    'After that block',
    'Next up',
  ];

  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const dur = blockDurationMin(b);
    const isCurrent = b === current;
    const transition = i === 0 ? transitions[0] : transitions[Math.min(i, transitions.length - 1)];
    const hasCompleted = b.goals?.some((_, gi) => completedGoals.has(`${i}-${gi}`));

    // Core block sentence
    let blockSentence: string;
    if (isCurrent) {
      blockSentence = `This is where you are right now — ${b.label}, running from ${spokenTime(b.start_time)} to ${spokenTime(b.end_time)}, so about ${dur} minutes.`;
    } else {
      blockSentence = `${transition}, ${b.label} from ${spokenTime(b.start_time)} to ${spokenTime(b.end_time)}, ${dur} minutes.`;
    }
    if (hasCompleted) blockSentence += " You've already made progress here.";
    sentences.push(blockSentence);

    // Purpose
    if (b.reasoning) {
      sentences.push(`The idea here is ${b.reasoning.charAt(0).toLowerCase()}${b.reasoning.slice(1).replace(/\.$/, '')}.`);
    }

    // Goals
    if (b.goals?.length) {
      if (b.goals.length === 1) {
        sentences.push(`You'll know this block was a win if you ${b.goals[0].charAt(0).toLowerCase()}${b.goals[0].slice(1).replace(/\.$/, '')}.`);
      } else {
        const goalText = b.goals.map(g => g.charAt(0).toLowerCase() + g.slice(1).replace(/\.$/, ''));
        sentences.push(`Success here looks like ${joinNatural(goalText)}.`);
      }
    }

    // Linked accounts
    if (b.linked_accounts?.length) {
      const names = b.linked_accounts.map(a => a.name);
      sentences.push(`You'll be working with ${joinNatural(names)}.`);
    }

    // Progress
    if (b.actual_dials || b.actual_emails) {
      const actuals: string[] = [];
      if (b.actual_dials) actuals.push(`${b.actual_dials} dials`);
      if (b.actual_emails) actuals.push(`${b.actual_emails} emails`);
      sentences.push(`So far you've logged ${joinNatural(actuals)} in this block.`);
    }
  }

  // Closing
  if (current) {
    sentences.push(`So right now, stay locked into ${current.label}.`);
    if (current.goals?.length) {
      sentences.push(`Focus on getting ${current.goals[0].charAt(0).toLowerCase()}${current.goals[0].slice(1).replace(/\.$/, '')} done.`);
    }
  } else {
    const nextActionBlock = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
    if (nextActionBlock) {
      sentences.push(`First thing to tackle is ${nextActionBlock.label} at ${spokenTime(nextActionBlock.start_time)}.`);
    }
  }

  sentences.push(`That's the full rundown. Ask me about any specific block if you want to dig in.`);

  return sentences.join(' ');
}

// ── Legacy alias — defaults to summary ──

export async function dailyGamePlanWalkthrough(ctx: ToolContext): Promise<string> {
  return dailyGamePlanSummary(ctx);
}

/**
 * Answer specific questions about the daily plan — conversational style.
 */
export async function queryDailyPlan(ctx: ToolContext, params: { question: string }): Promise<string> {
  const { plan, error } = await fetchTodayPlan(ctx);
  if (!plan) return error || 'You don\'t have a plan for today yet.';

  const blocks = plan.blocks as TimeBlock[];
  const targets = (plan.key_metric_targets || {}) as Record<string, number>;
  const q = params.question.toLowerCase();

  // Block-specific follow-up
  const blockNumMatch = q.match(/block\s*(\d+)/);
  if (blockNumMatch) {
    const idx = parseInt(blockNumMatch[1], 10) - 1;
    if (idx >= 0 && idx < blocks.length) {
      const b = blocks[idx];
      const dur = blockDurationMin(b);
      let resp = `Block ${idx + 1} is ${b.label}, running from ${spokenTime(b.start_time)} to ${spokenTime(b.end_time)} — that's ${dur} minutes.`;
      if (b.reasoning) resp += ` The purpose is ${b.reasoning.charAt(0).toLowerCase()}${b.reasoning.slice(1).replace(/\.$/, '')}.`;
      if (b.goals?.length) resp += ` You want to ${b.goals.map(g => g.charAt(0).toLowerCase() + g.slice(1).replace(/\.$/, '')).join(' and ')}.`;
      if (b.linked_accounts?.length) resp += ` You'll be focused on ${joinNatural(b.linked_accounts.map(a => a.name))}.`;
      return resp;
    }
  }

  // Schedule
  if (q.includes('time block') || q.includes('schedule') || q.includes('blocks')) {
    const summary = blocks.map(b => `${b.label} from ${spokenTime(b.start_time)} to ${spokenTime(b.end_time)}`);
    return `Your schedule has ${blocks.length} blocks today. ${joinNatural(summary)}.`;
  }

  // Research
  if (q.includes('research') || q.includes('account')) {
    const target = targets.accounts_researched || 0;
    const prepBlocks = blocks.filter(b => b.type === 'prep' || b.type === 'research');
    let resp = `You're targeting ${target} accounts researched today.`;
    if (prepBlocks.length) {
      resp += ` You have ${prepBlocks.length} prep block${prepBlocks.length !== 1 ? 's' : ''} set aside for that`;
      resp += ` — the first one is at ${spokenTime(prepBlocks[0].start_time)}.`;
    }
    return resp;
  }

  // Rust buster
  if (q.includes('rust') || q.includes('warm up') || q.includes('warmup')) {
    const rust = blocks.filter(b => b.label.toLowerCase().includes('rust'));
    if (!rust.length) return 'There\'s no Rust Buster block in today\'s plan.';
    const b = rust[0];
    let resp = `Your Rust Buster is at ${spokenTime(b.start_time)}, running until ${spokenTime(b.end_time)}.`;
    if (b.goals?.length) resp += ` The goal is to ${b.goals[0].charAt(0).toLowerCase()}${b.goals[0].slice(1).replace(/\.$/, '')}.`;
    return resp;
  }

  // New logo targets / "my 3 accounts" / "which accounts"
  if (q.includes('new logo') || q.includes('3 account') || q.includes('three account') || q.includes('target account') || q.includes('which account') || q.includes('pick') || q.includes('chose') || q.includes('why')) {
    const selection = loadCachedSelection(todayInAppTz());
    if (selection && selection.accounts.length > 0) {
      const accts = selection.accounts;
      let resp = `Today's 3 new logo targets are: `;
      resp += accts.map(a => `Number ${a.rank}, ${a.name}. ${a.reason}. First step: ${a.suggestedFirstStep}`).join('. ');
      resp += `. These were selected based on ICP fit, recency, tier, and buying signals — with rotation to avoid overworking the same accounts.`;
      if (q.includes('why') || q.includes('pick') || q.includes('chose')) {
        resp += ` I rotate accounts daily so you're not hammering the same ones. Each pick weighs ICP fit score, tier, how recently you touched them, and any active trigger events.`;
      }
      if (q.includes('first') || q.includes('walk')) {
        const first = accts[0];
        resp += ` Let's start with ${first.name}. ${first.suggestedFirstStep}. Say "enrich ${first.name}" to kick off research, or "discover contacts for ${first.name}" to find decision-makers.`;
      }
      return resp;
    }
    // Fall through to build block info if no cached selection
  }

  // Prospecting / build
  if (q.includes('build') || q.includes('sourc') || q.includes('cadence')) {
    const buildBlocks = blocks.filter(b => b.type === 'build');
    if (!buildBlocks.length) return 'There\'s no New Logo Build block in today\'s plan. You may want to regenerate it.';
    const b = buildBlocks[0];
    const steps = (b as any).build_steps || [];
    const done = steps.filter((s: any) => s.done).length;
    let resp = `Your New Logo Build block runs from ${spokenTime(b.start_time)} to ${spokenTime(b.end_time)}.`;
    resp += ` The goal is to source ${targets.accounts_sourced || 3} accounts end-to-end: select, research, find contacts, get their info, and add to cadence.`;
    if (done > 0) resp += ` You've completed ${done} of ${steps.length} steps so far.`;
    // Add auto-selected accounts context
    const selection = loadCachedSelection(todayInAppTz());
    if (selection && selection.accounts.length > 0) {
      resp += ` Today's auto-selected targets are ${joinNatural(selection.accounts.map(a => a.name))}.`;
    }
    return resp;
  }

  if (q.includes('prospect') || q.includes('dial') || q.includes('call')) {
    const prospBlocks = blocks.filter(b => b.type === 'prospecting');
    const totalMin = prospBlocks.reduce((s, b) => s + blockDurationMin(b), 0);
    let resp = `You've got ${prospBlocks.length} prospecting block${prospBlocks.length !== 1 ? 's' : ''} today, about ${Math.round(totalMin / 60 * 10) / 10} hours total.`;
    if (targets.dials) resp += ` Your dial target is ${targets.dials}.`;
    return resp;
  }

  // Focus / first
  if (q.includes('focus') || q.includes('first') || q.includes('start')) {
    const first = blocks.find(b => b.type !== 'meeting' && b.type !== 'break');
    if (!first) return 'It\'s all meetings today — no open action blocks.';
    let resp = `I'd start with ${first.label} at ${spokenTime(first.start_time)}.`;
    if (first.goals?.length) resp += ` Aim to ${first.goals[0].charAt(0).toLowerCase()}${first.goals[0].slice(1).replace(/\.$/, '')}.`;
    return resp;
  }

  // Meetings
  if (q.includes('meeting')) {
    const meetings = blocks.filter(b => b.type === 'meeting');
    if (!meetings.length) return 'No meetings on the calendar today — pure focus day.';
    const meetingParts = meetings.map(m => `${m.label} at ${spokenTime(m.start_time)}`);
    return `You have ${meetings.length} meeting${meetings.length !== 1 ? 's' : ''} today. ${joinNatural(meetingParts)}.`;
  }

  // Default
  let resp = plan.ai_reasoning
    ? `Today's approach is ${plan.ai_reasoning.charAt(0).toLowerCase()}${plan.ai_reasoning.slice(1).replace(/\.$/, '')}.`
    : 'Here\'s what I know about today.';
  resp += ` You have ${plan.focus_hours_available || 0} hours of focus time and ${plan.meeting_load_hours || 0} hours of meetings.`;
  if (Object.keys(targets).length) {
    const tParts: string[] = [];
    for (const [k, v] of Object.entries(targets)) tParts.push(`${v} ${k.replace(/_/g, ' ')}`);
    resp += ` Targets are ${joinNatural(tParts)}.`;
  }
  return resp;
}

/**
 * Dedicated tool: returns today's auto-selected new logo targets.
 */
export function newLogoTargetsTool(): string {
  const today = todayInAppTz();
  const selection = loadCachedSelection(today);
  if (!selection || selection.accounts.length === 0) {
    return 'No new logo targets have been selected for today yet. Head to the dashboard to generate your Daily Game Plan, or there may not be enough eligible accounts.';
  }

  const parts = selection.accounts.map(a =>
    `Number ${a.rank}: ${a.name}. ${a.reason}. Suggested first step: ${a.suggestedFirstStep}.`
  );

  return `Today's 3 auto-selected new logo accounts are:\n\n${parts.join('\n\n')}\n\nThese were picked based on ICP fit, tier, buying signals, and freshness rotation. Want me to walk you through the first one?`;
}
