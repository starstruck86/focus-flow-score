/**
 * Capability Event Logger
 *
 * Tracks capability prompt interactions for learning and suppression.
 * Feature-flagged via ENABLE_CAPABILITY_AWARENESS.
 */

const CAPABILITY_EVENTS_KEY = 'capability-events-log';
const MAX_EVENTS = 200;

export type CapabilityEventType = 'shown' | 'accepted' | 'ignored' | 'used';

export interface CapabilityEvent {
  promptId: string;
  eventType: CapabilityEventType;
  contextType?: string;
  stage?: string;
  timestamp: number;
}

// ── Core API ───────────────────────────────────────────────

export function recordCapabilityEvent(event: Omit<CapabilityEvent, 'timestamp'>): void {
  const events = loadEvents();
  events.push({ ...event, timestamp: Date.now() });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  saveEvents(events);
}

export function getCapabilityEventHistory(windowMs: number = 30 * 24 * 3600 * 1000): CapabilityEvent[] {
  const cutoff = Date.now() - windowMs;
  return loadEvents().filter(e => e.timestamp > cutoff);
}

export function getCapabilityStats(windowMs?: number): {
  shown: number;
  accepted: number;
  ignored: number;
  used: number;
  acceptRate: number;
} {
  const events = getCapabilityEventHistory(windowMs);
  const shown = events.filter(e => e.eventType === 'shown').length;
  const accepted = events.filter(e => e.eventType === 'accepted').length;
  const ignored = events.filter(e => e.eventType === 'ignored').length;
  const used = events.filter(e => e.eventType === 'used').length;
  return {
    shown,
    accepted,
    ignored,
    used,
    acceptRate: shown > 0 ? (accepted + used) / shown : 0,
  };
}

// ── Storage ────────────────────────────────────────────────

function loadEvents(): CapabilityEvent[] {
  try { return JSON.parse(localStorage.getItem(CAPABILITY_EVENTS_KEY) || '[]'); } catch { return []; }
}

function saveEvents(events: CapabilityEvent[]): void {
  try { localStorage.setItem(CAPABILITY_EVENTS_KEY, JSON.stringify(events)); } catch {}
}
