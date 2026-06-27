import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SafePage } from '@/components/SafePage';

/**
 * AuthCallback — landing page for OAuth redirects.
 *
 * The OAuth broker / @lovable.dev/cloud-auth-js may set the Supabase session
 * either synchronously before this page mounts (via setSession on the popup
 * return path) or asynchronously after a full-page redirect. We therefore both:
 *   1. Subscribe to onAuthStateChange and navigate on SIGNED_IN /
 *      INITIAL_SESSION with a user.
 *   2. Poll supabase.auth.getSession() for up to 10s as a safety net.
 *
 * This route MUST live outside ProtectedRoute so it isn't bounced back to
 * /auth before the session resolves.
 */
export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      navigate('/dojo', { replace: true });
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session?.user && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION' || event === 'TOKEN_REFRESHED')) {
        finish();
      }
    });

    let attempts = 0;
    const poll = async () => {
      if (done) return;
      attempts++;
      try {
        const { data } = await supabase.auth.getSession();
        if (data.session?.user) { finish(); return; }
      } catch { /* swallow — keep polling */ }
      if (attempts < 40) setTimeout(poll, 250);
    };
    poll();

    const timeoutId = window.setTimeout(() => {
      if (done) return;
      done = true;
      setError('Sign-in timed out. Please try again.');
      setTimeout(() => navigate('/auth', { replace: true }), 1500);
    }, 10_000);

    return () => {
      done = true;
      subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, [navigate]);

  return (
    <SafePage className="flex flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-bold text-foreground font-display">Dynamic</h1>
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <>
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Signing you in…</p>
        </>
      )}
    </SafePage>
  );
}
