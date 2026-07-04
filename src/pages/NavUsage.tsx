// /admin/nav-usage — read-only usage view of nav_events (Guide v3 §5 evidence).
// Top destinations in the last 30 days + a "not visited in 30d+" list drawn
// from the admin/QA route ledger's user-facing set (in Settings.tsx).
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '@/components/Layout';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

// Small hardcoded set of user-facing routes worth tracking for cold-storage.
// Kept in-file (this is admin-only) — extend as new user-facing routes ship.
const USER_FACING_ROUTES = [
  '/today', '/work', '/train-hub', '/gates', '/quota', '/grade', '/car-mode',
  '/study', '/flash', '/coach', '/deals', '/renewals', '/tasks', '/trends',
  '/weekly-review', '/prep', '/simulate', '/playbooks', '/competitive',
  '/signal-inbox', '/ki-library', '/dojo', '/skills', '/learn',
];

export default function NavUsage() {
  const { user } = useAuth();

  const { data: events } = useQuery({
    queryKey: ['nav-usage-events', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await (supabase as any)
        .from('nav_events')
        .select('to_path, at')
        .eq('user_id', user!.id)
        .gte('at', since)
        .order('at', { ascending: false })
        .limit(5000);
      return (data ?? []) as { to_path: string; at: string }[];
    },
  });

  const { top, cold } = useMemo(() => {
    const map = new Map<string, { count: number; last: string }>();
    for (const e of events ?? []) {
      const cur = map.get(e.to_path);
      if (!cur) map.set(e.to_path, { count: 1, last: e.at });
      else { cur.count += 1; if (e.at > cur.last) cur.last = e.at; }
    }
    const top = [...map.entries()]
      .map(([path, v]) => ({ path, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);
    const visited = new Set(map.keys());
    const cold = USER_FACING_ROUTES.filter(r => !visited.has(r));
    return { top, cold };
  }, [events]);

  return (
    <Layout>
      <div className="max-w-3xl mx-auto p-6 space-y-8 text-sm">
        <div>
          <h1 className="text-lg font-semibold mb-1">Nav usage — last 30 days</h1>
          <p className="text-xs text-muted-foreground">Read-only route ledger evidence (Guide v3 §5).</p>
        </div>

        <section>
          <h2 className="font-medium mb-2">Top destinations</h2>
          {top.length === 0 ? (
            <p className="text-muted-foreground text-xs">No nav events recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {top.map(row => (
                <li key={row.path} className="flex items-center justify-between px-3 py-2">
                  <span className="font-mono text-xs">{row.path}</span>
                  <span className="text-xs text-muted-foreground">
                    {row.count} · last {new Date(row.last).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-medium mb-2">Not visited in 30d+</h2>
          {cold.length === 0 ? (
            <p className="text-muted-foreground text-xs">Every user-facing route was visited.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {cold.map(p => (
                <li key={p} className="px-3 py-2 font-mono text-xs">{p}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Layout>
  );
}
