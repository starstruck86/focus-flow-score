// useLastSurface — records the current route to user_settings.last_surface_path
// AND fire-and-forget inserts a nav_events row (from → to) for shortcut coaching
// and usage telemetry. Never awaited in the nav path; all errors swallowed.
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Paths we never want to resume into (last_surface_path skip only).
const SKIP_PREFIXES = ['/auth', '/', '/today', '/dashboard'];

export function useLastSurface() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const lastWritten = useRef<string | null>(null);
  const prevPath = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    if (lastWritten.current === pathname) return;
    const from = prevPath.current;
    prevPath.current = pathname;
    lastWritten.current = pathname;

    // Fire-and-forget nav_events insert — never awaited, never blocks nav.
    try {
      // Read voice hint if Dave's navigation.ts set one (best-effort, optional).
      let via: string | null = null;
      try {
        const w = window as unknown as { _lastNavVia?: string };
        if (w._lastNavVia) { via = w._lastNavVia; w._lastNavVia = undefined; }
      } catch { /* ignore */ }

      void (supabase as any)
        .from('nav_events')
        .insert({ user_id: user.id, from_path: from, to_path: pathname, via })
        .then(() => { /* noop */ }, () => { /* swallow */ });
    } catch { /* swallow */ }

    // last_surface_path — skip low-value destinations.
    if (SKIP_PREFIXES.includes(pathname)) return;
    (async () => {
      try {
        await supabase
          .from('user_settings')
          .upsert(
            {
              user_id: user.id,
              last_surface_path: pathname,
              last_surface_at: new Date().toISOString(),
            },
            { onConflict: 'user_id' }
          );
      } catch (err) {
        console.warn('[useLastSurface] write failed:', err);
      }
    })();
  }, [pathname, user?.id]);
}
