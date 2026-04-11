/**
 * Shared observability telemetry — lightweight, additive-only instrumentation.
 *
 * Phase 1: Safe Stabilization Through Observability Only.
 *
 * IMPORTANT: This telemetry is SESSION-LOCAL, IN-MEMORY, NON-PERSISTENT,
 * and BEST-EFFORT. Events are lost on page refresh. No data leaves the
 * browser. This is purely for live debugging and inspection.
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
  | 'job:removed_from_store'
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

const SENSITIVE_KEYS = ['token', 'access_token', 'refresh_token', 'apikey', 'api_key', 'secret', 'password', 'authorization'];

/** Recursively redact known sensitive field names from data */
function redact(value: unknown, depth = 0): unknown {
  // Guard against infinite recursion
  if (depth > 6) return '[depth_limit]';

  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;

  if (typeof value === 'string') {
    return value.length > 500
      ? value.slice(0, 200) + `...[truncated ${value.length} chars]`
      : value;
  }

  if (Array.isArray(value)) {
    return value.map(item => redact(item, depth + 1));
  }

  if (typeof value === 'object') {
    const safe: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        safe[key] = '[REDACTED]';
      } else {
        safe[key] = redact(v, depth + 1);
      }
    }
    return safe;
  }

  return String(value);
}

/** Record a telemetry event. Never throws. */
export function recordTelemetryEvent(type: TelemetryEventType, data: Record<string, unknown> = {}): void {
  if (!enabled) return;
  try {
    const event: TelemetryEvent = {
      type,
      ts: Date.now(),
      data: redact(data) as Record<string, unknown>,
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

/** Expose on window for console debugging — dev mode only */
if (typeof window !== 'undefined' && import.meta.env.DEV) {
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
