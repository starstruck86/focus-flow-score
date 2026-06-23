import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fromActiveAccounts } from '@/data/accounts';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

function scoreHealth(
  lastTouchDays: number | null,
  tier: string | null,
  hasNextStep: boolean,
  _confirmedProducts: number,
): 'excellent' | 'good' | 'at_risk' | 'cold' {
  if (lastTouchDays === null) return 'cold';
  const coldThreshold = tier === 'A' ? 30 : 45;
  if (lastTouchDays > coldThreshold) return 'cold';
  const riskThreshold = tier === 'A' ? 14 : 21;
  if (lastTouchDays > riskThreshold || (!hasNextStep && tier === 'A')) return 'at_risk';
  if (lastTouchDays <= 7 && hasNextStep) return 'excellent';
  return 'good';
}

const HEALTH_CONFIG = {
  excellent: { label: 'Excellent', badge: 'bg-green-500/10 text-green-600' },
  good: { label: 'Good', badge: 'bg-blue-500/10 text-blue-600' },
  at_risk: { label: 'At Risk', badge: 'bg-amber-500/10 text-amber-600' },
  cold: { label: 'Cold', badge: 'bg-red-500/10 text-red-600' },
} as const;

const GRID = 'grid grid-cols-[1fr,40px,80px,90px] md:grid-cols-[1fr,40px,80px,70px,70px,60px,90px] gap-2';

export function TerritoryCoverage() {
  const navigate = useNavigate();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ['territory-coverage'],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await fromActiveAccounts()
        .select('id, name, tier, last_touch_date, next_step, icp_fit_score')
        .order('tier', { ascending: true })
        .order('name');
      return data ?? [];
    },
  });

  const { data: footprints } = useQuery({
    queryKey: ['territory-footprints'],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase
        .from('branch_footprint')
        .select('account_id, deep_linking_status, universal_ads_status, email_to_app_status, sms_to_app_status, web_to_app_status, qr_status, aio_status, advanced_privacy_status');
      return data ?? [];
    },
  });

  const { data: signalCounts } = useQuery({
    queryKey: ['territory-signal-counts'],
    staleTime: 2 * 60 * 1000,
    queryFn: async () => {
      const { data } = await supabase.from('account_signals').select('linked_account_id');
      const map = new Map<string, number>();
      (data ?? []).forEach((s: any) => {
        if (s.linked_account_id) map.set(s.linked_account_id, (map.get(s.linked_account_id) ?? 0) + 1);
      });
      return map;
    },
  });

  const footprintMap = useMemo(() => {
    const map = new Map<string, number>();
    (footprints ?? []).forEach((fp: any) => {
      const active = ['confirmed', 'inferred'];
      const count = [
        fp.deep_linking_status, fp.universal_ads_status, fp.email_to_app_status,
        fp.sms_to_app_status, fp.web_to_app_status, fp.qr_status,
        fp.aio_status, fp.advanced_privacy_status,
      ].filter((s) => s && active.includes(s)).length;
      map.set(fp.account_id, count);
    });
    return map;
  }, [footprints]);

  const summary = useMemo(() => {
    const rows = (accounts ?? []).map((a: any) => {
      const days = a.last_touch_date
        ? Math.floor((Date.now() - new Date(a.last_touch_date).getTime()) / 86400000)
        : null;
      const products = footprintMap.get(a.id) ?? 0;
      return { health: scoreHealth(days, a.tier, !!a.next_step, products), tier: a.tier };
    });
    return {
      total: rows.length,
      tierA: rows.filter((r) => r.tier === 'A').length,
      atRisk: rows.filter((r) => r.health === 'at_risk').length,
      cold: rows.filter((r) => r.health === 'cold').length,
    };
  }, [accounts, footprintMap]);

  return (
    <div className="space-y-3">
      <div className="text-xs text-muted-foreground">
        {summary.total} accounts · {summary.tierA} Tier A · {summary.atRisk} at risk · {summary.cold} cold · Last refreshed: just now
      </div>

      <div className="rounded-lg border border-border overflow-hidden">
        <div className={cn(GRID, 'px-3 py-2 bg-muted/40 border-b border-border text-[10px] font-bold uppercase tracking-wider text-muted-foreground')}>
          <span>Account</span>
          <span className="text-center">Tier</span>
          <span>Last Touch</span>
          <span className="hidden md:inline">Next Step</span>
          <span className="hidden md:inline text-center">Products</span>
          <span className="hidden md:inline text-center">Signals</span>
          <span className="text-center">Health</span>
        </div>

        {isLoading && Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className={cn(GRID, 'px-3 py-2.5 border-b border-border/40 last:border-0 animate-pulse')}>
            <div className="h-4 bg-muted rounded" />
            <div className="h-4 bg-muted rounded" />
            <div className="h-4 bg-muted rounded" />
            <div className="hidden md:block h-4 bg-muted rounded" />
            <div className="hidden md:block h-4 bg-muted rounded" />
            <div className="hidden md:block h-4 bg-muted rounded" />
            <div className="h-4 bg-muted rounded" />
          </div>
        ))}

        {!isLoading && (accounts ?? []).length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">No accounts yet.</div>
        )}

        {!isLoading && (accounts ?? []).map((account: any) => {
          const daysAgo = account.last_touch_date
            ? Math.floor((Date.now() - new Date(account.last_touch_date).getTime()) / 86400000)
            : null;
          const products = footprintMap.get(account.id) ?? 0;
          const signals = signalCounts?.get(account.id) ?? 0;
          const health = scoreHealth(daysAgo, account.tier, !!account.next_step, products);
          const hc = HEALTH_CONFIG[health];

          return (
            <div
              key={account.id}
              onClick={() => navigate(`/accounts/${account.id}`)}
              className={cn(GRID, 'px-3 py-2.5 border-b border-border/40 last:border-0 hover:bg-muted/30 cursor-pointer transition-colors items-center')}
            >
              <span className="text-sm font-medium truncate">{account.name}</span>
              <span className={cn('text-[10px] font-bold text-center px-1.5 py-0.5 rounded', account.tier === 'A' ? 'bg-green-500/15 text-green-600' : 'bg-amber-500/15 text-amber-600')}>
                {account.tier ?? '—'}
              </span>
              <span className={cn('text-xs font-medium',
                daysAgo === null ? 'text-muted-foreground' :
                daysAgo <= 7 ? 'text-green-500' :
                daysAgo <= 14 ? 'text-amber-500' : 'text-red-500'
              )}>
                {daysAgo === null ? 'Never' : `${daysAgo}d ago`}
              </span>
              <span className="hidden md:inline text-xs text-center">{account.next_step ? '✓' : '—'}</span>
              <span className="hidden md:inline text-xs text-center text-muted-foreground">{products > 0 ? products : '—'}</span>
              <span className="hidden md:inline text-xs text-center text-muted-foreground">{signals > 0 ? signals : '—'}</span>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full text-center', hc.badge)}>
                {hc.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default TerritoryCoverage;
