/**
 * Recast Engine — re-optimizes remaining daily blocks based on current progress.
 *
 * Pure logic module. No UI, no Dave persona. Dave calls this and interprets the result.
 */

import { DIALS_PER_30_MIN } from '@/lib/mvpBlockModel';
import { ensureMinimumCallBlocks, fillRemainingGaps } from '@/lib/planCallBlockGuarantee';
import { validateCalendarInvariants, enforceCalendarImmutability, type CalendarAnchor } from '@/lib/calendarTimeInvariants';

export interface RecastBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: 'prospecting' | 'meeting' | 'research' | 'admin' | 'break' | 'pipeline' | 'prep' | 'build';
  workstream?: 'new_logo' | 'renewal' | 'general';
  goals: string[];
  reasoning: string;
  linked_accounts?: { id: string; name: string }[];
  build_steps?: { step: string; done: boolean }[];
  actual_dials?: number;
  actual_emails?: number;
}

export interface RecastInput {
  currentTimeMinutes: number;          // minutes since midnight (ET)
  allBlocks: RecastBlock[];
  completedGoals: Set<string>;         // "blockIdx-goalIdx"
  meetingSchedule: { start: number; end: number; label: string }[];
  targets: Record<string, number>;     // e.g. { dials: 60, conversations: 10 }
  actuals: Record<string, number>;     // current progress against targets
  workEndMinutes: number;              // e.g. 17*60 = 1020
}

export interface RecastResult {
  remainingBlocks: RecastBlock[];
  droppedBlocks: { label: string; reason: string }[];
  compressedBlocks: { label: string; originalMinutes: number; newMinutes: number }[];
  updatedPriorities: string[];
  suggestedNextAction: string;
  minutesRemaining: number;
  summary: string;
}

// ── Block value ranking (higher = keep) ──
const TYPE_PRIORITY: Record<string, number> = {
  meeting: 100,   // never drop
  pipeline: 80,
  prospecting: 75,
  build: 70,
  prep: 60,
  research: 50,
  admin: 20,
  break: 10,
};

// Minimum duration for meaningful work vs light tasks
const MEANINGFUL_TYPES = new Set(['prospecting', 'pipeline', 'build', 'research']);
const MIN_MEANINGFUL_MINUTES = 30;
const MIN_LIGHT_MINUTES = 15;

function blockMinutes(b: RecastBlock): number {
  const [sh, sm] = b.start_time.split(':').map(Number);
  const [eh, em] = b.end_time.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

function isMeaningfulWork(type: string): boolean {
  return MEANINGFUL_TYPES.has(type);
}

function minBlockDuration(type: string): number {
  return isMeaningfulWork(type) ? MIN_MEANINGFUL_MINUTES : MIN_LIGHT_MINUTES;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function fromMinutes(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

function spokenTime(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
  if (m === 0) return `${hour} ${suffix}`;
  return `${hour}:${m.toString().padStart(2, '0')} ${suffix}`;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Core recast logic.
 */
export function recastDay(input: RecastInput): RecastResult {
  const { currentTimeMinutes, allBlocks, completedGoals, meetingSchedule, targets, actuals, workEndMinutes } = input;

  // ── Snapshot calendar anchors BEFORE any mutation ──
  const canonicalMeetings = meetingSchedule.length > 0
    ? meetingSchedule
        .map(meeting => ({
          start_time: fromMinutes(meeting.start),
          end_time: fromMinutes(meeting.end),
          label: meeting.label,
        }))
        .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time))
    : allBlocks
        .filter(b => b.type === 'meeting')
        .map(b => ({ start_time: b.start_time, end_time: b.end_time, label: b.label }))
        .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  const calendarAnchors: CalendarAnchor[] = canonicalMeetings;
  const existingMeetingMap = new Map(
    allBlocks
      .filter(b => b.type === 'meeting')
      .map(b => [normalizeLabel(b.label), b] as const)
  );
  const minutesRemaining = Math.max(0, workEndMinutes - currentTimeMinutes);

  // Separate past/current vs future blocks
  const futureBlocks: (RecastBlock & { originalIdx: number })[] = [];

  for (let i = 0; i < allBlocks.length; i++) {
    const endMin = toMinutes(allBlocks[i].end_time);
    if (allBlocks[i].type !== 'meeting' && endMin > currentTimeMinutes) {
      futureBlocks.push({ ...allBlocks[i], originalIdx: i });
    }
  }

  const futureMeetingBlocks: RecastBlock[] = canonicalMeetings
    .filter(meeting => toMinutes(meeting.end_time) > currentTimeMinutes)
    .map(meeting => {
      const existing = existingMeetingMap.get(normalizeLabel(meeting.label));
      return {
        start_time: meeting.start_time,
        end_time: meeting.end_time,
        label: meeting.label,
        type: 'meeting',
        workstream: existing?.workstream ?? 'general',
        goals: existing?.goals?.length ? existing.goals : [`Attend ${meeting.label}`],
        reasoning: existing?.reasoning ?? 'Fixed calendar meeting — this time is locked.',
        linked_accounts: existing?.linked_accounts,
        actual_dials: existing?.actual_dials,
        actual_emails: existing?.actual_emails,
      };
    });

  // If no time left, nothing to recast
  if (minutesRemaining <= 0 || (futureBlocks.length === 0 && futureMeetingBlocks.length === 0)) {
    return {
      remainingBlocks: [],
      droppedBlocks: [],
      compressedBlocks: [],
      updatedPriorities: [],
      suggestedNextAction: 'Your workday is over. Rest up.',
      minutesRemaining: 0,
      summary: 'No time remaining to recast.',
    };
  }

  // ── Identify meetings (immovable) ──
  const meetingBlocks = futureMeetingBlocks;
  const actionBlocks = futureBlocks;

  // Sort action blocks by priority (highest first)
  actionBlocks.sort((a, b) => (TYPE_PRIORITY[b.type] || 0) - (TYPE_PRIORITY[a.type] || 0));

  // ── Calculate available minutes (exclude meetings) ──
  const meetingMinutes = meetingBlocks.reduce((s, b) => s + blockMinutes(b), 0);
  let availableActionMinutes = minutesRemaining - meetingMinutes;

  // ── Fit blocks into available time ──
  const keptBlocks: RecastBlock[] = [];
  const droppedBlocks: { label: string; reason: string }[] = [];
  const compressedBlocks: { label: string; originalMinutes: number; newMinutes: number }[] = [];

  for (const block of actionBlocks) {
    const dur = blockMinutes(block);

    if (availableActionMinutes <= 0) {
      droppedBlocks.push({ label: block.label, reason: 'No time remaining' });
      continue;
    }

    // Check if all goals for this block are already done
    const allGoalsDone = block.goals.length > 0 &&
      block.goals.every((_, gi) => completedGoals.has(`${block.originalIdx}-${gi}`));

    if (allGoalsDone) {
      droppedBlocks.push({ label: block.label, reason: 'All goals already completed' });
      continue;
    }

    // Low-value blocks get dropped if time is tight (< 60 min remaining)
    if (availableActionMinutes < 60 && (TYPE_PRIORITY[block.type] || 0) <= 20) {
      droppedBlocks.push({ label: block.label, reason: 'Low priority — time is tight' });
      continue;
    }

    const minDur = minBlockDuration(block.type);

    if (dur <= availableActionMinutes) {
      keptBlocks.push(block);
      availableActionMinutes -= dur;
    } else if (availableActionMinutes >= minDur) {
      // Compress block to fit, but never below minimum for its type
      const newDur = Math.max(minDur, availableActionMinutes);
      compressedBlocks.push({ label: block.label, originalMinutes: dur, newMinutes: newDur });
      keptBlocks.push({ ...block, reasoning: `Compressed from ${dur} to ${newDur} min — focus on highest-impact goals` });
      availableActionMinutes -= newDur;
    } else {
      droppedBlocks.push({ label: block.label, reason: isMeaningfulWork(block.type) ? `Only ${availableActionMinutes} min left — below ${minDur} min minimum for deep work` : 'Not enough time to fit even compressed' });
    }
  }

  // ── Rebuild timeline: interleave meetings with action blocks ──
  const allKept = [...meetingBlocks, ...keptBlocks];

  // Sort by original start time for meetings, then fill gaps with action blocks
  const meetingSorted = meetingBlocks.slice().sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  const scheduled: RecastBlock[] = [];
  let cursor = currentTimeMinutes;

  // Interleave: place action blocks in gaps between meetings
  let actionIdx = 0;
  for (const meeting of meetingSorted) {
    const meetStart = toMinutes(meeting.start_time);
    // Fill gap before meeting with action blocks
    while (actionIdx < keptBlocks.length && cursor < meetStart) {
      const ab = keptBlocks[actionIdx];
      const dur = blockMinutes(ab);
      const gapToMeeting = meetStart - cursor;
      const actualDur = Math.min(dur, gapToMeeting);
      const minDur = minBlockDuration(ab.type);
      if (actualDur >= minDur) {
        // Use the full available window, not just the block's original duration
        scheduled.push({
          ...ab,
          start_time: fromMinutes(cursor),
          end_time: fromMinutes(cursor + actualDur),
        });
        cursor += actualDur;
        actionIdx++;
      } else if (gapToMeeting >= 15) {
        // Gap too small for this block type but >= 15 min — skip block, gap will be filled later
        actionIdx++;
      } else {
        break;
      }
    }
    // Place meeting
    scheduled.push(meeting);
    cursor = Math.max(cursor, toMinutes(meeting.end_time));
  }

  // Fill remaining time after last meeting
  while (actionIdx < keptBlocks.length && cursor < workEndMinutes) {
    const ab = keptBlocks[actionIdx];
    const dur = blockMinutes(ab);
    const actualDur = Math.min(dur, workEndMinutes - cursor);
    const minDur = minBlockDuration(ab.type);
    if (actualDur >= minDur) {
      scheduled.push({
        ...ab,
        start_time: fromMinutes(cursor),
        end_time: fromMinutes(cursor + actualDur),
      });
      cursor += actualDur;
    }
    actionIdx++;
  }

  const guaranteedSchedule = ensureMinimumCallBlocks(scheduled, {
    searchStartMinutes: Math.max(currentTimeMinutes, 9 * 60),
    searchEndMinutes: workEndMinutes,
    createCallBlock: ({ startTime, endTime, sequence, reason }): RecastBlock => ({
      start_time: startTime,
      end_time: endTime,
      label: sequence === 1 ? `Call Block (~${DIALS_PER_30_MIN} dials)` : `Call Block #${sequence} (~${DIALS_PER_30_MIN} dials)`,
      type: 'prospecting',
      workstream: 'new_logo',
      goals: [`Make ~${DIALS_PER_30_MIN} dials to sourced contacts`, 'Log responses and next steps'],
      reasoning: reason,
    }),
    onLog: (message) => console.warn(`[recastDay] ${message}`),
  });

  // ── INVARIANT: enforce calendar immutability post-recast ──
  const guaranteedBlocks = guaranteedSchedule.blocks as RecastBlock[];
  const anchorMap = new Map<string, CalendarAnchor>();
  for (const a of calendarAnchors) anchorMap.set(a.label.trim().toLowerCase(), a);

  const correctedBlocks = guaranteedBlocks.map(block => {
    if (block.type !== 'meeting') return block;
    const anchor = anchorMap.get(block.label.trim().toLowerCase());
    if (!anchor) return block;
    if (block.start_time !== anchor.start_time || block.end_time !== anchor.end_time) {
      console.error(`[recastDay] CALENDAR DRIFT CORRECTED: "${block.label}" ${block.start_time}-${block.end_time} → ${anchor.start_time}-${anchor.end_time}`);
      return { ...block, start_time: anchor.start_time, end_time: anchor.end_time };
    }
    return block;
  });

  // Fill remaining 15–29 min gaps with light admin micro-blocks
  const finalScheduled = fillRemainingGaps(
    correctedBlocks,
    currentTimeMinutes,
    workEndMinutes,
    (startTime: string, endTime: string): RecastBlock => ({
      start_time: startTime,
      end_time: endTime,
      label: 'CRM & Follow-up',
      type: 'admin',
      workstream: 'general',
      goals: ['Log activity', 'Quick follow-ups'],
      reasoning: 'Filling short gap with productive light work.',
    }),
  );

  // ── Determine priorities based on target gaps ──
  const updatedPriorities: string[] = [];
  for (const [key, target] of Object.entries(targets)) {
    const actual = actuals[key] || 0;
    const pct = target > 0 ? actual / target : 1;
    if (pct < 0.5) {
      updatedPriorities.push(`${key.replace(/_/g, ' ')} is behind (${actual}/${target}) — prioritize`);
    } else if (pct < 0.8) {
      updatedPriorities.push(`${key.replace(/_/g, ' ')} needs attention (${actual}/${target})`);
    }
  }

  if (guaranteedSchedule.unmetBlocks > 0 && guaranteedSchedule.logs.length > 0) {
    updatedPriorities.push(`dial minimum still at risk — ${guaranteedSchedule.logs[guaranteedSchedule.logs.length - 1]}`);
  }

  // ── Suggested next action ──
  const nextBlock = finalScheduled.find(b => b.type !== 'meeting');
  const suggestedNextAction = nextBlock
    ? `Focus on ${nextBlock.label} (${spokenTime(nextBlock.start_time)}–${spokenTime(nextBlock.end_time)})${nextBlock.goals.length ? ': ' + nextBlock.goals[0] : ''}`
    : meetingSorted.length
      ? `Your next commitment is ${meetingSorted[0].label} at ${spokenTime(meetingSorted[0].start_time)}`
      : 'No actionable blocks remaining today.';

  // ── Build summary ──
  const summaryParts: string[] = [];
  summaryParts.push(`${Math.round(minutesRemaining / 60 * 10) / 10} hours remaining today.`);
  summaryParts.push(`${finalScheduled.filter(b => b.type !== 'meeting').length} action blocks, ${meetingSorted.length} meetings.`);
  if (droppedBlocks.length) summaryParts.push(`Dropped ${droppedBlocks.length} block(s) to focus on what matters.`);
  if (compressedBlocks.length) summaryParts.push(`Compressed ${compressedBlocks.length} block(s) to fit available time.`);
  if (guaranteedSchedule.insertedBlocks > 0) summaryParts.push(`Inserted ${guaranteedSchedule.insertedBlocks} mandatory call block(s) to protect the dial minimum.`);
  if (guaranteedSchedule.unmetBlocks > 0 && guaranteedSchedule.logs.length > 0) summaryParts.push(`Call block enforcement issue: ${guaranteedSchedule.logs[guaranteedSchedule.logs.length - 1]}`);
  if (updatedPriorities.length) summaryParts.push(`Priorities: ${updatedPriorities.join('; ')}.`);

  return {
    remainingBlocks: finalScheduled,
    droppedBlocks,
    compressedBlocks,
    updatedPriorities,
    suggestedNextAction,
    minutesRemaining,
    summary: summaryParts.join(' '),
  };
}
