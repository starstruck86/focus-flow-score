import { useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';

const TOKEN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/dave-conversation-token`;

export interface DaveSessionData {
  token: string;
  context: string;
  firstMessage: string | null;
}

export function useDaveContext() {
  const location = useLocation();

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
        currentPage: location.pathname,
      }),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: 'Token fetch failed' }));
      throw new Error(err.error || `Error ${resp.status}`);
    }

    return resp.json();
  }, [location.pathname]);

  return { fetchSession };
}
