/**
 * Observability barrel — re-exports all observability utilities.
 *
 * All telemetry in this module is SESSION-LOCAL, IN-MEMORY,
 * NON-PERSISTENT, and BEST-EFFORT.
 */
export { recordTelemetryEvent, getTelemetryEvents, getRecentEvents, getEventsByPrefix, getTelemetrySummary, clearTelemetryEvents } from './telemetry';
export { installJobObserver } from './jobObserver';
export { recordEnrichmentEvent, recordFnInvocation } from './enrichObserver';
