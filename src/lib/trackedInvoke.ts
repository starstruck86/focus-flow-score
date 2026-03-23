/**
 * Drop-in traced wrapper around supabase.functions.invoke.
 * Adds trace IDs, normalizes errors into AppError, records them,
 * and supports retry + timeout via the reliability layer.
 * 
 * Usage:
 *   import { trackedInvoke } from '@/lib/trackedInvoke';
 *   const { data, error, traceId } = await trackedInvoke<MyType>('my-function', { body: { ... } });
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError, type AppError } from './appError';
import { createLogger } from './logger';
import { checkDriftBlock, driftErrorMessage } from './functionGroupDrift';
import { withRetry, withTimeout, type RetryOptions } from './reliability';

const logger = createLogger('TrackedInvoke');

interface InvokeOptions {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Caller component for error attribution */
  componentName?: string;
  /** Override auto-generated trace ID */
  traceId?: string;
  /** Retry configuration. Pass `false` to disable. Default: 2 attempts for retryable errors. */
  retry?: RetryOptions | false;
  /** Timeout in ms for the entire call (including retries). Default: 60000 (60s). Pass 0 to disable. */
  timeoutMs?: number;
}

interface TrackedResult<T = unknown> {
  data: T | null;
  error: AppError | null;
  traceId: string;
  /** Number of attempts made (1 = no retries) */
  attempts: number;
}

/** Default timeout for edge function calls */
const DEFAULT_TIMEOUT_MS = 60_000;
/** Default retry config */
const DEFAULT_RETRY: RetryOptions = { maxAttempts: 2, baseDelayMs: 1_500 };

async function singleInvoke<T>(
  functionName: string,
  traceId: string,
  options?: InvokeOptions,
): Promise<{ data: T; error: null } | { data: null; error: AppError }> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: options?.body,
    headers: {
      'x-trace-id': traceId,
      ...options?.headers,
    },
  });

  if (error) {
    const appError = normalizeError({
      error,
      source: 'function',
      functionName,
      componentName: options?.componentName,
      traceId,
      metadata: { responseData: data },
    });
    // For retryable errors, throw so withRetry can catch
    if (appError.retryable) throw appError;
    return { data: null, error: appError };
  }

  // Check for application-level errors in the response body
  if (data && typeof data === 'object' && 'error' in data) {
    const errRecord = data as Record<string, unknown>;
    if (errRecord.error && !('success' in data)) {
      const appError = normalizeError({
        error: new Error(String(errRecord.error)),
        source: 'function',
        functionName,
        componentName: options?.componentName,
        traceId,
        metadata: { responseData: data },
      });
      if (appError.retryable) throw appError;
      return { data: null, error: appError };
    }
  }

  return { data: data as T, error: null };
}

export async function trackedInvoke<T = unknown>(
  functionName: string,
  options?: InvokeOptions,
): Promise<TrackedResult<T>> {
  const traceId = options?.traceId ?? generateTraceId();
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let attempts = 0;

  const retryOpts: RetryOptions | false =
    options?.retry === false ? false : { ...DEFAULT_RETRY, ...options?.retry };

  const execute = async (): Promise<TrackedResult<T>> => {
    const invokeWithRetry = retryOpts
      ? withRetry(
          async (attempt) => {
            attempts = attempt;
            return singleInvoke<T>(functionName, traceId, options);
          },
          {
            ...retryOpts,
            shouldRetry: (err) => {
              // Only retry AppErrors that are marked retryable
              if (err && typeof err === 'object' && 'retryable' in err) {
                return (err as AppError).retryable;
              }
              return false;
            },
          },
        )
      : (async () => {
          attempts = 1;
          return singleInvoke<T>(functionName, traceId, options);
        })();

    const result = await invokeWithRetry;

    if (result.error) {
      recordError(result.error);
      logger.warn(`${functionName} failed`, { traceId, attempts, message: result.error.message });
      return { data: null, error: result.error, traceId, attempts };
    }

    logger.debug(`${functionName} OK`, { traceId, attempts });
    return { data: result.data, error: null, traceId, attempts };
  };

  try {
    if (timeoutMs > 0) {
      return await withTimeout(execute(), timeoutMs, `${functionName} call`);
    }
    return await execute();
  } catch (raw) {
    // Timeout or final retry exhaustion lands here
    const appError = raw && typeof raw === 'object' && 'category' in raw
      ? (raw as AppError)
      : normalizeError({
          error: raw,
          source: 'function',
          functionName,
          componentName: options?.componentName,
          traceId,
        });
    recordError(appError);
    logger.warn(`${functionName} final failure`, { traceId, attempts, message: appError.message });
    return { data: null, error: appError, traceId, attempts };
  }
}

/**
 * For SSE/streaming edge functions that must use raw fetch.
 * Returns a traced fetch with proper auth headers.
 */
export async function trackedStreamFetch(
  functionName: string,
  body: Record<string, unknown>,
  options?: { componentName?: string; traceId?: string; timeoutMs?: number },
): Promise<{ response: Response; traceId: string } | { response: null; error: AppError; traceId: string }> {
  const traceId = options?.traceId ?? generateTraceId();

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-trace-id': traceId,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
    if (session?.access_token) {
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const controller = new AbortController();
    const timer = options?.timeoutMs
      ? setTimeout(() => controller.abort(), options.timeoutMs)
      : null;

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (timer) clearTimeout(timer);

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      const appError = normalizeError({
        error: new Error(errBody.error || `HTTP ${resp.status}`),
        source: 'function',
        functionName,
        componentName: options?.componentName,
        traceId,
        metadata: { status: resp.status },
      });
      recordError(appError);
      return { response: null, error: appError, traceId };
    }

    return { response: resp, traceId };
  } catch (raw) {
    const appError = normalizeError({
      error: raw,
      source: 'function',
      functionName,
      componentName: options?.componentName,
      traceId,
    });
    recordError(appError);
    return { response: null, error: appError, traceId };
  }
}
