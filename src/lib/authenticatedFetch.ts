/**
 * Shared helper for authenticated fetch to Supabase edge functions.
 * Replaces ad-hoc `Bearer ${publishableKey}` patterns with proper session tokens.
 * Includes retry, timeout, and structured error handling via the reliability layer.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError } from './appError';
import { createLogger } from './logger';
import { checkDriftBlock, recordFunctionVersion, driftErrorMessage, VERSION_HEADER } from './functionGroupDrift';
import { withRetry, withTimeout, isRetryableError, type RetryOptions } from './reliability';

const logger = createLogger('AuthenticatedFetch');

export interface AuthenticatedFetchOptions {
  /** Edge function name (appended to base URL) */
  functionName: string;
  /** Request body — will be JSON.stringify'd unless body is FormData */
  body?: Record<string, unknown> | FormData;
  /** Extra headers */
  headers?: Record<string, string>;
  /** Skip auth (public endpoints) */
  skipAuth?: boolean;
  /** Abort signal */
  signal?: AbortSignal;
  /** Trace ID override */
  traceId?: string;
  /** Retry configuration. Pass `false` to disable. Default: 2 attempts for retryable errors. */
  retry?: RetryOptions | false;
  /** Timeout in ms for each attempt. Default: 60000 (60s). Pass 0 to disable. */
  timeoutMs?: number;
  /** Caller component for error attribution in logs */
  componentName?: string;
}

/** Default timeout */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Default retry config */
const DEFAULT_RETRY: RetryOptions = { maxAttempts: 2, baseDelayMs: 1_500 };

/**
 * Build headers with proper Bearer auth from the user's session token.
 * Falls back to the anon key if no session exists AND skipAuth is true.
 * Includes retry + timeout via the reliability layer.
 */
export async function authenticatedFetch(
  opts: AuthenticatedFetchOptions,
): Promise<Response> {
  // ── Fail-fast drift guard ──
  const drift = checkDriftBlock(opts.functionName);
  if (drift) {
    throw new Error(driftErrorMessage(drift));
  }

  const traceId = opts.traceId ?? generateTraceId();
  const isFormData = opts.body instanceof FormData;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryOpts: RetryOptions | false =
    opts.retry === false ? false : { ...DEFAULT_RETRY, ...opts.retry };

  const headers: Record<string, string> = {
    'x-trace-id': traceId,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    ...opts.headers,
  };

  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  if (!opts.skipAuth) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${opts.functionName}`;

  const singleFetch = async (): Promise<Response> => {
    const fetchPromise = fetch(url, {
      method: 'POST',
      headers,
      body: isFormData ? opts.body as FormData : (opts.body ? JSON.stringify(opts.body) : undefined),
      signal: opts.signal,
    });

    const resp = timeoutMs > 0
      ? await withTimeout(fetchPromise, timeoutMs, `${opts.functionName} fetch`)
      : await fetchPromise;

    // Track function group version from response header
    const groupVersion = resp.headers.get(VERSION_HEADER);
    if (groupVersion) {
      const drift = recordFunctionVersion(opts.functionName, groupVersion);
      if (drift) {
        throw new Error(driftErrorMessage(drift));
      }
    }

    // Throw on retryable HTTP statuses so withRetry can catch them
    if (!resp.ok && isRetryableStatus(resp.status)) {
      throw new Error(`HTTP ${resp.status} from ${opts.functionName}`);
    }

    return resp;
  };

  if (retryOpts) {
    try {
      return await withRetry(
        async () => singleFetch(),
        {
          ...retryOpts,
          signal: opts.signal,
          shouldRetry: (err) => isRetryableError(err),
        },
      );
    } catch (err) {
      // If all retries exhausted, log and re-throw as the last response
      // For non-Response errors (timeouts, network), normalize and record
      const appError = normalizeError({
        error: err,
        source: 'function',
        functionName: opts.functionName,
        componentName: opts.componentName,
        traceId,
      });
      recordError(appError);
      logger.warn(`${opts.functionName} failed after retries`, { traceId, message: appError.message });
      throw err;
    }
  }

  return singleFetch();
}

/** HTTP status codes that should trigger a retry */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}
