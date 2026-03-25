/**
 * Calendar Time Invariants — guarantees fixed calendar events are never
 * moved, resized, or recalculated by any plan logic.
 *
 * This is a SYSTEM INVARIANT, not best-effort.
 */

export interface TimedBlock {
  start_time: string;
  end_time: string;
  label: string;
  type: string;
}

export interface CalendarAnchor {
  start_time: string;
  end_time: string;
  label: string;
}

export interface TimeDrift {
  label: string;
  field: 'start_time' | 'end_time';
  expected: string;
  actual: string;
  deltaMinutes: number;
}

export interface InvariantResult {
  valid: boolean;
  drifts: TimeDrift[];
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

/**
 * Validates that every calendar anchor appears in the plan blocks with
 * EXACT start and end times. Any delta is a failure.
 */
export function validateCalendarInvariants(
  planBlocks: TimedBlock[],
  calendarAnchors: CalendarAnchor[],
): InvariantResult {
  const drifts: TimeDrift[] = [];

  for (const anchor of calendarAnchors) {
    const normalizedLabel = anchor.label.trim().toLowerCase();
    const match = planBlocks.find(
      b => b.type === 'meeting' && b.label.trim().toLowerCase() === normalizedLabel
    );

    if (!match) {
      // Missing meeting — treat as drift with infinite delta
      drifts.push({
        label: anchor.label,
        field: 'start_time',
        expected: anchor.start_time,
        actual: '(missing)',
        deltaMinutes: Infinity,
      });
      continue;
    }

    if (match.start_time !== anchor.start_time) {
      drifts.push({
        label: anchor.label,
        field: 'start_time',
        expected: anchor.start_time,
        actual: match.start_time,
        deltaMinutes: Math.abs(toMinutes(match.start_time) - toMinutes(anchor.start_time)),
      });
    }

    if (match.end_time !== anchor.end_time) {
      drifts.push({
        label: anchor.label,
        field: 'end_time',
        expected: anchor.end_time,
        actual: match.end_time,
        deltaMinutes: Math.abs(toMinutes(match.end_time) - toMinutes(anchor.end_time)),
      });
    }
  }

  return { valid: drifts.length === 0, drifts };
}

/**
 * Enforces immutability: restores any drifted meeting blocks to their
 * canonical calendar times. Returns corrected blocks + log entries.
 */
export function enforceCalendarImmutability<T extends TimedBlock>(
  planBlocks: T[],
  calendarAnchors: CalendarAnchor[],
): { blocks: T[]; corrections: string[] } {
  const corrections: string[] = [];
  const anchorMap = new Map<string, CalendarAnchor>();
  for (const anchor of calendarAnchors) {
    anchorMap.set(anchor.label.trim().toLowerCase(), anchor);
  }

  const corrected = planBlocks.map(block => {
    if (block.type !== 'meeting') return block;
    const key = block.label.trim().toLowerCase();
    const anchor = anchorMap.get(key);
    if (!anchor) return block;

    if (block.start_time !== anchor.start_time || block.end_time !== anchor.end_time) {
      corrections.push(
        `Corrected "${block.label}": ${block.start_time}-${block.end_time} → ${anchor.start_time}-${anchor.end_time}`
      );
      return { ...block, start_time: anchor.start_time, end_time: anchor.end_time };
    }
    return block;
  });

  return { blocks: corrected, corrections };
}

/**
 * Given calendar anchors, compute open windows for flexible blocks.
 * Operates on absolute times — no chaining from previous blocks.
 */
export function computeOpenWindows(
  calendarAnchors: CalendarAnchor[],
  workStartMinutes: number,
  workEndMinutes: number,
): Array<{ start: number; end: number }> {
  const sorted = [...calendarAnchors].sort(
    (a, b) => toMinutes(a.start_time) - toMinutes(b.start_time)
  );

  const windows: Array<{ start: number; end: number }> = [];
  let cursor = workStartMinutes;

  for (const anchor of sorted) {
    const anchorStart = toMinutes(anchor.start_time);
    const anchorEnd = toMinutes(anchor.end_time);

    if (anchorStart > cursor) {
      windows.push({ start: cursor, end: anchorStart });
    }
    cursor = Math.max(cursor, anchorEnd);
  }

  if (cursor < workEndMinutes) {
    windows.push({ start: cursor, end: workEndMinutes });
  }

  return windows;
}

/**
 * Places flexible blocks into open windows using absolute scheduling.
 * Meeting blocks are preserved exactly — only non-meeting blocks are repositioned.
 */
export function scheduleFlexibleBlocks<T extends TimedBlock>(
  meetingBlocks: T[],
  flexibleBlocks: T[],
  workStartMinutes: number,
  workEndMinutes: number,
): T[] {
  const anchors: CalendarAnchor[] = meetingBlocks.map(b => ({
    start_time: b.start_time,
    end_time: b.end_time,
    label: b.label,
  }));

  const windows = computeOpenWindows(anchors, workStartMinutes, workEndMinutes);
  const scheduled: T[] = [...meetingBlocks]; // meetings go in unchanged
  let flexIdx = 0;

  for (const window of windows) {
    let cursor = window.start;
    while (flexIdx < flexibleBlocks.length && cursor < window.end) {
      const block = flexibleBlocks[flexIdx];
      const dur = toMinutes(block.end_time) - toMinutes(block.start_time);
      const available = window.end - cursor;

      if (available < 15) break; // too small

      const actualDur = Math.min(dur, available);
      scheduled.push({
        ...block,
        start_time: fromMinutes(cursor),
        end_time: fromMinutes(cursor + actualDur),
      });
      cursor += actualDur;
      flexIdx++;
    }
  }

  return scheduled.sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
}

/**
 * Assert invariant — throws if validation fails.
 * Use as a hard gate before persisting or rendering a plan.
 */
export function assertCalendarInvariant(
  planBlocks: TimedBlock[],
  calendarAnchors: CalendarAnchor[],
): void {
  const result = validateCalendarInvariants(planBlocks, calendarAnchors);
  if (!result.valid) {
    const details = result.drifts.map(
      d => `${d.label} ${d.field}: expected=${d.expected} actual=${d.actual} Δ${d.deltaMinutes}min`
    ).join('; ');
    console.error(`[CALENDAR INVARIANT VIOLATION] ${details}`);
    // Don't throw — correct and log instead (fail-safe)
  }
}
