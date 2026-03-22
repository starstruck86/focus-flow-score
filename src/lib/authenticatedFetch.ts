/**
 * Shared helper for authenticated fetch to Supabase edge functions.
 * Replaces ad-hoc `Bearer ${publishableKey}` patterns with proper session tokens.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId } from './appError';

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
}

/**
 * Build headers with proper Bearer auth from the user's session token.
 * Falls back to the anon key if no session exists AND skipAuth is true.
 */
export async function authenticatedFetch(
  opts: AuthenticatedFetchOptions,
): Promise<Response> {
  const traceId = opts.traceId ?? generateTraceId();
  const isFormData = opts.body instanceof FormData;

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
    // If no session, still send request — the function will 401 appropriately
  }

  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${opts.functionName}`;

  return fetch(url, {
    method: 'POST',
    headers,
    body: isFormData ? opts.body as FormData : (opts.body ? JSON.stringify(opts.body) : undefined),
    signal: opts.signal,
  });
}
