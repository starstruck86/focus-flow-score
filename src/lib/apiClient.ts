/**
 * Centralized API client for edge function invocations.
 * Handles: auth session, trace IDs, timeout, response validation, error normalization.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError, type AppError } from './appError';
import { createLogger } from './logger';

const logger = createLogger('ApiClient');

const DEFAULT_TIMEOUT_MS = 30_000;

export interface ApiRequestOptions {
  /** Edge function name */
  functionName: string;
  /** POST body (will be JSON.stringify'd) */
  body?: Record<string, unknown>;
  /** Override default 30s timeout */
  timeoutMs?: number;
  /** Caller trace ID — one will be generated if omitted */
  traceId?: string;
  /** Component that initiated the call, for error attribution */
  componentName?: string;
  /** Skip auth header (for public endpoints) */
  skipAuth?: boolean;
}

export interface ApiResult<T = unknown> {
  data: T | null;
  error: AppError | null;
  traceId: string;
  status: number;
}

export async function invokeFunction<T = unknown>(opts: ApiRequestOptions): Promise<ApiResult<T>> {
  const traceId = opts.traceId ?? generateTraceId();
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Build headers
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-trace-id': traceId,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };

  // Attach auth
  if (!opts.skipAuth) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const err = normalizeError({
          error: new Error('No active session'),
          source: 'frontend',
          functionName: opts.functionName,
          componentName: opts.componentName,
          traceId,
        });
        recordError(err);
        return { data: null, error: err, traceId, status: 401 };
      }
      headers['Authorization'] = `Bearer ${session.access_token}`;
    } catch (e) {
      const err = normalizeError({
        error: e,
        source: 'frontend',
        functionName: opts.functionName,
        componentName: opts.componentName,
        traceId,
      });
      recordError(err);
      return { data: null, error: err, traceId, status: 0 };
    }
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${opts.functionName}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!resp.ok) {
      const body = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
      const err = normalizeError({
        error: new Error(body.error || body.message || `HTTP ${resp.status}`),
        source: 'function',
        functionName: opts.functionName,
        componentName: opts.componentName,
        traceId,
        metadata: { status: resp.status, body },
      });
      recordError(err);
      logger.warn(`${opts.functionName} returned ${resp.status}`, { traceId, body });
      return { data: null, error: err, traceId, status: resp.status };
    }

    const data = await resp.json() as T;
    logger.debug(`${opts.functionName} OK`, { traceId });
    return { data, error: null, traceId, status: resp.status };
  } catch (raw) {
    clearTimeout(timer);
    const isAbort = raw instanceof DOMException && raw.name === 'AbortError';
    const err = normalizeError({
      error: isAbort ? new Error(`${opts.functionName} timed out after ${timeoutMs}ms`) : raw,
      source: 'function',
      functionName: opts.functionName,
      componentName: opts.componentName,
      traceId,
    });
    recordError(err);
    return { data: null, error: err, traceId, status: 0 };
  }
}

/**
 * Convenience: invoke and throw on error (for use in react-query etc.)
 */
export async function invokeFunctionOrThrow<T = unknown>(opts: ApiRequestOptions): Promise<T> {
  const result = await invokeFunction<T>(opts);
  if (result.error) {
    const e = new Error(result.error.message);
    (e as any).appError = result.error;
    throw e;
  }
  return result.data as T;
}
