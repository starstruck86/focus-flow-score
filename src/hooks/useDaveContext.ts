import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const TOKEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dave-conversation-token`;
const CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes

export interface DaveSessionData {
  token: string;
  context: string;
  firstMessage: string | null;
}

/**
 * Pre-fetches and caches the Dave conversation token so that
 * startSession() can be called synchronously from a tap handler
 * (preserving the iOS gesture chain for getUserMedia).
 */
export function useDaveContext() {
  const location = useLocation();
  const [cachedSession, setCachedSession] = useState<DaveSessionData | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const fetchedAtRef = useRef<number>(0);
  const locationRef = useRef(location.pathname);

  useEffect(() => { locationRef.current = location.pathname; }, [location.pathname]);

  const fetchSession = useCallback(async (): Promise<DaveSessionData> => {
    const { data: { session } } = await supabase.auth.getSession();
    const tzOffsetHours = new Date().getTimezoneOffset() / -60;

    const resp = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${session?.access_token || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        tzOffsetHours,
        currentPage: locationRef.current,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Token fetch failed' }));
      throw new Error(err.error || `Error ${resp.status}`);
    }

    return resp.json();
  }, []);

  /** Background pre-fetch — call on mount and periodically */
  const prefetch = useCallback(async () => {
    if (isFetching) return;
    setIsFetching(true);
    try {
      const data = await fetchSession();
      setCachedSession(data);
      fetchedAtRef.current = Date.now();
      console.log('[Dave] Token pre-fetched');
    } catch (err) {
      console.warn('[Dave] Pre-fetch failed:', err);
    } finally {
      setIsFetching(false);
    }
  }, [fetchSession, isFetching]);

  /** Get a valid session — returns cache if fresh, otherwise fetches */
  const getSession = useCallback(async (): Promise<DaveSessionData> => {
    const age = Date.now() - fetchedAtRef.current;
    if (cachedSession && age < CACHE_TTL_MS) {
      return cachedSession;
    }
    const data = await fetchSession();
    setCachedSession(data);
    fetchedAtRef.current = Date.now();
    return data;
  }, [cachedSession, fetchSession]);

  /** Invalidate cache (e.g. after a failed start) */
  const invalidateCache = useCallback(() => {
    setCachedSession(null);
    fetchedAtRef.current = 0;
  }, []);

  // Pre-fetch on mount and refresh periodically
  useEffect(() => {
    prefetch();
    const interval = setInterval(prefetch, CACHE_TTL_MS);
    return () => clearInterval(interval);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { getSession, invalidateCache, cachedSession, isFetching };
}
