// ShortcutHintBanner — renders at most one hint per user, once ever.
// On arrival at a mapped destination, checks the last 14 days of nav_events
// for the "hard path" arrivals (from_path not in oneHopSources). If ≥3, shows
// a subtle dismissible line and writes the hint key into user_settings.shown_hints
// THE MOMENT IT RENDERS (not on dismiss).
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X, Lightbulb } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { findHintForPath, isOneHop, ShortcutHint } from '@/lib/shortcutHints';

const THRESHOLD = 3;
const WINDOW_DAYS = 14;

export function ShortcutHintBanner() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [hint, setHint] = useState<ShortcutHint | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setHint(null);
    setDismissed(false);
    if (!user?.id) return;
    const candidate = findHintForPath(pathname);
    if (!candidate) return;

    let cancelled = false;
    (async () => {
      try {
        // 1. Has this hint already been shown?
        const { data: settings } = await supabase
          .from('user_settings')
          .select('shown_hints' as any)
          .eq('user_id', user.id)
          .maybeSingle();
        const shown: string[] = Array.isArray((settings as any)?.shown_hints)
          ? ((settings as any).shown_hints as string[])
          : [];
        if (shown.includes(candidate.key)) return;

        // 2. Count qualifying arrivals in the window.
        const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
        const { data: events } = await (supabase as any)
          .from('nav_events')
          .select('from_path, at')
          .eq('user_id', user.id)
          .eq('to_path', pathname)
          .gte('at', since)
          .order('at', { ascending: false })
          .limit(50);

        const hardArrivals = (events ?? []).filter((e: any) => !isOneHop(e.from_path, candidate));
        if (hardArrivals.length < THRESHOLD) return;
        if (cancelled) return;

        // 3. Show the hint AND persist the key immediately (never repeat).
        setHint(candidate);
        const next = [...shown, candidate.key];
        await supabase
          .from('user_settings')
          .upsert(
            { user_id: user.id, shown_hints: next as any },
            { onConflict: 'user_id' }
          );
      } catch {
        // Never block anything.
      }
    })();
    return () => { cancelled = true; };
  }, [pathname, user?.id]);

  if (!hint || dismissed) return null;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-40 max-w-md w-[calc(100%-2rem)]">
      <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 backdrop-blur px-3 py-2 text-xs shadow-sm">
        <Lightbulb className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
        <span className="flex-1 text-foreground">{hint.copy}</span>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss hint"
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
