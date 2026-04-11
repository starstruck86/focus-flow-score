/**
 * Phase 3: Enforcement telemetry for edge functions.
 *
 * Session-local, non-persistent, best-effort structured logging
 * for protected-path enforcement events.
 *
 * Never throws. Never blocks. Never changes behavior.
 */

type EnforcementEventType =
  | 'fn:protected_path_used'
  | 'fn:legacy_path_used'
  | 'fn:scope_enforced'
  | 'fn:auth_enforced'
  | 'fn:request_rejected_protected_path'
  | 'fn:legacy_deprecation_warning';

interface EnforcementLogEntry {
  _type: EnforcementEventType;
  _phase: 3;
  functionName: string;
  ts: string;
  [key: string]: unknown;
}

/** Redact known sensitive field names from a shallow object, recursively for nested objects. */
function redactDeep(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth > 3) return { '[depth_limit]': true };
  const SENSITIVE = ['token', 'access_token', 'refresh_token', 'apikey', 'api_key', 'secret', 'password', 'authorization', 'x-batch-key'];
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE.includes(key.toLowerCase())) {
      safe[key] = '[REDACTED]';
    } else if (typeof value === 'string' && value.length > 500) {
      safe[key] = `[truncated:${value.length}chars]`;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      safe[key] = redactDeep(value as Record<string, unknown>, depth + 1);
    } else {
      safe[key] = value;
    }
  }
  return safe;
}

/**
 * Emit a structured enforcement telemetry log. Never throws.
 */
export function logEnforcementEvent(
  functionName: string,
  eventType: EnforcementEventType,
  details?: Record<string, unknown>,
): void {
  try {
    const entry: EnforcementLogEntry = {
      _type: eventType,
      _phase: 3,
      functionName,
      ts: new Date().toISOString(),
      ...(details ? redactDeep(details) : {}),
    };
    console.log(JSON.stringify(entry));
  } catch {
    // Never throw from telemetry
  }
}
