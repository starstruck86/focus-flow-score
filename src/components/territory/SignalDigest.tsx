import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { format, subDays } from 'date-fns';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

const SIGNAL_COLORS: Record<string, string> = {
  competitive: 'bg-red-500/15 text-red-600',
  product: 'bg-blue-500/15 text-blue-600',
  market: 'bg-purple-500/15 text-purple-600',
  account: 'bg-green-500/15 text-green-600',
  strategic: 'bg-amber-500/15 text-amber-600',
};

export function SignalDigest() {
  const navigate = useNavigate();

  const { data: signals } = useQuery({
    queryKey: ['signal-digest'],
    queryFn: async () => {
      const since = subDays(new Date(), 7).toISOString();
      const { data } = await (supabase as any)
        .from('account_signals')
        .select('id, signal_type, raw_text, implications, created_at, linked_account_id, accounts(name, tier)')
        .gte('created_at', since)
        .order('created_at', { ascending: false });
      return (data ?? []) as any[];
    },
    staleTime: 60_000,
  });

  if (!signals) return <div className="text-center py-8 text-sm text-muted-foreground">Loading digest…</div>;
  if (signals.length === 0)
    return (
      <div className="text-center py-12 space-y-2">
        <p className="text-sm text-muted-foreground">No signals logged in the last 7 days.</p>
        <p className="text-xs text-muted-foreground">Paste signals in Signal Inbox to start building intelligence.</p>
      </div>
    );

  const grouped: Record<string, { accountName: string; tier: string | null; accountId: string | null; signals: any[] }> = {};
  signals.forEach((s) => {
    const id = s.linked_account_id ?? '__unlinked__';
    const acct = s.accounts;
    if (!grouped[id]) {
      grouped[id] = {
        accountName: acct?.name ?? 'Unlinked Signal',
        tier: acct?.tier ?? null,
        accountId: s.linked_account_id,
        signals: [],
      };
    }
    grouped[id].signals.push(s);
  });

  const entries = Object.values(grouped).sort((a, b) => b.signals.length - a.signals.length);
  const typeCount: Record<string, number> = {};
  signals.forEach((s) => {
    typeCount[s.signal_type] = (typeCount[s.signal_type] ?? 0) + 1;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center text-[11px]">
        <span className="font-semibold text-muted-foreground">
          Last 7 days: {signals.length} signal{signals.length !== 1 ? 's' : ''} across {entries.length} account
          {entries.length !== 1 ? 's' : ''}
        </span>
        {Object.entries(typeCount).map(([type, count]) => (
          <span
            key={type}
            className={cn('px-2 py-0.5 rounded-full font-medium', SIGNAL_COLORS[type] ?? 'bg-muted text-muted-foreground')}
          >
            {type}: {count}
          </span>
        ))}
      </div>

      {entries.map((group) => (
        <div key={group.accountId ?? 'unlinked'} className="rounded-xl border border-border bg-card overflow-hidden">
          <div
            className={cn(
              'flex items-center justify-between px-4 py-2.5 border-b border-border/40',
              group.accountId && 'cursor-pointer hover:bg-muted/20 transition-colors',
            )}
            onClick={() => group.accountId && navigate(`/accounts/${group.accountId}`)}
          >
            <div className="flex items-center gap-2">
              {group.tier && (
                <span
                  className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0',
                    group.tier === 'A'
                      ? 'bg-green-500/15 text-green-600'
                      : group.tier === 'B'
                        ? 'bg-amber-500/15 text-amber-600'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {group.tier}
                </span>
              )}
              <h3 className="text-sm font-semibold">{group.accountName}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {group.signals.length} signal{group.signals.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="divide-y divide-border/30">
            {group.signals.map((signal) => (
              <div key={signal.id} className="px-4 py-2.5 space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-[10px] font-medium px-2 py-0.5 rounded-full',
                      SIGNAL_COLORS[signal.signal_type] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {signal.signal_type}
                  </span>
                  <span className="text-[10px] text-muted-foreground">{format(new Date(signal.created_at), 'MMM d')}</span>
                </div>
                <p className="text-xs text-foreground leading-relaxed line-clamp-3">{signal.raw_text}</p>
                {signal.implications && (
                  <p className="text-[10px] text-muted-foreground italic line-clamp-2">{signal.implications}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
