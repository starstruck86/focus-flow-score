/**
 * Phase 2: Security Hardening — Telemetry Extensions
 *
 * Adds security-focused telemetry event types and helpers.
 * Non-throwing, non-blocking, additive only.
 * Does NOT change any existing behavior or block any requests.
 */

import { recordTelemetryEvent, type TelemetryEventType } from './telemetry';

// Extend telemetry types via declaration merging isn't possible
// with the union type pattern, so we cast safely below.

export type SecurityEventType =
  | 'fn:validation_warning'
  | 'fn:cross_user_detected'
  | 'fn:service_role_used'
  | 'fn:internal_path_used'
  | 'fn:missing_user_scope'
  | 'fn:oversized_payload';

/** Record a security-related telemetry event. Never throws. */
export function recordSecurityEvent(
  type: SecurityEventType,
  data: Record<string, unknown> = {},
): void {
  try {
    // Cast to base type — these events flow through the same buffer
    recordTelemetryEvent(type as unknown as TelemetryEventType, {
      ...data,
      _securityPhase: 2,
    });
  } catch {
    // Never throw from telemetry
  }
}

/**
 * Log-only validation helper for edge function request bodies.
 * Returns validation warnings but NEVER rejects the request.
 * Callers should proceed normally regardless of warnings.
 */
export function validateRequestShape(
  functionName: string,
  body: Record<string, unknown> | null | undefined,
  expectedFields: string[],
): string[] {
  const warnings: string[] = [];

  try {
    if (!body || typeof body !== 'object') {
      warnings.push('missing_or_invalid_body');
      recordSecurityEvent('fn:validation_warning', {
        functionName,
        warning: 'missing_or_invalid_body',
      });
      return warnings;
    }

    for (const field of expectedFields) {
      if (!(field in body) || body[field] === undefined || body[field] === null) {
        warnings.push(`missing_field:${field}`);
      }
    }

    // Check for oversized string fields (>100KB)
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string' && value.length > 100_000) {
        warnings.push(`oversized_field:${key}`);
        recordSecurityEvent('fn:oversized_payload', {
          functionName,
          field: key,
          size: value.length,
        });
      }
    }

    if (warnings.length > 0) {
      recordSecurityEvent('fn:validation_warning', {
        functionName,
        warnings,
        fieldCount: Object.keys(body).length,
      });
    }
  } catch {
    // Never throw from validation telemetry
  }

  return warnings;
}

/**
 * Detect and log potential cross-user access patterns.
 * Does NOT block — only observes and records.
 */
export function detectCrossUserAccess(
  functionName: string,
  callerUserId: string | null | undefined,
  targetUserId: string | null | undefined,
): boolean {
  try {
    if (!callerUserId && !targetUserId) {
      recordSecurityEvent('fn:missing_user_scope', {
        functionName,
        reason: 'no_user_id_in_request',
      });
      return false;
    }

    if (callerUserId && targetUserId && callerUserId !== targetUserId) {
      recordSecurityEvent('fn:cross_user_detected', {
        functionName,
        callerPresent: true,
        targetPresent: true,
        match: false,
      });
      return true;
    }
  } catch {
    // Never throw
  }

  return false;
}

/**
 * Log service-role usage for audit trail.
 * Does NOT block or change behavior.
 */
export function recordServiceRoleUsage(
  functionName: string,
  scope: 'single_user' | 'multi_user' | 'system',
  details?: Record<string, unknown>,
): void {
  try {
    recordSecurityEvent('fn:service_role_used', {
      functionName,
      scope,
      ...details,
    });
  } catch {
    // Never throw
  }
}

/**
 * Log internal execution path usage.
 */
export function recordInternalPathUsage(
  functionName: string,
  details?: Record<string, unknown>,
): void {
  try {
    recordSecurityEvent('fn:internal_path_used', {
      functionName,
      ...details,
    });
  } catch {
    // Never throw
  }
}
