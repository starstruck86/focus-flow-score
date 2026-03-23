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

  const dayStart = allBlocks.length ? toMinutes(allBlocks[0].start_time) : 9 * 60;
  const dayEnd = allBlocks.length ? toMinutes(allBlocks[allBlocks.length - 1].end_time) : 17 * 60 + 30;

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

  // Follow strict dependency ordering: 1) Build, 2) Admin/Prep, 3) Outreach
  let buildPlaced = false;
  let adminPlaced = false;
  let prospectingIndex = 1;

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
    const gapLength = gap.end - gap.start;
    if (gapLength < 30) continue;

    // Phase 1: Build block (sourcing & research)
    if (!buildPlaced) {
      const buildDuration = gapLength >= 60 ? 60 : 30;
      gapCursor = pushBlock(gapCursor, buildDuration, {
        label: buildDuration >= 60 ? 'New Logo Build (3 accounts)' : 'New Logo Build (2 accounts)',
        type: 'build',
        workstream: 'new_logo',
        goals: buildDuration >= 60
          ? ['Select 3 target accounts', 'Research companies & identify contacts', 'Find emails/phone numbers']
          : ['Select 2 target accounts', 'Find contacts & add to cadence'],
        reasoning: 'Step 1 — source and research accounts before any outreach.',
      });
      buildPlaced = true;
    }

    // Phase 2: Admin/Prep block (contact sourcing & cadence loading)
    if (!adminPlaced && gap.end - gapCursor >= 30) {
      const adminDuration = Math.min(45, gap.end - gapCursor);
      gapCursor = pushBlock(gapCursor, adminDuration, {
        label: 'Account Research & Contact Sourcing',
        type: 'admin' as any,
        workstream: 'new_logo',
        goals: ['Source email addresses & phone numbers', 'Load contacts into cadence system', 'Verify contact data quality'],
        reasoning: 'Step 2 — contacts must be sourced and loaded before outreach begins.',
      });
      adminPlaced = true;
    }

    // Phase 3: Outreach blocks (only after prep is done)
    while (gap.end - gapCursor >= 30 && (buildPlaced || adminPlaced)) {
      const prospectingDuration = gap.end - gapCursor >= 60 ? 60 : Math.max(30, gap.end - gapCursor);
      const estimatedDials = Math.round(prospectingDuration / 2);
      const label = prospectingIndex === 1
        ? `Call newly added prospects (~${estimatedDials} dials)`
        : `Follow up on yesterday's outreach (~${estimatedDials} dials)`;
      gapCursor = pushBlock(gapCursor, prospectingDuration, {
        label,
        type: 'prospecting',
        workstream: 'new_logo',
        goals: [`Make ~${estimatedDials} dials to sourced contacts`, 'Log conversations and outcomes'],
        reasoning: 'Step 3 — outreach to prepped contacts.',
      });
      prospectingIndex += 1;
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