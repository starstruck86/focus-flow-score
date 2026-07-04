// useLastSurface — records the current route to user_settings.last_surface_path
// so Home can offer a "Resume where you left off" pill (Guide v3 §1).
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Paths we never want to resume into.
const SKIP_PREFIXES = ['/auth', '/', '/today', '/dashboard'];

export function useLastSurface() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const lastWritten = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    if (SKIP_PREFIXES.includes(pathname)) return;
    if (lastWritten.current === pathname) return;
    lastWritten.current = pathname;

    // Fire-and-forget; never block navigation.
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
        // Non-fatal — surface tracking is best-effort.
        console.warn('[useLastSurface] write failed:', err);
      }
    })();
  }, [pathname, user?.id]);
}
