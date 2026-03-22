/**
 * Drop-in traced wrapper around supabase.functions.invoke.
 * Adds trace IDs, normalizes errors into AppError, and records them.
 * 
 * Usage:
 *   import { trackedInvoke } from '@/lib/trackedInvoke';
 *   const { data, error, traceId } = await trackedInvoke<any>('my-function', { body: { ... } });
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError, type AppError } from './appError';
import { createLogger } from './logger';

const logger = createLogger('TrackedInvoke');

interface InvokeOptions {
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  /** Caller component for error attribution */
  componentName?: string;
  /** Override auto-generated trace ID */
  traceId?: string;
}

interface TrackedResult<T = unknown> {
  data: T | null;
  error: AppError | null;
  traceId: string;
}

export async function trackedInvoke<T = unknown>(
  functionName: string,
  options?: InvokeOptions,
): Promise<TrackedResult<T>> {
  const traceId = options?.traceId ?? generateTraceId();

  try {
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
      recordError(appError);
      logger.warn(`${functionName} error`, { traceId, message: error.message });
      return { data: null, error: appError, traceId };
    }

    // Check for application-level errors in the response body
    if (data && typeof data === 'object' && 'error' in data && (data as any).error && !('success' in data)) {
      const appError = normalizeError({
        error: new Error((data as any).error),
        source: 'function',
        functionName,
        componentName: options?.componentName,
        traceId,
        metadata: { responseData: data },
      });
      recordError(appError);
      return { data: null, error: appError, traceId };
    }

    logger.debug(`${functionName} OK`, { traceId });
    return { data: data as T, error: null, traceId };
  } catch (raw) {
    const appError = normalizeError({
      error: raw,
      source: 'function',
      functionName,
      componentName: options?.componentName,
      traceId,
    });
    recordError(appError);
    return { data: null, error: appError, traceId };
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
