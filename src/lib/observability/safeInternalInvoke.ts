/**
 * Phase 2: Internal Execution Path (Parallel, Not Replacement)
 *
 * Provides a safe internal invocation wrapper that can be used
 * alongside existing public paths. Does NOT replace anything.
 *
 * Safe-mode flags:
 *   strictValidation?: boolean — enables validation warnings (log-only, never blocks)
 *   internalExecution?: boolean — marks invocation as internal for telemetry
 *
 * Default behavior is identical to trackedInvoke — no existing caller breaks.
 */

import { trackedInvoke } from '@/lib/trackedInvoke';
import type { AppError } from '@/lib/appError';
import {
  recordSecurityEvent,
  validateRequestShape,
  detectCrossUserAccess,
  recordServiceRoleUsage,
  recordInternalPathUsage,
} from './securityTelemetry';

export interface SafeInvokeOptions {
  /** Function name */
  functionName: string;
  /** Request body */
  body?: Record<string, unknown>;
  /** Expected required fields for validation (log-only) */
  expectedFields?: string[];
  /** Caller component name for attribution */
  componentName?: string;
  /** Caller's authenticated user ID (for cross-user detection) */
  callerUserId?: string;
  /** Target user ID in the request (for cross-user detection) */
  targetUserId?: string;

  // ── Safe-mode flags ──
  /** Enable request shape validation (log-only, never blocks) */
  strictValidation?: boolean;
  /** Mark this as an internal execution path for telemetry */
  internalExecution?: boolean;

  /** Timeout in ms */
  timeoutMs?: number;
  /** Trace ID override */
  traceId?: string;
}

export interface SafeInvokeResult<T = unknown> {
  data: T | null;
  error: AppError | null;
  traceId: string;
  attempts: number;
  /** Validation warnings (empty if strictValidation is off) */
  validationWarnings: string[];
  /** Whether cross-user access was detected */
  crossUserDetected: boolean;
}

/**
 * Safe internal invocation wrapper.
 *
 * Calls trackedInvoke underneath — behavior is IDENTICAL to the existing path.
 * Adds optional validation and cross-user detection (log-only, never blocks).
 */
export async function safeInternalInvoke<T = unknown>(
  opts: SafeInvokeOptions,
): Promise<SafeInvokeResult<T>> {
  let validationWarnings: string[] = [];
  let crossUserDetected = false;

  try {
    // ── Optional strict validation (log-only) ──
    if (opts.strictValidation && opts.expectedFields?.length) {
      validationWarnings = validateRequestShape(
        opts.functionName,
        opts.body ?? null,
        opts.expectedFields,
      );
    }

    // ── Cross-user detection (log-only) ──
    if (opts.callerUserId || opts.targetUserId) {
      crossUserDetected = detectCrossUserAccess(
        opts.functionName,
        opts.callerUserId,
        opts.targetUserId,
      );
    }

    // ── Internal path telemetry ──
    if (opts.internalExecution) {
      recordInternalPathUsage(opts.functionName, {
        componentName: opts.componentName,
        hasValidation: opts.strictValidation ?? false,
      });
    }
  } catch {
    // Never let telemetry errors affect the main path
  }

  // ── Delegate to existing trackedInvoke — no behavior change ──
  const result = await trackedInvoke<T>(opts.functionName, {
    body: opts.body,
    componentName: opts.componentName,
    traceId: opts.traceId,
    timeoutMs: opts.timeoutMs,
  });

  return {
    ...result,
    validationWarnings,
    crossUserDetected,
  };
}
