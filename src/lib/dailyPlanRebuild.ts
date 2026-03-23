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

const DEFAULT_WORK_START_MINUTES = 9 * 60;
const DEFAULT_WORK_END_MINUTES = 17 * 60;

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

  const firstBlockStart = allBlocks.length ? toMinutes(allBlocks[0].start_time) : DEFAULT_WORK_START_MINUTES;
  const lastBlockEnd = allBlocks.length ? toMinutes(allBlocks[allBlocks.length - 1].end_time) : DEFAULT_WORK_END_MINUTES;
  const dayStart = Math.min(firstBlockStart, DEFAULT_WORK_START_MINUTES);
  const dayEnd = Math.max(lastBlockEnd, DEFAULT_WORK_END_MINUTES);

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
      if (gapRemaining >= 60) {
        gapCursor = pushBlock(gapCursor, 30, {
          label: prepPlaced ? 'Quick outreach prep' : 'Prep contacts for outreach',
          type: 'admin' as any,
          workstream: 'new_logo',
          goals: ['Research target accounts', 'Find contacts + source emails/phone numbers', 'Load contacts into cadence'],
          reasoning: 'Prep time before outreach so execution is actually possible.',
        });
        gapRemaining = gap.end - gapCursor;
        prepPlaced = true;

        const activityDuration = Math.min(60, gapRemaining);
        if (activityDuration >= 30) {
          const estimatedTouches = Math.max(8, Math.round(activityDuration / 3));
          const label = activityIndex === 1 ? 'Work sourced contacts' : 'Continue outreach follow-up';
          gapCursor = pushBlock(gapCursor, activityDuration, {
            label,
            type: 'prospecting',
            workstream: 'new_logo',
            goals: [`Make calls / send emails for ~${estimatedTouches} outreach touches`, 'Log responses and next steps'],
            reasoning: 'Activity block paired with prep so time is used efficiently.',
          });
          activityIndex += 1;
          gapRemaining = gap.end - gapCursor;
        }
      } else if (gapRemaining >= 30) {
        gapCursor = pushBlock(gapCursor, gapRemaining, {
          label: 'Prep contacts for outreach',
          type: 'admin' as any,
          workstream: 'new_logo',
          goals: ['Research target accounts', 'Find contacts + source emails/phone numbers', 'Load contacts into cadence'],
          reasoning: 'Use remaining half hour for prep instead of leaving time idle.',
        });
        prepPlaced = true;
        gapRemaining = 0;
      } else {
        gapCursor = pushBlock(gapCursor, gapRemaining, {
          label: 'Quick admin & CRM updates',
          type: 'admin' as any,
          workstream: 'general',
          goals: ['Log activity', 'Update CRM'],
          reasoning: 'Use short window productively instead of leaving dead time.',
        });
        gapRemaining = 0;
      }
    }
  }

  const sortedBlocks = blocks.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const meetingMinutes = sortedBlocks
    .filter((block) => block.type === 'meeting')
    .reduce((sum, block) => sum + durationMinutes(block), 0);
  const focusMinutes = Math.max(0, (dayEnd - dayStart) - meetingMinutes);

  return {
    blocks: sortedBlocks,
    day_strategy: `Local fallback rebuild applied — ${input.reason}. Meetings were preserved, dismissed meetings stayed removed, and core build/call blocks were reinserted.`,
    key_metric_targets: {
      dials: sortedBlocks.filter((block) => block.type === 'prospecting').reduce((sum, block) => sum + Math.round(durationMinutes(block) / 2), 0),
      conversations: Math.max(1, sortedBlocks.filter((block) => block.type === 'prospecting').length * 2),
      accounts_sourced: sortedBlocks.some((block) => block.type === 'build') ? 2 : 0,
      accounts_researched: sortedBlocks.some((block) => block.type === 'build') ? 2 : 0,
      contacts_prepped: sortedBlocks.some((block) => block.type === 'build') ? 2 : 0,
    },
    meeting_load_hours: Math.round((meetingMinutes / 60) * 10) / 10,
    focus_hours_available: Math.round((focusMinutes / 60) * 10) / 10,
  };
}