import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fromActiveAccounts } from '@/data/accounts';
import { cn } from '@/lib/utils';

type PrioritizedAccount = {
  id: string;
  name: string;
  tier: string | null;
  last_touch_date: string | null;
  next_step: string | null;
  next_step_date: string | null;
  icp_fit_score: number | null;
};

function priorityScore(a: PrioritizedAccount): number {
  let score = 0;
  if (a.tier === 'A') score += 30;
  else if (a.tier === 'B') score += 10;

  const daysAgo = a.last_touch_date
    ? Math.floor((Date.now() - new Date(a.last_touch_date).getTime()) / 86400000)
    : 999;
  if (daysAgo > 30) score += 25;
  else if (daysAgo > 14) score += 15;
  else if (daysAgo > 7) score += 5;

  if (a.next_step && a.next_step_date) {
    const overdue = Math.floor((Date.now() - new Date(a.next_step_date).getTime()) / 86400000);
    if (overdue > 0) score += Math.min(overdue * 2, 20);
  }
  if (!a.next_step && a.tier === 'A') score += 10;
  if (a.icp_fit_score) score += Math.floor(a.icp_fit_score / 20);
  return score;
}

function getPriorityReason(a: PrioritizedAccount): string {
  const daysAgo = a.last_touch_date
    ? Math.floor((Date.now() - new Date(a.last_touch_date).getTime()) / 86400000)
    : null;
  if (!a.next_step) return 'No next step — set one';
  if (a.next_step_date) {
    const overdue = Math.floor((Date.now() - new Date(a.next_step_date).getTime()) / 86400000);
    if (overdue > 0) return `Next step ${overdue}d overdue: ${a.next_step.slice(0, 50)}`;
  }
  if (daysAgo !== null && daysAgo > 14) return `Not touched in ${daysAgo} days`;
  return a.next_step?.slice(0, 60) ?? 'Review this account';
}

export function PriorityInbox() {
  const navigate = useNavigate();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['priority-accounts'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, tier, last_touch_date, next_step, next_step_date, icp_fit_score')
        .limit(30);
      return (data ?? []) as PrioritizedAccount[];
    },
  });

  const topAccounts = useMemo(() => {
    return (accounts ?? [])
      .map((a) => ({ ...a, score: priorityScore(a) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }, [accounts]);

  const decayingAccounts = useMemo(() => {
    return (accounts ?? []).filter((a) => {
      const daysAgo = a.last_touch_date
        ? Math.floor((Date.now() - new Date(a.last_touch_date).getTime()) / 86400000)
        : 999;
      const threshold = a.tier === 'A' ? 14 : 21;
      return daysAgo >= threshold;
    });
  }, [accounts]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
        <div className="h-4 bg-muted rounded w-1/3 animate-pulse" />
      </div>
    );
  }

  if (!accounts || accounts.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">Today's Focus</p>
          <p className="text-[11px] text-muted-foreground">Ranked by tier, recency, and next step urgency</p>
        </div>
        <span className="text-xs text-muted-foreground">Top 3</span>
      </div>

      {topAccounts.map((account, rank) => (
        <div
          key={account.id}
          onClick={() => navigate(`/accounts/${account.id}`)}
          className="flex items-center gap-3 py-2 px-3 rounded-lg bg-background/60 cursor-pointer hover:bg-background/80 transition-colors"
        >
          <span className="text-[11px] font-bold text-muted-foreground w-4">{rank + 1}</span>
          <span
            className={cn(
              'text-[10px] font-bold px-1.5 py-0.5 rounded',
              account.tier === 'A' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600',
            )}
          >
            {account.tier ?? '—'}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{account.name}</p>
            <p className="text-[11px] text-muted-foreground truncate">{getPriorityReason(account)}</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/meeting?accountId=${account.id}`);
              }}
              className="text-[10px] font-medium px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-all"
            >
              Prep
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/post-call?accountId=${account.id}`);
              }}
              className="text-[10px] font-medium px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
            >
              Log
            </button>
          </div>
        </div>
      ))}

      {decayingAccounts.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border/40">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-500 mb-2">
            ⚠️ Relationship decay — {decayingAccounts.length} account{decayingAccounts.length > 1 ? 's' : ''}
          </p>
          {decayingAccounts.map((account) => {
            const daysAgo = account.last_touch_date
              ? Math.floor((Date.now() - new Date(account.last_touch_date).getTime()) / 86400000)
              : null;
            return (
              <div
                key={account.id}
                onClick={() => navigate(`/accounts/${account.id}`)}
                className="flex items-center justify-between gap-2 py-1.5 cursor-pointer hover:bg-muted/30 rounded-lg px-2 -mx-2 transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className={cn(
                      'text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0',
                      account.tier === 'A' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600',
                    )}
                  >
                    {account.tier ?? '—'}
                  </span>
                  <span className="text-sm font-medium truncate">{account.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={cn("text-xs font-medium", daysAgo === null ? "text-muted-foreground" : "text-red-500")}>
                    {daysAgo === null ? 'No touch yet' : `${daysAgo}d`}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/meeting?accountId=${account.id}`); }}
                    className="text-[10px] font-medium px-2 py-1 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-all"
                  >Prep</button>
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(`/post-call?accountId=${account.id}`); }}
                    className="text-[10px] font-medium px-2 py-1 rounded bg-muted text-muted-foreground hover:bg-muted/80 transition-all"
                  >Log</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
