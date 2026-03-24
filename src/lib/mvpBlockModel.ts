/**
 * MVP Block Model — single source of truth for block definitions,
 * dial targets, and capacity calculations.
 *
 * Every block type has a Minimum Viable Output (MVP) that defines
 * "done" independent of clock time.
 */

// ── Working hours ──
export const WORK_START_MINUTES = 9 * 60;  // 9:00 AM
export const WORK_END_MINUTES = 17 * 60;   // 5:00 PM
export const WORK_HOURS = (WORK_END_MINUTES - WORK_START_MINUTES) / 60; // 8

// ── Dial targets ──
export const DAILY_DIALS_MIN = 20;
export const DAILY_DIALS_TARGET = 40;
export const WEEKLY_DIALS_MIN = 100;
export const WEEKLY_DIALS_TARGET = 200;

// ── MVP definitions per block type ──
export interface BlockMVP {
  label: string;
  type: string;
  defaultMinutes: number;
  minMinutes: number;
  mvp: Record<string, number>;
  targets: Record<string, number>;
  description: string;
}

export const BLOCK_MVPS: Record<string, BlockMVP> = {
  call_block: {
    label: 'Call Block',
    type: 'prospecting',
    defaultMinutes: 30,
    minMinutes: 30,
    mvp: { dials: 10 },
    targets: { dials: 15 },
    description: 'MVP: 10 dials. Target: 15–20 dials.',
  },
  new_logo_build: {
    label: 'New Logo Build',
    type: 'build',
    defaultMinutes: 60,
    minMinutes: 30,
    mvp: { accounts: 2, contacts: 6 },
    targets: { accounts: 3, contacts: 8 },
    description: 'MVP: 2–3 accounts, 6–8 contacts sourced.',
  },
  quick_build: {
    label: 'Quick Build',
    type: 'build',
    defaultMinutes: 30,
    minMinutes: 30,
    mvp: { accounts: 1, contacts: 3 },
    targets: { accounts: 1, contacts: 3 },
    description: 'MVP: 1 account, 3 contacts.',
  },
  admin: {
    label: 'Admin / Follow-up',
    type: 'admin',
    defaultMinutes: 30,
    minMinutes: 15,
    mvp: { responses_logged: 1, next_steps_updated: 1 },
    targets: { responses_logged: 1, next_steps_updated: 1 },
    description: 'MVP: all responses logged, next steps updated.',
  },
  prep: {
    label: 'Prep Block',
    type: 'prep',
    defaultMinutes: 30,
    minMinutes: 15,
    mvp: { accounts_prepped: 2 },
    targets: { accounts_prepped: 3 },
    description: 'MVP: accounts selected, call notes prepared, outreach ready.',
  },
};

// ── Dial capacity calculator ──

export interface DialCapacity {
  plannedDials: number;
  dailyMin: number;
  dailyTarget: number;
  status: 'on_track' | 'below_minimum' | 'above_target';
  gap: number; // negative = surplus, positive = shortfall vs minimum
  callBlockCount: number;
  suggestedAdditionalBlocks: number;
}

/** MVP dial rate: 10 dials per 30 minutes (not 1 per 2 min) */
export const DIALS_PER_30_MIN = 10;
export const DIALS_TARGET_PER_30_MIN = 15;

export function calculateDialCapacity(blocks: Array<{ type: string; start_time: string; end_time: string; actual_dials?: number }>): DialCapacity {
  let plannedDialsMin = 0;
  let plannedDialsTarget = 0;
  let callBlockCount = 0;

  for (const b of blocks) {
    if (b.type === 'prospecting') {
      callBlockCount++;
      const [sh, sm] = b.start_time.split(':').map(Number);
      const [eh, em] = b.end_time.split(':').map(Number);
      const durMin = (eh * 60 + em) - (sh * 60 + sm);
      const halfHours = durMin / 30;
      // MVP: 10 dials per 30 min; Target: 15 dials per 30 min
      plannedDialsMin += Math.round(halfHours * DIALS_PER_30_MIN);
      plannedDialsTarget += Math.round(halfHours * DIALS_TARGET_PER_30_MIN);
    }
  }

  const plannedDials = plannedDialsMin; // baseline for gap calc

  const gap = DAILY_DIALS_MIN - plannedDials;
  const status: DialCapacity['status'] =
    plannedDials >= DAILY_DIALS_TARGET ? 'above_target' :
    plannedDials >= DAILY_DIALS_MIN ? 'on_track' :
    'below_minimum';

  // Each 30-min call block adds ~15 dials
  const suggestedAdditionalBlocks = gap > 0 ? Math.ceil(gap / 15) : 0;

  return {
    plannedDials,
    dailyMin: DAILY_DIALS_MIN,
    dailyTarget: DAILY_DIALS_TARGET,
    status,
    gap,
    callBlockCount,
    suggestedAdditionalBlocks,
  };
}

/** Get actual dials from blocks */
export function getActualDials(blocks: Array<{ type: string; actual_dials?: number }>): number {
  return blocks
    .filter(b => b.type === 'prospecting')
    .reduce((s, b) => s + (b.actual_dials || 0), 0);
}

/** Format dial status for display */
export function formatDialStatus(capacity: DialCapacity, actualDials: number): string {
  if (actualDials >= capacity.dailyTarget) return `${actualDials} dials — above target ✓`;
  if (actualDials >= capacity.dailyMin) return `${actualDials}/${capacity.dailyTarget} dials — on track`;
  const remaining = capacity.dailyMin - actualDials;
  return `${actualDials}/${capacity.dailyMin} dials — need ${remaining} more`;
}

/** Clamp a time in minutes to working hours */
export function clampToWorkingHours(minutes: number): number {
  return Math.max(WORK_START_MINUTES, Math.min(WORK_END_MINUTES, minutes));
}

/** Check if a block falls outside working hours */
export function isOutsideWorkingHours(startTime: string, endTime: string): boolean {
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const startMin = sh * 60 + sm;
  const endMin = eh * 60 + em;
  return startMin < WORK_START_MINUTES || endMin > WORK_END_MINUTES;
}
