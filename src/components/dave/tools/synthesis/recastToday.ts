/**
 * Dave tool: recast_today
 * Calls the shared recast engine and formats results for voice delivery.
 */
import { supabase } from '@/integrations/supabase/client';
import { todayInAppTz, getCurrentMinutesET, spokenTimeET } from '@/lib/timeFormat';
import { recastDay, type RecastBlock, type RecastInput } from '@/data/recast-engine';
import type { ToolContext } from '../../toolTypes';

export async function recastToday(ctx: ToolContext): Promise<string> {
  const userId = await ctx.getUserId();
  if (!userId) return 'Not authenticated.';

  const today = todayInAppTz();

  // Fetch today's plan
  const { data: planData, error } = await supabase
    .from('daily_time_blocks')
    .select('*')
    .eq('user_id', userId)
    .eq('plan_date', today)
    .maybeSingle();

  if (error || !planData) {
    return "You don't have a Daily Game Plan for today yet. Generate one from the dashboard first, then I can recast it.";
  }

  const blocks: RecastBlock[] = Array.isArray(planData.blocks) ? (planData.blocks as any[]) : [];
  const completedGoals = new Set<string>((planData.completed_goals as string[]) || []);
  const targets = (planData.key_metric_targets || {}) as Record<string, number>;

  if (blocks.length === 0) {
    return "Your plan exists but has no blocks. Try regenerating your Daily Game Plan.";
  }

  // Build actuals from blocks (dials/emails logged in blocks)
  const actuals: Record<string, number> = {};
  for (const b of blocks) {
    if (b.actual_dials) actuals.dials = (actuals.dials || 0) + (b.actual_dials as number);
    if (b.actual_emails) actuals.emails = (actuals.emails || 0) + (b.actual_emails as number);
  }
  // Count completed goals as proxy for conversations
  actuals.completed_goals = completedGoals.size;

  // Fetch meetings from calendar for today
  const { data: calEvents } = await supabase
    .from('calendar_events')
    .select('title, start_time, end_time')
    .eq('user_id', userId)
    .gte('start_time', `${today}T00:00:00`)
    .lte('start_time', `${today}T23:59:59`);

  const meetingSchedule = (calEvents || []).map(e => {
    const s = new Date(e.start_time);
    const end = e.end_time ? new Date(e.end_time) : new Date(s.getTime() + 30 * 60000);
    return {
      start: s.getHours() * 60 + s.getMinutes(),
      end: end.getHours() * 60 + end.getMinutes(),
      label: e.title,
    };
  });

  // Determine work end time (hard boundary: 5:00 PM)
  const workEndMinutes = 17 * 60;

  const input: RecastInput = {
    currentTimeMinutes: getCurrentMinutesET(),
    allBlocks: blocks,
    completedGoals,
    meetingSchedule,
    targets,
    actuals,
    workEndMinutes,
  };

  const result = recastDay(input);

  // ── Persist recast timestamp so UI can show "Recast Active" ──
  await supabase
    .from('daily_time_blocks')
    .update({
      blocks: result.remainingBlocks as any,
      recast_at: new Date().toISOString(),
    } as any)
    .eq('id', planData.id);

  // ── Format for voice delivery ──
  const sentences: string[] = [];

  // Situation
  const hoursLeft = (result.minutesRemaining / 60).toFixed(1);
  sentences.push(`OK — we're adjusting based on what's left in the day. You have about ${hoursLeft} hours remaining.`);

  // What changed
  if (result.droppedBlocks.length > 0) {
    const dropped = result.droppedBlocks.map(d => d.label);
    sentences.push(`I've dropped ${dropped.length} block${dropped.length > 1 ? 's' : ''}: ${dropped.join(', ')}. ${result.droppedBlocks[0].reason}.`);
  }

  if (result.compressedBlocks.length > 0) {
    for (const c of result.compressedBlocks) {
      sentences.push(`Compressed ${c.label} from ${c.originalMinutes} to ${c.newMinutes} minutes.`);
    }
  }

  if (result.droppedBlocks.length === 0 && result.compressedBlocks.length === 0) {
    sentences.push(`Good news — your remaining schedule fits. No blocks needed to be dropped or compressed.`);
  }

  // Priorities
  if (result.updatedPriorities.length > 0) {
    sentences.push(`Key priorities: ${result.updatedPriorities.join('. ')}.`);
  }

  // Remaining blocks summary
  const actionBlocks = result.remainingBlocks.filter(b => b.type !== 'meeting');
  const meetings = result.remainingBlocks.filter(b => b.type === 'meeting');
  if (actionBlocks.length > 0) {
    const blockList = actionBlocks.map(b => `${b.label} at ${spokenTimeET(b.start_time)}`);
    sentences.push(`Your remaining action blocks: ${blockList.join(', ')}.`);
  }
  if (meetings.length > 0) {
    sentences.push(`Plus ${meetings.length} meeting${meetings.length > 1 ? 's' : ''} locked in.`);
  }

  // Next action
  sentences.push(`Right now, ${result.suggestedNextAction}.`);

  return sentences.join(' ');
}
