/**
 * Account Timeline — Lightweight event journal per account
 *
 * Separates current state (accountExecutionState) from historical events.
 * Persisted in localStorage, keyed by accountId.
 * Compact and safe even with missing older data.
 */

export type AccountEventType =
  | 'prepped'
  | 'attempted'
  | 'connected'
  | 'voicemail'
  | 'no_answer'
  | 'meeting_booked'
  | 'follow_up_needed'
  | 'not_now'
  | 'bad_fit'
  | 'carry_forward'
  | 'opportunity_created'
  | 'opportunity_updated'
  | 'state_transition'
  | 'roleplay_relevant';

export interface AccountTimelineEvent {
  id: string;
  accountId: string;
  accountName: string;
  eventType: AccountEventType;
  date: string;
  timestamp: string;
  loopId: string | null;
  blockId: string | null;
  notes: string | null;
  metadata: Record<string, any> | null;
}

// ── Persistence ────────────────────────────────────────────

const TIMELINE_KEY_PREFIX = 'account-timeline';
const MAX_EVENTS_PER_ACCOUNT = 100;

function timelineKey(accountId: string): string {
  return `${TIMELINE_KEY_PREFIX}-${accountId}`;
}

export function loadTimeline(accountId: string): AccountTimelineEvent[] {
  try {
    const raw = localStorage.getItem(timelineKey(accountId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(timelineKey(accountId));
      return [];
    }
    return parsed;
  } catch {
    localStorage.removeItem(timelineKey(accountId));
    return [];
  }
}

function saveTimeline(accountId: string, events: AccountTimelineEvent[]): void {
  // Keep most recent N events
  const trimmed = events.slice(-MAX_EVENTS_PER_ACCOUNT);
  localStorage.setItem(timelineKey(accountId), JSON.stringify(trimmed));
}

// ── Write Helpers ──────────────────────────────────────────

let _counter = 0;
function generateEventId(): string {
  return `evt-${Date.now()}-${++_counter}`;
}

export function appendTimelineEvent(
  accountId: string,
  accountName: string,
  eventType: AccountEventType,
  options?: {
    date?: string;
    loopId?: string | null;
    blockId?: string | null;
    notes?: string | null;
    metadata?: Record<string, any> | null;
  },
): AccountTimelineEvent {
  const event: AccountTimelineEvent = {
    id: generateEventId(),
    accountId,
    accountName,
    eventType,
    date: options?.date || new Date().toISOString().split('T')[0],
    timestamp: new Date().toISOString(),
    loopId: options?.loopId ?? null,
    blockId: options?.blockId ?? null,
    notes: options?.notes ?? null,
    metadata: options?.metadata ?? null,
  };

  const existing = loadTimeline(accountId);
  existing.push(event);
  saveTimeline(accountId, existing);
  return event;
}

// ── Read Helpers ───────────────────────────────────────────

export function getRecentEvents(
  accountId: string,
  limit: number = 10,
): AccountTimelineEvent[] {
  return loadTimeline(accountId).slice(-limit);
}

export function getEventsByDate(
  accountId: string,
  date: string,
): AccountTimelineEvent[] {
  return loadTimeline(accountId).filter(e => e.date === date);
}

export function getEventsByType(
  accountId: string,
  eventType: AccountEventType,
): AccountTimelineEvent[] {
  return loadTimeline(accountId).filter(e => e.eventType === eventType);
}

/** Get summary of recent event types for quick inspection */
export function getTimelineSummary(accountId: string, daysBack: number = 7): {
  totalEvents: number;
  eventTypeCounts: Record<string, number>;
  lastEventDate: string | null;
  lastEventType: AccountEventType | null;
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const events = loadTimeline(accountId).filter(e => e.date >= cutoffStr);
  const counts: Record<string, number> = {};
  for (const e of events) {
    counts[e.eventType] = (counts[e.eventType] || 0) + 1;
  }

  const last = events.length > 0 ? events[events.length - 1] : null;
  return {
    totalEvents: events.length,
    eventTypeCounts: counts,
    lastEventDate: last?.date || null,
    lastEventType: last?.eventType || null,
  };
}
