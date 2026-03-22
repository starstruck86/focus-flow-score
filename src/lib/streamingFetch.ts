/**
 * Shared helper for SSE streaming fetch to Supabase edge functions.
 * Handles auth, trace IDs, SSE parsing, error normalization, and diagnostics logging.
 */

import { supabase } from '@/integrations/supabase/client';
import { generateTraceId, normalizeError, recordError, type AppError } from './appError';

export interface StreamingFetchOptions {
  /** Edge function name */
  functionName: string;
  /** JSON body */
  body?: Record<string, unknown>;
  /** AbortSignal for cancellation */
  signal?: AbortSignal;
  /** Trace ID override */
  traceId?: string;
  /** Skip auth (public endpoints) */
  skipAuth?: boolean;
  /** Extra headers */
  headers?: Record<string, string>;
}

export interface SSECallbacks {
  /** Called with each content delta from the SSE stream */
  onDelta: (text: string) => void;
  /** Called when the stream completes normally */
  onDone: () => void;
  /** Called on any error (auth, network, parse, HTTP) */
  onError: (error: string, appError?: AppError) => void;
  /** Called when the stream first opens successfully */
  onOpen?: () => void;
  /** Optional: Called with raw parsed SSE data events (before delta extraction) */
  onRawEvent?: (parsed: unknown) => void;
}

/**
 * Extract content delta from a parsed SSE JSON payload.
 * Supports OpenAI-style `choices[0].delta.content` format.
 */
function extractDelta(parsed: unknown): string | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const choices = (parsed as any).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  return choices[0]?.delta?.content ?? null;
}

/**
 * Parse an SSE buffer, processing complete lines and returning leftover buffer.
 */
function processSSEBuffer(
  buffer: string,
  callbacks: SSECallbacks,
): { remaining: string; done: boolean } {
  let idx: number;
  let done = false;

  while ((idx = buffer.indexOf('\n')) !== -1) {
    let line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);

    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.startsWith(':') || line.trim() === '') continue;
    if (!line.startsWith('data: ')) continue;

    const jsonStr = line.slice(6).trim();
    if (jsonStr === '[DONE]') {
      done = true;
      break;
    }

    try {
      const parsed = JSON.parse(jsonStr);
      callbacks.onRawEvent?.(parsed);
      const content = extractDelta(parsed);
      if (content) callbacks.onDelta(content);
    } catch {
      // Incomplete JSON — push line back into buffer for next chunk
      buffer = line + '\n' + buffer;
      break;
    }
  }

  return { remaining: buffer, done };
}

/**
 * Stream an SSE response from a Supabase edge function.
 * Provides proper auth, trace IDs, error normalization, and diagnostics.
 */
export async function streamingFetch(
  opts: StreamingFetchOptions,
  callbacks: SSECallbacks,
): Promise<{ traceId: string }> {
  const traceId = opts.traceId ?? generateTraceId();
  const functionName = opts.functionName;

  try {
    // Get auth token
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-trace-id': traceId,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      ...opts.headers,
    };

    if (!opts.skipAuth) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const err = normalizeError({
          error: new Error('Not authenticated'),
          source: 'frontend',
          functionName,
          traceId,
        });
        recordError(err);
        callbacks.onError('Not authenticated. Please sign in first.', err);
        return { traceId };
      }
      headers['Authorization'] = `Bearer ${session.access_token}`;
    }

    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${functionName}`;

    const resp = await fetch(url, {
      method: 'POST',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.json().catch(() => ({ error: `Error ${resp.status}` }));
      const errMsg = errBody.error || errBody.message || `Error ${resp.status}`;
      const err = normalizeError({
        error: new Error(errMsg),
        source: 'function',
        functionName,
        traceId,
        metadata: { status: resp.status, errorType: errBody.errorType },
      });
      recordError(err);
      callbacks.onError(errMsg, err);
      return { traceId };
    }

    if (!resp.body) {
      const err = normalizeError({
        error: new Error('No response body'),
        source: 'function',
        functionName,
        traceId,
      });
      recordError(err);
      callbacks.onError('No response body', err);
      return { traceId };
    }

    callbacks.onOpen?.();

    // Read the SSE stream
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const result = processSSEBuffer(buffer, callbacks);
        buffer = result.remaining;
        if (result.done) {
          callbacks.onDone();
          return { traceId };
        }
      }

      // Flush remaining buffer
      if (buffer.trim()) {
        const result = processSSEBuffer(buffer + '\n', callbacks);
        if (result.done) {
          callbacks.onDone();
          return { traceId };
        }
      }

      callbacks.onDone();
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
    }
  } catch (e: any) {
    if (e.name === 'AbortError') return { traceId };

    const err = normalizeError({
      error: e,
      source: 'frontend',
      functionName,
      traceId,
    });
    recordError(err);
    callbacks.onError(err.message, err);
  }

  return { traceId };
}

/**
 * Convenience: stream and accumulate full text result.
 * Returns the accumulated text and trace ID.
 */
export async function streamToString(
  opts: StreamingFetchOptions,
  onDelta?: (accumulated: string) => void,
): Promise<{ text: string; traceId: string; error?: string }> {
  let accumulated = '';
  let streamError: string | undefined;

  const { traceId } = await streamingFetch(opts, {
    onDelta: (chunk) => {
      accumulated += chunk;
      onDelta?.(accumulated);
    },
    onDone: () => {},
    onError: (msg) => { streamError = msg; },
  });

  return { text: accumulated, traceId, error: streamError };
}
