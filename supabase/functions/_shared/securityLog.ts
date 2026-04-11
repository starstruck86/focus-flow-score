/**
 * Phase 2: Server-side security telemetry for edge functions.
 *
 * Lightweight, non-throwing, log-only helpers for security observability.
 * These emit structured console.log JSON so they appear in edge function logs
 * and can be queried via the analytics/logging tools.
 *
 * SESSION-LOCAL, NON-PERSISTENT, BEST-EFFORT.
 * Does NOT change behavior, block requests, or throw errors.
 */

interface SecurityLogEntry {
  _type: string;
  _phase: 2;
  functionName: string;
  ts: string;
  [key: string]: unknown;
}

/** Emit a structured security telemetry log. Never throws. */
function emitSecurityLog(entry: SecurityLogEntry): void {
  try {
    console.log(JSON.stringify(entry));
  } catch {
    // Never throw from telemetry
  }
}

/** Redact known sensitive field names from a shallow object. */
function redactShallow(obj: Record<string, unknown>): Record<string, unknown> {
  const SENSITIVE = ['token', 'access_token', 'refresh_token', 'apikey', 'api_key', 'secret', 'password', 'authorization', 'x-batch-key'];
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE.includes(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      safe[key] = `[truncated:${value.length}chars]`;
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Log service-role usage. Call when a service-role client is created/used.
 * Does NOT block or change behavior.
 */
export function logServiceRoleUsage(
  functionName: string,
  scope: 'single_user' | 'multi_user' | 'system',
  details?: Record<string, unknown>,
): void {
  emitSecurityLog({
    _type: 'fn:service_role_used',
    _phase: 2,
    functionName,
    ts: new Date().toISOString(),
    scope,
    ...(details ? redactShallow(details) : {}),
  });
}

/**
 * Log when a request has no user scope (no userId resolved).
 */
export function logMissingUserScope(
  functionName: string,
  details?: Record<string, unknown>,
): void {
  emitSecurityLog({
    _type: 'fn:missing_user_scope',
    _phase: 2,
    functionName,
    ts: new Date().toISOString(),
    ...(details ? redactShallow(details) : {}),
  });
}

/**
 * Log cross-user access detection (caller != target).
 * Does NOT block the request.
 */
export function logCrossUserAccess(
  functionName: string,
  callerUserId: string | null,
  targetUserId: string | null,
  details?: Record<string, unknown>,
): void {
  if (callerUserId && targetUserId && callerUserId !== targetUserId) {
    emitSecurityLog({
      _type: 'fn:cross_user_detected',
      _phase: 2,
      functionName,
      ts: new Date().toISOString(),
      callerPresent: true,
      targetPresent: true,
      match: false,
      ...(details ? redactShallow(details) : {}),
    });
  }
}

/**
 * Log-only request shape validation. Returns warnings but NEVER rejects.
 */
export function logValidationWarnings(
  functionName: string,
  body: Record<string, unknown> | null | undefined,
  expectedFields: string[],
): string[] {
  const warnings: string[] = [];
  try {
    if (!body || typeof body !== 'object') {
      warnings.push('missing_or_invalid_body');
    } else {
      for (const field of expectedFields) {
        if (!(field in body) || body[field] === undefined || body[field] === null) {
          warnings.push(`missing_field:${field}`);
        }
      }
      // Detect oversized string fields (>200KB)
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === 'string' && value.length > 200_000) {
          warnings.push(`oversized_field:${key}:${value.length}`);
        }
      }
    }
    if (warnings.length > 0) {
      emitSecurityLog({
        _type: 'fn:validation_warning',
        _phase: 2,
        functionName,
        ts: new Date().toISOString(),
        warnings,
      });
    }
  } catch {
    // Never throw
  }
  return warnings;
}

/**
 * Log auth method used for a request.
 */
export function logAuthMethod(
  functionName: string,
  method: 'jwt' | 'x-batch-key' | 'x-api-key' | 'service-role-continuation' | 'none' | 'unknown',
  details?: Record<string, unknown>,
): void {
  emitSecurityLog({
    _type: 'fn:auth_method',
    _phase: 2,
    functionName,
    ts: new Date().toISOString(),
    method,
    ...(details ? redactShallow(details) : {}),
  });
}
