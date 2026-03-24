import { WORK_START_MINUTES, WORK_END_MINUTES, DIALS_PER_30_MIN, DAILY_DIALS_MIN, clampWorkBlocksToHours } from './mvpBlockModel';
import { ensureMinimumCallBlocks } from './planCallBlockGuarantee';

export interface RebuildPlanBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: string;
}

export interface RebuildFallbackBlock extends RebuildPlanBlock {
  workstream: 'new_logo' | 'renewal' | 'general';
  goals: string[];
  reasoning: string;
}

export interface LocalFallbackPlan {
  blocks: RebuildFallbackBlock[];
  day_strategy: string;
  key_metric_targets: Record<string, number>;
  meeting_load_hours: number;
  focus_hours_available: number;
}

function normalizeLabel(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function blockKey(block: RebuildPlanBlock) {
  return `${block.start_time}-${block.end_time}-${normalizeLabel(block.label)}-${block.type}`;
}

function meetingKey(block: RebuildPlanBlock) {
  return `${block.start_time}-${block.end_time}-${normalizeLabel(block.label)}`;
}

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function toTime(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function durationMinutes(block: RebuildPlanBlock) {
  return Math.max(0, toMinutes(block.end_time) - toMinutes(block.start_time));
}

const DEFAULT_WORK_START_MINUTES = WORK_START_MINUTES;  // 9:00 AM — hard boundary
const DEFAULT_WORK_END_MINUTES = WORK_END_MINUTES;    // 5:00 PM — hard boundary

export function getVisiblePlanBlocks<T>(blocks: T[] | null | undefined, dismissed: Set<number>) {
  return (blocks || []).filter((_, index) => !dismissed.has(index));
}

export function planBlockSignature(blocks: RebuildPlanBlock[] | null | undefined) {
  return (blocks || []).map(blockKey).join('|');
}

export function summarizePlanDelta(
  beforeBlocks: RebuildPlanBlock[] | null | undefined,
  afterBlocks: RebuildPlanBlock[] | null | undefined,
) {
  const before = beforeBlocks || [];
  const after = afterBlocks || [];

  if (!before.length && after.length) return `created ${after.length} blocks`;
  if (planBlockSignature(before) === planBlockSignature(after)) return 'plan unchanged';

  const beforeKeys = new Set(before.map(blockKey));
  const afterKeys = new Set(after.map(blockKey));

  let added = 0;
  let removed = 0;

  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) added += 1;
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) removed += 1;
  }

  const changed = Math.max(added, removed);
  if (added && removed) return `${changed} block${changed === 1 ? '' : 's'} changed`;
  if (added) return `added ${added} block${added === 1 ? '' : 's'}`;
  if (removed) return `removed ${removed} block${removed === 1 ? '' : 's'}`;

  return 'plan updated';
}

export function buildLocalFallbackPlan(input: {
  allBlocks: RebuildFallbackBlock[] | null | undefined;
  currentVisibleBlocks: RebuildFallbackBlock[] | null | undefined;
  dismissedMeetingBlocks: RebuildPlanBlock[] | null | undefined;
  reason: string;
}): LocalFallbackPlan {
  const allBlocks = [...(input.allBlocks || [])].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const visibleBlocks = [...(input.currentVisibleBlocks || [])].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const dismissedKeys = new Set((input.dismissedMeetingBlocks || []).map(meetingKey));

  const visibleMeetings = visibleBlocks.filter((block) => block.type === 'meeting');
  const lockedMeetings = (visibleMeetings.length ? visibleMeetings : allBlocks.filter((block) => block.type === 'meeting'))
    .filter((block) => !dismissedKeys.has(meetingKey(block)))
    .sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  // Enforce strict 9-5 working hours — meetings outside are allowed but no work blocks
  const firstBlockStart = allBlocks.length ? toMinutes(allBlocks[0].start_time) : DEFAULT_WORK_START_MINUTES;
  const lastBlockEnd = allBlocks.length ? toMinutes(allBlocks[allBlocks.length - 1].end_time) : DEFAULT_WORK_END_MINUTES;
  const dayStart = Math.max(Math.min(firstBlockStart, DEFAULT_WORK_START_MINUTES), DEFAULT_WORK_START_MINUTES);
  const dayEnd = Math.min(Math.max(lastBlockEnd, DEFAULT_WORK_END_MINUTES), DEFAULT_WORK_END_MINUTES);

  const blocks: RebuildFallbackBlock[] = [...lockedMeetings];
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = dayStart;

  for (const meeting of lockedMeetings) {
    const meetingStart = toMinutes(meeting.start_time);
    const meetingEnd = toMinutes(meeting.end_time);
    if (meetingStart > cursor) gaps.push({ start: cursor, end: meetingStart });
    cursor = Math.max(cursor, meetingEnd);
  }

  if (cursor < dayEnd) gaps.push({ start: cursor, end: dayEnd });
  if (!gaps.length && dayEnd - dayStart >= 60) gaps.push({ start: dayStart, end: dayEnd });

  let prepPlaced = false;
  let activityIndex = 1;

  const pushBlock = (start: number, duration: number, block: Omit<RebuildFallbackBlock, 'start_time' | 'end_time'>) => {
    const end = Math.min(dayEnd, start + duration);
    blocks.push({
      ...block,
      start_time: toTime(start),
      end_time: toTime(end),
    });
    return end;
  };

  for (const gap of gaps) {
    let gapCursor = gap.start;
    let gapRemaining = gap.end - gap.start;
    if (gapRemaining < 30) continue;

    while (gapRemaining > 15) {
      if (gapRemaining >= 90) {
        // Canonical: 30-min prep + 60-min call block
        gapCursor = pushBlock(gapCursor, 30, {
          label: prepPlaced ? 'Account Research & Contact Sourcing' : 'New Logo Build',
          type: 'build',
          workstream: 'new_logo',
          goals: ['Select 3 target accounts', 'Research companies', 'Identify contacts', 'Find emails/phone numbers', 'Add to cadence'],
          reasoning: 'Canonical New Logo build block with full checklist.',
        });
        gapRemaining = gap.end - gapCursor;
        prepPlaced = true;

        const activityDuration = Math.min(60, gapRemaining);
        if (activityDuration >= 30) {
          const halfHours = activityDuration / 30;
          const estDials = Math.round(halfHours * DIALS_PER_30_MIN);
          const label = activityIndex === 1 ? `Call Block (~${estDials} dials)` : `Call Block #${activityIndex} (~${estDials} dials)`;
          gapCursor = pushBlock(gapCursor, activityDuration, {
            label,
            type: 'prospecting',
            workstream: 'new_logo',
            goals: [`Make ~${estDials} dials to sourced contacts`, 'Log responses and next steps'],
            reasoning: 'Execution block paired with prep.',
          });
          activityIndex += 1;
          gapRemaining = gap.end - gapCursor;
        }
      } else if (gapRemaining >= 60) {
        // 30 prep + 30 call
        gapCursor = pushBlock(gapCursor, 30, {
          label: 'New Logo Build',
          type: 'build',
          workstream: 'new_logo',
          goals: ['Select 3 target accounts', 'Research companies', 'Identify contacts', 'Find emails/phone numbers', 'Add to cadence'],
          reasoning: 'Canonical New Logo build block with full checklist.',
        });
        prepPlaced = true;
        gapRemaining = gap.end - gapCursor;

        if (gapRemaining >= 30) {
          const estDials = Math.round((gapRemaining / 30) * DIALS_PER_30_MIN);
          gapCursor = pushBlock(gapCursor, gapRemaining, {
            label: `Call Block (~${estDials} dials)`,
            type: 'prospecting',
            workstream: 'new_logo',
            goals: [`Make ~${estDials} dials to sourced contacts`, 'Log responses and next steps'],
            reasoning: 'Execution block paired with prep.',
          });
          activityIndex += 1;
          gapRemaining = 0;
        }
      } else if (gapRemaining >= 30) {
        gapCursor = pushBlock(gapCursor, gapRemaining, {
          label: prepPlaced ? 'Admin & CRM Updates' : 'New Logo Build',
          type: prepPlaced ? 'admin' : 'build',
          workstream: 'new_logo',
          goals: prepPlaced
            ? ['Log activity', 'Update CRM']
            : ['Select 3 target accounts', 'Research companies', 'Identify contacts', 'Find emails/phone numbers', 'Add to cadence'],
          reasoning: prepPlaced ? 'Use available time productively.' : 'Canonical New Logo build block.',
        });
        prepPlaced = true;
        gapRemaining = 0;
      } else {
        gapCursor = pushBlock(gapCursor, gapRemaining, {
          label: 'Admin & CRM Updates',
          type: 'admin',
          workstream: 'general',
          goals: ['Log activity', 'Update CRM'],
          reasoning: 'Use short window productively.',
        });
        gapRemaining = 0;
      }
    }
  }

  // Clamp all work blocks to 9–5
  const clampedBlocks = clampWorkBlocksToHours(blocks) as RebuildFallbackBlock[];
  let sortedBlocks = clampedBlocks.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  const guaranteedCalls = ensureMinimumCallBlocks(sortedBlocks, {
    searchStartMinutes: DEFAULT_WORK_START_MINUTES,
    searchEndMinutes: DEFAULT_WORK_END_MINUTES,
    createCallBlock: ({ startTime, endTime, sequence, reason }): RebuildFallbackBlock => ({
      start_time: startTime,
      end_time: endTime,
      label: sequence === 1 ? `Call Block (~${DIALS_PER_30_MIN} dials)` : `Call Block #${sequence} (~${DIALS_PER_30_MIN} dials)`,
      type: 'prospecting',
      workstream: 'new_logo',
      goals: [`Make ~${DIALS_PER_30_MIN} dials to sourced contacts`, 'Log responses and next steps'],
      reasoning: reason,
    }),
    onLog: (message) => console.warn(`[buildLocalFallbackPlan] ${message}`),
  });
  sortedBlocks = (guaranteedCalls.blocks as RebuildFallbackBlock[]).sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));

  // ── Fail-safe: ensure at least 1 build block ──
  if (!sortedBlocks.some(b => b.type === 'build')) {
    const lastBlock = sortedBlocks[sortedBlocks.length - 1];
    let cursor = lastBlock ? toMinutes(lastBlock.end_time) : DEFAULT_WORK_START_MINUTES;
    if (cursor + 30 <= DEFAULT_WORK_END_MINUTES) {
      sortedBlocks.push({
        start_time: toTime(cursor),
        end_time: toTime(Math.min(cursor + 60, DEFAULT_WORK_END_MINUTES)),
        label: 'New Logo Build',
        type: 'build',
        workstream: 'new_logo',
        goals: ['Select 3 target accounts', 'Research companies', 'Identify contacts', 'Find emails/phone numbers', 'Add to cadence'],
        reasoning: 'Ensured at least one build block for pipeline sourcing.',
      });
      sortedBlocks = sortedBlocks.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
    }
  }

  const meetingMinutes = sortedBlocks
    .filter((block) => block.type === 'meeting')
    .reduce((sum, block) => sum + durationMinutes(block), 0);
  const focusMinutes = Math.max(0, (dayEnd - dayStart) - meetingMinutes);

  // Use MVP dial math: 10 dials per 30 min
  const finalProspectingBlocks = sortedBlocks.filter((block) => block.type === 'prospecting');
  const totalProspectingHalfHours = finalProspectingBlocks.reduce((sum, block) => sum + durationMinutes(block) / 30, 0);
  const finalPlannedDials = Math.round(totalProspectingHalfHours * DIALS_PER_30_MIN);

  const callEnforcementNote = guaranteedCalls.logs.length
    ? ` Call-block enforcement: ${guaranteedCalls.logs.join(' ')}`
    : '';

  return {
    blocks: sortedBlocks,
    day_strategy: `Local fallback rebuild applied — ${input.reason}. Meetings were preserved, dismissed meetings stayed removed, and core prep/call blocks were reinserted.${callEnforcementNote}`,
    key_metric_targets: {
      dials: Math.max(DAILY_DIALS_MIN, finalPlannedDials),
      conversations: Math.max(1, finalProspectingBlocks.length * 2),
      accounts_sourced: sortedBlocks.some((block) => block.type === 'build' || block.type === 'prep') ? 2 : 0,
      accounts_researched: sortedBlocks.some((block) => block.type === 'build' || block.type === 'prep') ? 2 : 0,
      contacts_prepped: sortedBlocks.some((block) => block.type === 'build' || block.type === 'prep') ? 2 : 0,
    },
    meeting_load_hours: Math.round((meetingMinutes / 60) * 10) / 10,
    focus_hours_available: Math.round((focusMinutes / 60) * 10) / 10,
  };
}