import {
  DAILY_DIALS_MIN,
  DIALS_PER_30_MIN,
  WORK_END_MINUTES,
  WORK_START_MINUTES,
} from './mvpBlockModel';

export interface GuaranteePlanBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: string;
  workstream?: string;
  goals?: string[];
  reasoning?: string;
}

export interface EnsureMinimumCallBlocksOptions<T extends GuaranteePlanBlock> {
  searchStartMinutes?: number;
  searchEndMinutes?: number;
  createCallBlock: (params: {
    startTime: string;
    endTime: string;
    sequence: number;
    reason: string;
  }) => T;
  onLog?: (message: string) => void;
}

export interface EnsureMinimumCallBlocksResult<T extends GuaranteePlanBlock> {
  blocks: T[];
  logs: string[];
  insertedBlocks: number;
  unmetBlocks: number;
  plannedDials: number;
}

const INSERTION_PRIORITY: Record<string, number> = {
  admin: 1,
  break: 2,
  research: 3,
  prep: 4,
  build: 5,
  pipeline: 6,
  prospecting: 7,
  meeting: 999,
};

function toMinutes(time: string) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function sortBlocks<T extends GuaranteePlanBlock>(blocks: T[]) {
  return [...blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}

function durationMinutes(block: Pick<GuaranteePlanBlock, 'start_time' | 'end_time'>) {
  return Math.max(0, toMinutes(block.end_time) - toMinutes(block.start_time));
}

function minimumRemainingMinutes(type: string) {
  return type === 'admin' || type === 'break' ? 15 : 30;
}

export function calculatePlannedDialMinimum(
  blocks: Array<Pick<GuaranteePlanBlock, 'type' | 'start_time' | 'end_time'>>,
) {
  return blocks
    .filter((block) => block.type === 'prospecting')
    .reduce((sum, block) => sum + Math.round((durationMinutes(block) / 30) * DIALS_PER_30_MIN), 0);
}

function buildCallBlock<T extends GuaranteePlanBlock>(
  options: EnsureMinimumCallBlocksOptions<T>,
  startMin: number,
  endMin: number,
  sequence: number,
  reason: string,
) {
  return options.createCallBlock({
    startTime: fromMinutes(startMin),
    endTime: fromMinutes(endMin),
    sequence,
    reason,
  });
}

function tryInsertIntoGap<T extends GuaranteePlanBlock>(
  blocks: T[],
  options: EnsureMinimumCallBlocksOptions<T>,
  searchStart: number,
  searchEnd: number,
  sequence: number,
) {
  const sorted = sortBlocks(blocks);
  let cursor = searchStart;

  for (const block of sorted) {
    const start = Math.max(searchStart, toMinutes(block.start_time));
    const end = Math.min(searchEnd, toMinutes(block.end_time));
    if (end <= searchStart || start >= searchEnd) continue;

    if (start - cursor >= 30) {
      const next = [...sorted, buildCallBlock(options, cursor, cursor + 30, sequence, 'Dial minimum enforcement — inserted call block in open window.')];
      return {
        blocks: sortBlocks(next),
        log: `Inserted 30-minute call block in open window ${fromMinutes(cursor)}–${fromMinutes(cursor + 30)}.`,
      };
    }

    cursor = Math.max(cursor, end);
  }

  if (searchEnd - cursor >= 30) {
    const next = [...sorted, buildCallBlock(options, cursor, cursor + 30, sequence, 'Dial minimum enforcement — inserted call block at day tail.')];
    return {
      blocks: sortBlocks(next),
      log: `Inserted 30-minute call block at ${fromMinutes(cursor)}–${fromMinutes(cursor + 30)}.`,
    };
  }

  return null;
}

function trySplitBlock<T extends GuaranteePlanBlock>(
  blocks: T[],
  options: EnsureMinimumCallBlocksOptions<T>,
  searchStart: number,
  searchEnd: number,
  sequence: number,
) {
  const sorted = sortBlocks(blocks);
  const candidates = sorted
    .map((block, index) => ({
      block,
      index,
      start: toMinutes(block.start_time),
      end: toMinutes(block.end_time),
    }))
    .filter(({ block, start, end }) => {
      if (block.type === 'meeting') return false;
      const minRemaining = minimumRemainingMinutes(block.type);
      return end - start >= minRemaining + 30 && Math.min(end, searchEnd) - Math.max(start, searchStart) >= 30;
    })
    .sort((a, b) => {
      const priorityDiff = (INSERTION_PRIORITY[a.block.type] ?? 50) - (INSERTION_PRIORITY[b.block.type] ?? 50);
      if (priorityDiff !== 0) return priorityDiff;
      return (b.end - b.start) - (a.end - a.start);
    });

  const candidate = candidates[0];
  if (!candidate) return null;

  const minRemaining = minimumRemainingMinutes(candidate.block.type);
  let callStart = candidate.end - 30;
  let callEnd = candidate.end;
  let keptStart = candidate.start;
  let keptEnd = candidate.end - 30;

  if (callStart < searchStart || keptEnd - keptStart < minRemaining) {
    callStart = candidate.start;
    callEnd = candidate.start + 30;
    keptStart = candidate.start + 30;
    keptEnd = candidate.end;
  }

  if (callStart < searchStart || callEnd > searchEnd || keptEnd - keptStart < minRemaining) {
    return null;
  }

  const next: T[] = [];
  sorted.forEach((block, index) => {
    if (index !== candidate.index) {
      next.push(block);
      return;
    }

    next.push({
      ...block,
      start_time: fromMinutes(keptStart),
      end_time: fromMinutes(keptEnd),
    });
    next.push(buildCallBlock(options, callStart, callEnd, sequence, `Dial minimum enforcement — split ${block.label} for a mandatory call block.`));
  });

  return {
    blocks: sortBlocks(next),
    log: `Split ${candidate.block.label} to free ${fromMinutes(callStart)}–${fromMinutes(callEnd)} for a call block.`,
  };
}

function tryRepurposeBlock<T extends GuaranteePlanBlock>(
  blocks: T[],
  options: EnsureMinimumCallBlocksOptions<T>,
  searchStart: number,
  searchEnd: number,
  sequence: number,
) {
  const sorted = sortBlocks(blocks);
  const candidates = sorted
    .map((block, index) => ({
      block,
      index,
      start: toMinutes(block.start_time),
      end: toMinutes(block.end_time),
    }))
    .filter(({ block, start, end }) => block.type !== 'meeting' && end - start >= 30 && Math.min(end, searchEnd) - Math.max(start, searchStart) >= 30)
    .sort((a, b) => {
      const priorityDiff = (INSERTION_PRIORITY[a.block.type] ?? 50) - (INSERTION_PRIORITY[b.block.type] ?? 50);
      if (priorityDiff !== 0) return priorityDiff;
      return (a.end - a.start) - (b.end - b.start);
    });

  const candidate = candidates[0];
  if (!candidate) return null;

  const replacementStart = Math.max(candidate.start, searchStart);
  const replacementEnd = replacementStart + 30;
  if (replacementEnd > Math.min(candidate.end, searchEnd)) return null;

  const next = sorted.map((block, index) => {
    if (index !== candidate.index) return block;
    return buildCallBlock(options, replacementStart, replacementEnd, sequence, `Dial minimum enforcement — replaced ${block.label} with a mandatory call block.`);
  });

  return {
    blocks: sortBlocks(next),
    log: `Replaced ${candidate.block.label} with a mandatory call block at ${fromMinutes(replacementStart)}–${fromMinutes(replacementEnd)}.`,
  };
}

export function ensureMinimumCallBlocks<T extends GuaranteePlanBlock>(
  blocks: T[],
  options: EnsureMinimumCallBlocksOptions<T>,
): EnsureMinimumCallBlocksResult<T> {
  const searchStart = Math.max(WORK_START_MINUTES, options.searchStartMinutes ?? WORK_START_MINUTES);
  const searchEnd = Math.min(WORK_END_MINUTES, options.searchEndMinutes ?? WORK_END_MINUTES);
  const logs: string[] = [];
  let next = sortBlocks(blocks);
  let safetyCounter = 0;

  while (searchEnd - searchStart >= 30) {
    const plannedDials = calculatePlannedDialMinimum(next);
    const remainingGap = DAILY_DIALS_MIN - plannedDials;
    if (remainingGap <= 0) break;

    const sequence = next.filter((block) => block.type === 'prospecting').length + 1;
    const insertion =
      tryInsertIntoGap(next, options, searchStart, searchEnd, sequence) ||
      trySplitBlock(next, options, searchStart, searchEnd, sequence) ||
      tryRepurposeBlock(next, options, searchStart, searchEnd, sequence);

    if (!insertion) {
      logs.push(`Unable to insert mandatory call block: no open 30-minute window or replaceable non-meeting block remained between ${fromMinutes(searchStart)} and ${fromMinutes(searchEnd)}.`);
      break;
    }

    next = insertion.blocks;
    logs.push(insertion.log);
    safetyCounter += 1;
    if (safetyCounter > 8) {
      logs.push('Stopped call-block enforcement after repeated insertion attempts.');
      break;
    }
  }

  logs.forEach((message) => options.onLog?.(message));
  const plannedDials = calculatePlannedDialMinimum(next);
  const unmetBlocks = Math.max(0, Math.ceil((DAILY_DIALS_MIN - plannedDials) / DIALS_PER_30_MIN));

  return {
    blocks: next,
    logs,
    insertedBlocks: Math.max(0, Math.ceil((plannedDials - calculatePlannedDialMinimum(blocks)) / DIALS_PER_30_MIN)),
    unmetBlocks,
    plannedDials,
  };
}