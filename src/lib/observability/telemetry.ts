/**
 * Shared observability telemetry — lightweight, additive-only instrumentation.
 *
 * Phase 1: Safe Stabilization Through Observability Only.
 *
 * This module provides a structured event buffer for inspecting job lifecycle,
 * enrichment lifecycle, and edge function invocation patterns WITHOUT changing
 * any existing behavior.
 *
 * All functions are defensive, never throw, and safe to call in any context.
 */

export type TelemetryEventType =
  // Job lifecycle
  | 'job:created'
  | 'job:queued'
  | 'job:started'
  | 'job:progress'
  | 'job:retried'
  | 'job:continued'
  | 'job:completed'
  | 'job:failed'
  | 'job:cancelled'
  | 'job:stuck'
  // Enrichment lifecycle
  | 'enrich:dispatched'
  | 'enrich:invoke_start'
  | 'enrich:invoke_result'
  | 'enrich:retry'
  | 'enrich:terminal'
  // Edge function invocation
  | 'fn:invoke'
  | 'fn:result'
  | 'fn:error'
  // State transitions
  | 'state:transition'
  | 'state:rehydrate'
  | 'state:sync';

export interface TelemetryEvent {
  type: TelemetryEventType;
  ts: number;
  /** Safe subset of contextual data — never includes secrets/tokens */
  data: Record<string, unknown>;
}

const MAX_BUFFER_SIZE = 500;
const buffer: TelemetryEvent[] = [];
let enabled = true;

/** Safely redact known sensitive field names from data */
function redact(data: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE_KEYS = ['token', 'access_token', 'refresh_token', 'apikey', 'api_key', 'secret', 'password', 'authorization'];
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      safe[key] = value.slice(0, 200) + `...[truncated ${value.length} chars]`;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

/** Record a telemetry event. Never throws. */
export function recordTelemetryEvent(type: TelemetryEventType, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    const event: TelemetryEvent = {
      type,
      ts: Date.now(),
      data: redact(data),
    };
    buffer.push(event);
    // Trim oldest if over capacity
    if (buffer.length > MAX_BUFFER_SIZE) {
      buffer.splice(0, buffer.length - MAX_BUFFER_SIZE);
    }
  } catch {
    // Never throw from telemetry
  }
}

/** Get all buffered events (read-only snapshot) */
export function getTelemetryEvents(): readonly TelemetryEvent[] {
  return [...buffer];
}

/** Get events filtered by type prefix */
export function getEventsByPrefix(prefix: string): TelemetryEvent[] {
  return buffer.filter(e => e.type.startsWith(prefix));
}

/** Get recent events (last N) */
export function getRecentEvents(count = 50): TelemetryEvent[] {
  return buffer.slice(-count);
}

/** Clear all events */
export function clearTelemetryEvents(): void {
  buffer.length = 0;
}

/** Disable telemetry collection */
export function disableTelemetry(): void {
  enabled = false;
}

/** Enable telemetry collection */
export function enableTelemetry(): void {
  enabled = true;
}

/** Get summary counts by event type */
export function getTelemetrySummary(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of buffer) {
    counts[event.type] = (counts[event.type] ?? 0) + 1;
  }
  return counts;
}

/** Expose on window for console debugging */
if (typeof window !== 'undefined') {
  (window as any).__telemetry = {
    getEvents: getTelemetryEvents,
    getRecent: getRecentEvents,
    getSummary: getTelemetrySummary,
    getByPrefix: getEventsByPrefix,
    clear: clearTelemetryEvents,
    disable: disableTelemetry,
    enable: enableTelemetry,
  };
}
