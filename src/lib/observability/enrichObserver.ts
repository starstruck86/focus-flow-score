/**
 * Enrichment lifecycle observer — adds telemetry around enrichment dispatch/invoke.
 *
 * This module provides wrapper functions that record telemetry events
 * before/after existing enrichment calls. It does NOT replace any existing functions.
 *
 * IMPORTANT: Telemetry is session-local, in-memory, non-persistent, best-effort.
 *
 * Usage: import these wrappers in places that dispatch enrichment work.
 * Or call `recordEnrichmentEvent()` directly from existing code paths.
 */

import { recordTelemetryEvent, type TelemetryEventType } from './telemetry';

export interface EnrichmentObservation {
  resourceId?: string;
  resourceIds?: string[];
  jobId?: string;
  mode?: string;
  entryPoint?: string;
  functionInvoked?: string;
  status?: string;
  resultShape?: string;
  error?: string;
  retrySignal?: boolean;
  continuationSignal?: boolean;
  durationMs?: number;
}

/** Record an enrichment lifecycle event. Never throws. */
export function recordEnrichmentEvent(
  type: TelemetryEventType,
  observation: EnrichmentObservation,
): void {
  try {
    recordTelemetryEvent(type, {
      resourceId: observation.resourceId,
      resourceCount: observation.resourceIds?.length,
      jobId: observation.jobId,
      mode: observation.mode,
      entryPoint: observation.entryPoint,
      functionInvoked: observation.functionInvoked,
      status: observation.status,
      resultShape: observation.resultShape,
      error: observation.error,
      retrySignal: observation.retrySignal,
      continuationSignal: observation.continuationSignal,
      durationMs: observation.durationMs,
    });
  } catch {
    // Never throw from telemetry
  }
}

/** Record an edge function invocation event. Never throws. */
export function recordFnInvocation(params: {
  functionName: string;
  /** Only set if auth status is explicitly known */
  authenticated?: boolean;
  serviceRole?: boolean;
  outcome: 'success' | 'error' | 'timeout';
  statusCode?: number;
  durationMs?: number;
  traceId?: string;
  errorMessage?: string;
}): void {
  try {
    const type: TelemetryEventType = params.outcome === 'success' ? 'fn:result' : 'fn:error';
    recordTelemetryEvent(type, {
      functionName: params.functionName,
      ...(params.authenticated !== undefined ? { authenticated: params.authenticated } : {}),
      ...(params.serviceRole ? { serviceRole: true } : {}),
      outcome: params.outcome,
      statusCode: params.statusCode,
      durationMs: params.durationMs,
      traceId: params.traceId,
      errorMessage: params.errorMessage,
    });
  } catch {
    // Never throw from telemetry
  }
}
