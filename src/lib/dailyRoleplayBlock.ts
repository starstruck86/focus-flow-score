/**
 * Daily Roleplay Block
 *
 * Configuration, scheduling, and tracking for the daily Dave-led
 * roleplay forcing function in the morning game plan.
 */

// ── Configuration ──────────────────────────────────────────

const CONFIG_KEY = 'daily-roleplay-config';
const TRACKING_KEY = 'daily-roleplay-tracking';

export interface RoleplayBlockConfig {
  enabled: boolean;
  preferredTimeWindowMorning: { start: string; end: string };
  durationMinutes: number;
  defaultScenarioType: string;
  defaultPersona: string;
  defaultIndustry: string;
  requireStartConfirmation: boolean;
}

const DEFAULT_CONFIG: RoleplayBlockConfig = {
  enabled: true,
  preferredTimeWindowMorning: { start: '08:00', end: '10:00' },
  durationMinutes: 20,
  defaultScenarioType: 'cold_call',
  defaultPersona: 'Director of Marketing',
  defaultIndustry: 'SaaS / Technology',
  requireStartConfirmation: true,
};

export function getRoleplayBlockConfig(): RoleplayBlockConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return { ...DEFAULT_CONFIG };
}

export function updateRoleplayBlockConfig(patch: Partial<RoleplayBlockConfig>): RoleplayBlockConfig {
  const current = getRoleplayBlockConfig();
  const updated = { ...current, ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(updated));
  return updated;
}

// ── Tracking ───────────────────────────────────────────────

export type RoleplayBlockStatus = 'scheduled' | 'started' | 'completed' | 'skipped' | 'rescheduled' | 'missed';

export type RoleplayCompletionTiming =
  | 'completed_before_first_action'
  | 'completed_after_first_action'
  | 'skipped'
  | 'missed';

export interface RoleplayBlockEvent {
  date: string;
  status: RoleplayBlockStatus;
  scenarioType: string;
  persona: string;
  industry: string;
  durationUsed?: number;
  startedAt?: string;
  completedAt?: string;
  completionTiming?: RoleplayCompletionTiming;
  timestamp: number;
}

function loadTracking(): RoleplayBlockEvent[] {
  try { return JSON.parse(localStorage.getItem(TRACKING_KEY) || '[]'); } catch { return []; }
}

function saveTracking(events: RoleplayBlockEvent[]) {
  // Keep last 90 days
  const cutoff = Date.now() - 90 * 24 * 3600 * 1000;
  const trimmed = events.filter(e => e.timestamp > cutoff);
  localStorage.setItem(TRACKING_KEY, JSON.stringify(trimmed));
}

export function recordRoleplayBlockEvent(event: Omit<RoleplayBlockEvent, 'timestamp'>): void {
  const events = loadTracking();
  events.push({ ...event, timestamp: Date.now() });
  saveTracking(events);
}

export function getTodayRoleplayStatus(date: string): RoleplayBlockEvent | null {
  const events = loadTracking();
  const today = events.filter(e => e.date === date);
  // Return latest event for today
  return today.length > 0 ? today[today.length - 1] : null;
}

export function getRoleplayStreak(): number {
  const events = loadTracking();
  const completedDates = new Set(events.filter(e => e.status === 'completed').map(e => e.date));
  let streak = 0;
  const d = new Date();
  // Check backwards from yesterday
  d.setDate(d.getDate() - 1);
  while (true) {
    const day = d.getDay();
    if (day === 0 || day === 6) { d.setDate(d.getDate() - 1); continue; } // skip weekends
    const dateStr = d.toISOString().split('T')[0];
    if (completedDates.has(dateStr)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

// ── Scheduling ─────────────────────────────────────────────

interface ScheduleBlock {
  start_time: string;
  end_time: string;
  type: string;
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

function toTime(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}

/**
 * Find the best morning slot for the roleplay block that doesn't
 * overlap any existing calendar/meeting blocks.
 * Returns { start_time, end_time } or null if it can't fit.
 */
export function findRoleplaySlot(
  existingBlocks: ScheduleBlock[],
  config: RoleplayBlockConfig = getRoleplayBlockConfig(),
): { start_time: string; end_time: string } | null {
  if (!config.enabled) return null;

  const windowStart = toMinutes(config.preferredTimeWindowMorning.start);
  const windowEnd = toMinutes(config.preferredTimeWindowMorning.end);
  const duration = config.durationMinutes;

  // Get meetings/fixed blocks sorted by start time within the morning window
  const meetings = existingBlocks
    .filter(b => b.type === 'meeting')
    .map(b => ({ start: toMinutes(b.start_time), end: toMinutes(b.end_time) }))
    .filter(m => m.end > windowStart && m.start < windowEnd + 60) // allow slight overflow
    .sort((a, b) => a.start - b.start);

  // Try to fit in gaps
  let cursor = windowStart;
  for (const meeting of meetings) {
    if (cursor + duration <= meeting.start) {
      return { start_time: toTime(cursor), end_time: toTime(cursor + duration) };
    }
    cursor = Math.max(cursor, meeting.end);
  }

  // Try after last meeting in window
  if (cursor + duration <= windowEnd + 30) {
    return { start_time: toTime(cursor), end_time: toTime(cursor + duration) };
  }

  return null; // can't fit
}

/**
 * Create a roleplay TimeBlock for injection into the daily plan.
 */
export function createRoleplayBlock(config?: RoleplayBlockConfig) {
  const cfg = config || getRoleplayBlockConfig();
  return {
    label: '🎯 Dave Roleplay — Cold Call Practice',
    type: 'roleplay' as const,
    workstream: 'new_logo' as const,
    goals: [
      `Complete a ${cfg.durationMinutes}-minute ${cfg.defaultScenarioType.replace('_', ' ')} roleplay`,
      `Practice with ${cfg.defaultPersona} persona`,
    ],
    reasoning: `Daily roleplay forcing function — builds call muscle memory and sharpens objection handling before live calls.`,
  };
}

// ── Dave Confirmation Flow ─────────────────────────────────

export function buildDaveConfirmationPrompt(config?: RoleplayBlockConfig): string {
  const cfg = config || getRoleplayBlockConfig();
  return (
    `You've got a ${cfg.durationMinutes}-minute roleplay block. ` +
    `Default is a ${cfg.defaultScenarioType.replace('_', ' ')} with a ${cfg.defaultPersona} in ${cfg.defaultIndustry}. ` +
    `Want to keep that, or change the scenario, persona, or industry before we start?\n\n` +
    `IMPORTANT INSTRUCTION FOR DAVE: After the user confirms (says "keep", "go", "start", "let's do it", etc.) ` +
    `or requests changes, immediately proceed into the roleplay. Do NOT ask again. ` +
    `Stay in character as the buyer for the full session. ` +
    `When done, give a 2-sentence debrief with one coaching takeaway.`
  );
}

// ── Completion Timing Helper ──────────────────────────────

/**
 * Determine whether roleplay was completed before the first action block.
 * Action blocks = prospecting, build, prep (not meetings, breaks, admin).
 */
export function classifyCompletionTiming(
  completedAt: string | undefined,
  planBlocks: Array<{ start_time: string; type: string }>,
): RoleplayCompletionTiming {
  if (!completedAt) return 'missed';

  const ACTION_TYPES = new Set(['prospecting', 'build', 'prep', 'pipeline']);
  const firstAction = planBlocks
    .filter(b => ACTION_TYPES.has(b.type))
    .sort((a, b) => a.start_time.localeCompare(b.start_time))[0];

  if (!firstAction) return 'completed_before_first_action'; // no action blocks = definitely before

  const completedTime = new Date(completedAt);
  const [h, m] = firstAction.start_time.split(':').map(Number);
  const today = new Date(completedAt);
  today.setHours(h, m, 0, 0);

  return completedTime <= today ? 'completed_before_first_action' : 'completed_after_first_action';
}
