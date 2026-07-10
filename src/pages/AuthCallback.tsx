import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SafePage } from '@/components/SafePage';

function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//')) return null;
  return raw;
}

export default function AuthCallback() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = useMemo(() => safeNext(params.get('next')), [params]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      // For OAuth consent returns, use a full-location change so the query
      // string (authorization_id) is preserved and re-parsed.
      if (next && next.startsWith('/.lovable/oauth/consent')) {
        window.location.href = next;
        return;
      }
      navigate(next ?? '/dojo', { replace: true });
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
  }, [navigate, next]);

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
