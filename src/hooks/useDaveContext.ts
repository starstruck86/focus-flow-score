import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { authenticatedFetch } from '@/lib/authenticatedFetch';
import { generateTraceId, normalizeError, recordError } from '@/lib/appError';
import { createLogger } from '@/lib/logger';
import { trackedInvoke } from '@/lib/trackedInvoke';

const logger = createLogger('DaveContext');
// URL no longer needed — authenticatedFetch builds it from functionName
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes
const CONCURRENCY_COOLDOWN_MS = 30_000; // 30s cooldown after concurrency limit

export type DaveErrorType = 'concurrency_limit' | 'auth_failed' | 'agent_error' | 'unknown' | null;

export interface DaveSessionData {
  token: string;
  context: string;
  firstMessage: string | null;
}

export class DaveSessionError extends Error {
  errorType: DaveErrorType;
  cooldownUntil: number | null;

  constructor(message: string, errorType: DaveErrorType, cooldownUntil: number | null = null) {
    super(message);
    this.errorType = errorType;
    this.cooldownUntil = cooldownUntil;
  }
}

function classifyDaveTokenError(message: string) {
  if (/Failed to fetch|Load failed|NetworkError|network request failed/i.test(message)) {
    return 'Network error reaching Dave session service.';
  }

  if (/timeout|timed out/i.test(message)) {
    return 'Dave session request timed out.';
  }

  if (/aborted|abort/i.test(message)) {
    return 'Dave session request was cancelled.';
  }

  return message;
}

/**
 * On-demand Dave session fetcher with concurrency backoff.
 * No background pre-fetching — tokens are fetched only when the user taps the mic.
 */
export function useDaveContext() {
  const location = useLocation();
  const [cachedSession, setCachedSession] = useState<DaveSessionData | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const fetchedAtRef = useRef<number>(0);
  const locationRef = useRef(location.pathname);
  const inFlightRef = useRef<Promise<DaveSessionData> | null>(null);

  // Concurrency backoff state
  const concurrencyErrorCountRef = useRef(0);
  const cooldownUntilRef = useRef<number>(0);

  useCallback(() => { locationRef.current = location.pathname; }, [location.pathname]);
  // Keep location ref updated
  locationRef.current = location.pathname;

  const fetchSession = useCallback(async (conversationHistory?: string): Promise<DaveSessionData> => {
    // Check cooldown
    const now = Date.now();
    if (cooldownUntilRef.current > now) {
      const waitSec = Math.ceil((cooldownUntilRef.current - now) / 1000);
      throw new DaveSessionError(
        `Dave is at capacity — try again in ${waitSec}s`,
        'concurrency_limit',
        cooldownUntilRef.current,
      );
    }

    const traceId = generateTraceId();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) {
      const err = normalizeError({ error: new Error('Not authenticated'), source: 'frontend', functionName: 'dave-conversation-token', traceId });
      recordError(err);
      throw new DaveSessionError('Not authenticated. Please sign in first.', 'auth_failed');
    }

    const tzOffsetHours = -5; // Boston ET nominal; edge function handles DST via America/New_York

    const requestBody = {
      tzOffsetHours,
      currentPage: locationRef.current,
      conversationHistory: conversationHistory || '',
    };

    let resp: Response;

    try {
      resp = await authenticatedFetch({
        functionName: 'dave-conversation-token',
        body: requestBody,
        traceId,
        retry: false,
        timeoutMs: 30_000,
        componentName: 'DaveContext',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? 'Unknown token fetch failure');
      const isTransportFailure = /Failed to fetch|Load failed|network|timeout|timed out|aborted|abort/i.test(message);

      if (!isTransportFailure) {
        throw new DaveSessionError(classifyDaveTokenError(message), 'unknown');
      }

      logger.warn('Dave token fetch failed over authenticatedFetch, retrying via invoke', { traceId, message });

      const { data, error: invokeError } = await trackedInvoke<DaveSessionData>('dave-conversation-token', {
        body: requestBody,
        traceId,
        retry: false,
        timeoutMs: 30_000,
        componentName: 'DaveContext',
      });

      if (invokeError) {
        throw new DaveSessionError(classifyDaveTokenError(invokeError.message), 'unknown');
      }

      if (!data?.token) {
        throw new DaveSessionError('Dave session service returned no token.', 'unknown');
      }

      concurrencyErrorCountRef.current = 0;
      cooldownUntilRef.current = 0;
      return data;
    }

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Token fetch failed', errorType: 'unknown' }));
      const errorType: DaveErrorType = err.errorType || 'unknown';

      // Apply concurrency backoff
      if (errorType === 'concurrency_limit') {
        concurrencyErrorCountRef.current++;
        // Exponential backoff: 5s, 15s, 30s, 60s
        const backoffMs = Math.min(
          [5000, 15000, 30000, 60000][Math.min(concurrencyErrorCountRef.current - 1, 3)],
          60000,
        );
        cooldownUntilRef.current = Date.now() + backoffMs;
        const waitSec = Math.ceil(backoffMs / 1000);
        throw new DaveSessionError(
          `Dave is at capacity — try again in ${waitSec}s`,
          'concurrency_limit',
          cooldownUntilRef.current,
        );
      }

      throw new DaveSessionError(
        classifyDaveTokenError(err.error || `Error ${resp.status}`),
        errorType,
      );
    }

    // Success — reset concurrency counter
    concurrencyErrorCountRef.current = 0;
    cooldownUntilRef.current = 0;

    return resp.json();
  }, []);

  /** Get a valid session — returns cache if fresh, otherwise fetches */
  const getSession = useCallback(async (conversationHistory?: string): Promise<DaveSessionData> => {
    if (!conversationHistory && inFlightRef.current) {
      return inFlightRef.current;
    }

    // If we have conversation history, always fetch fresh to include it
    if (conversationHistory) {
      setIsFetching(true);
      try {
        const data = await fetchSession(conversationHistory);
        setCachedSession(data);
        fetchedAtRef.current = Date.now();
        return data;
      } finally {
        setIsFetching(false);
      }
    }

    const age = Date.now() - fetchedAtRef.current;
    if (cachedSession && age < CACHE_TTL_MS) {
      return cachedSession;
    }

    setIsFetching(true);
    try {
      const request = fetchSession();
      inFlightRef.current = request;
      const data = await request;
      setCachedSession(data);
      fetchedAtRef.current = Date.now();
      logger.info('Session fetched on-demand', { contextLength: data.context?.length });
      return data;
    } finally {
      inFlightRef.current = null;
      setIsFetching(false);
    }
  }, [cachedSession, fetchSession]);

  /** Invalidate cache (e.g. after a failed start) */
  const invalidateCache = useCallback(() => {
    setCachedSession(null);
    fetchedAtRef.current = 0;
    inFlightRef.current = null;
  }, []);

  /** Get remaining cooldown in seconds (0 = no cooldown) */
  const getCooldownRemaining = useCallback(() => {
    const remaining = cooldownUntilRef.current - Date.now();
    return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
  }, []);

  // Prefetch token on mount so first tap is instant
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!cachedSession && !inFlightRef.current) {
        fetchSession().then(data => {
          setCachedSession(data);
          fetchedAtRef.current = Date.now();
          logger.info('Session prefetched', { contextLength: data.context?.length });
        }).catch(() => {
          // Prefetch failure is non-critical — will fetch on-demand
        });
      }
    }, 3000); // 3s delay to let the app settle first
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { getSession, invalidateCache, cachedSession, isFetching, getCooldownRemaining };
}
