/**
 * Normalized error model for the entire application.
 * Every caught error should be mapped to an AppError before logging or display.
 */

export type ErrorCategory =
  | 'AUTH_ERROR'
  | 'NETWORK_ERROR'
  | 'FUNCTION_TIMEOUT'
  | 'FUNCTION_404'
  | 'FUNCTION_401'
  | 'INVALID_TRANSCRIPT'
  | 'CHUNK_TOO_LARGE'
  | 'MODEL_RESPONSE_INVALID'
  | 'DB_WRITE_FAILED'
  | 'RATE_LIMITED'
  | 'VALIDATION_ERROR'
  | 'UNKNOWN';

export type ErrorSource = 'frontend' | 'backend' | 'function';

export interface AppError {
  category: ErrorCategory;
  message: string;
  rawMessage: string;
  code: string | number | null;
  source: ErrorSource;
  functionName: string | null;
  componentName: string | null;
  route: string | null;
  traceId: string;
  timestamp: number;
  retryable: boolean;
  metadata: Record<string, unknown>;
}

// ── Trace ID ────────────────────────────────────────────────
let _counter = 0;
const _prefix = typeof crypto !== 'undefined'
  ? crypto.randomUUID().slice(0, 8)
  : Math.random().toString(36).slice(2, 10);

export function generateTraceId(): string {
  _counter++;
  return `${_prefix}-${Date.now().toString(36)}-${_counter.toString(36)}`;
}

// ── Builder ─────────────────────────────────────────────────
interface NormalizeOpts {
  error: unknown;
  source?: ErrorSource;
  functionName?: string | null;
  componentName?: string | null;
  route?: string | null;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export function normalizeError(opts: NormalizeOpts): AppError {
  const raw = opts.error;
  const rawMessage = raw instanceof Error ? raw.message : String(raw);
  const traceId = opts.traceId ?? generateTraceId();

  const { category, retryable, code } = classifyError(raw, rawMessage);

  return {
    category,
    message: friendlyMessage(category, rawMessage),
    rawMessage,
    code,
    source: opts.source ?? 'frontend',
    functionName: opts.functionName ?? null,
    componentName: opts.componentName ?? null,
    route: opts.route ?? (typeof window !== 'undefined' ? window.location.pathname : null),
    traceId,
    timestamp: Date.now(),
    retryable,
    metadata: opts.metadata ?? {},
  };
}

// ── Classification ──────────────────────────────────────────
function classifyError(
  raw: unknown,
  msg: string,
): { category: ErrorCategory; retryable: boolean; code: string | number | null } {
  const lower = msg.toLowerCase();

  // Auth
  if (lower.includes('not authenticated') || lower.includes('no active session') || lower.includes('jwt') || lower.includes('refresh_token') || lower.includes('sign in'))
    return { category: 'AUTH_ERROR', retryable: false, code: 401 };

  // Rate limit
  if ((lower.includes('rate') && lower.includes('limit')) || lower.includes('429') || lower.includes('concurrency'))
    return { category: 'RATE_LIMITED', retryable: true, code: 429 };

  // Supabase SDK transport error — "Failed to send a request to the Edge Function"
  // This is a transient network/connection issue, NOT an AI model error
  if (lower.includes('failed to send a request to the edge function') || lower.includes('relay error'))
    return { category: 'NETWORK_ERROR', retryable: true, code: 502 };

  // Network
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed'))
    return { category: 'NETWORK_ERROR', retryable: true, code: null };

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out') || lower.includes('aborted'))
    return { category: 'FUNCTION_TIMEOUT', retryable: true, code: 408 };

  // 404
  if (lower.includes('404') || (lower.includes('not found') && lower.includes('function')))
    return { category: 'FUNCTION_404', retryable: false, code: 404 };

  // 401 from function
  if (lower.includes('401') || lower.includes('unauthorized'))
    return { category: 'FUNCTION_401', retryable: false, code: 401 };

  // DB write
  if (lower.includes('insert') || lower.includes('violates') || lower.includes('duplicate key'))
    return { category: 'DB_WRITE_FAILED', retryable: false, code: null };

  // Quality validation from enrichment (NOT a generic "invalid input" error)
  if (lower.includes('quality validation failed') || lower.includes('quality gate'))
    return { category: 'VALIDATION_ERROR', retryable: true, code: 422 };

  // Generic validation
  if (lower.includes('invalid') || lower.includes('required') || lower.includes('validation'))
    return { category: 'VALIDATION_ERROR', retryable: false, code: 422 };

  // Model (must be AFTER the more specific checks above)
  if (lower.includes('model') || lower.includes('completion'))
    return { category: 'MODEL_RESPONSE_INVALID', retryable: true, code: 502 };

  // Extract HTTP status if present
  const statusMatch = msg.match(/\b([45]\d{2})\b/);
  const code = statusMatch ? parseInt(statusMatch[1]) : null;

  return { category: 'UNKNOWN', retryable: false, code };
}

function friendlyMessage(category: ErrorCategory, raw: string): string {
  switch (category) {
    case 'AUTH_ERROR': return 'Authentication failed. Please sign in again.';
    case 'NETWORK_ERROR': return 'Connection error — retrying automatically.';
    case 'FUNCTION_TIMEOUT': return 'The request timed out. Try again in a moment.';
    case 'FUNCTION_404': return 'Service not found. This may need a redeployment.';
    case 'FUNCTION_401': return 'Not authorized. Please sign in again.';
    case 'RATE_LIMITED': return 'Too many requests — wait a moment and retry.';
    case 'DB_WRITE_FAILED': return 'Failed to save data. Check for duplicates or missing fields.';
    case 'VALIDATION_ERROR': {
      // Surface quality validation details instead of generic message
      if (raw.toLowerCase().includes('quality validation failed')) {
        const detail = raw.replace(/^Quality validation failed:\s*/i, '');
        return `Content quality insufficient: ${detail.slice(0, 100)}`;
      }
      if (raw.toLowerCase().includes('quality gate')) {
        return raw.slice(0, 120);
      }
      return 'Invalid input. Please check your data and try again.';
    }
    case 'MODEL_RESPONSE_INVALID': return 'AI response was invalid. Try again.';
    default: return raw.length > 120 ? raw.slice(0, 117) + '…' : raw;
  }
}

// ── In-Memory Error Store (ring buffer) ─────────────────────
const MAX_STORED = 100;
const _errorStore: AppError[] = [];
const _listeners: Set<() => void> = new Set();
let _flushTimer: ReturnType<typeof setTimeout> | null = null;
const _pendingFlush: AppError[] = [];

export function recordError(err: AppError): void {
  _errorStore.push(err);
  if (_errorStore.length > MAX_STORED) _errorStore.shift();
  _listeners.forEach(fn => fn());

  // Queue for backend persistence (batched, fire-and-forget)
  _pendingFlush.push(err);
  if (!_flushTimer) {
    _flushTimer = setTimeout(() => flushErrors(), 5_000);
  }
}

/** Flush pending errors to the backend error_logs table */
async function flushErrors() {
  _flushTimer = null;
  if (_pendingFlush.length === 0) return;

  const batch = _pendingFlush.splice(0, _pendingFlush.length);

  try {
    // Dynamic import to avoid circular dependency
    const { supabase } = await import('@/integrations/supabase/client');
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return; // Can't persist without auth

    const rows = batch.map(e => ({
      user_id: user.id,
      trace_id: e.traceId,
      category: e.category,
      message: e.message,
      raw_message: e.rawMessage,
      code: e.code != null ? String(e.code) : null,
      source: e.source,
      function_name: e.functionName,
      component_name: e.componentName,
      route: e.route,
      retryable: e.retryable,
      metadata: e.metadata as Record<string, unknown> as any,
    }));

    await supabase.from('error_logs').insert(rows);
  } catch {
    // Silently fail — we don't want error logging to cause more errors
  }
}

export function getRecentErrors(): ReadonlyArray<AppError> {
  return _errorStore;
}

export function subscribeErrors(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function clearErrors(): void {
  _errorStore.length = 0;
  _listeners.forEach(fn => fn());
}
