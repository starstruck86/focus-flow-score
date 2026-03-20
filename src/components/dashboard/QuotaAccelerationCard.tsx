import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, TrendingUp, ArrowRight } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useDbOpportunities } from '@/hooks/useAccountsData';
import { useQuotaTargets } from '@/hooks/useSalesAge';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { cn } from '@/lib/utils';

interface AccelerationMove {
  type: 'advance' | 'create' | 'renew' | 'expand';
  label: string;
  detail: string;
  impact: number;
  icon: typeof TrendingUp;
}

export function QuotaAccelerationCard() {
  const { accounts, renewals } = useStore();
  const { data: dbOpps = [] } = useDbOpportunities();
  const { data: quotaTargets } = useQuotaTargets();
  const qt = quotaTargets || DEFAULT_QUOTA_TARGETS;

  const { moves, quotaGap } = useMemo(() => {
    const closedWonArr = dbOpps
      .filter(o => o.status === 'closed-won')
      .reduce((s, o) => s + (o.arr || 0), 0);
    const totalQuota = qt.newArrQuota + qt.renewalArrQuota;
    const gap = Math.max(0, totalQuota - closedWonArr);

    const moves: AccelerationMove[] = [];

    // Find deals that can be advanced
    const activePipeline = dbOpps.filter(o => o.status === 'active' && o.arr);
    const negotiateDeals = activePipeline.filter(o => o.stage === 'Negotiate');
    const proposalDeals = activePipeline.filter(o => o.stage === 'Proposal');

    if (negotiateDeals.length > 0) {
      const totalNeg = negotiateDeals.reduce((s, o) => s + (o.arr || 0), 0);
      moves.push({
        type: 'advance',
        label: `Close ${negotiateDeals.length} in Negotiate`,
        detail: `$${(totalNeg / 1000).toFixed(0)}k in late-stage pipeline`,
        impact: totalNeg,
        icon: TrendingUp,
      });
    }

    if (proposalDeals.length > 0) {
      const totalProp = proposalDeals.reduce((s, o) => s + (o.arr || 0), 0);
      moves.push({
        type: 'advance',
        label: `Accelerate ${proposalDeals.length} Proposals`,
        detail: `Push for technical validation and pricing alignment`,
        impact: totalProp * 0.4,
        icon: TrendingUp,
      });
    }

    // Renewal opportunities
    const atRiskRenewals = renewals.filter(r => r.churnRisk === 'high' || r.churnRisk === 'medium');
    if (atRiskRenewals.length > 0) {
      const totalRisk = atRiskRenewals.reduce((s, r) => s + (r.arr || 0), 0);
      moves.push({
        type: 'renew',
        label: `Save ${atRiskRenewals.length} at-risk renewals`,
        detail: `$${(totalRisk / 1000).toFixed(0)}k renewal ARR at risk`,
        impact: totalRisk,
        icon: Zap,
      });
    }

    // Expansion in healthy accounts
    const healthyAccounts = accounts.filter(a => a.tier === 'A' && a.accountStatus === 'active');
    const accountsWithoutOpps = healthyAccounts.filter(
      a => !dbOpps.some(o => o.account_id === a.id && o.status === 'active')
    );
    if (accountsWithoutOpps.length > 0) {
      moves.push({
        type: 'expand',
        label: `Prospect ${Math.min(accountsWithoutOpps.length, 5)} Tier-A accounts`,
        detail: `High-fit accounts with no active opportunities`,
        impact: gap * 0.1,
        icon: ArrowRight,
      });
    }

    return { moves: moves.sort((a, b) => b.impact - a.impact).slice(0, 4), quotaGap: gap };
  }, [dbOpps, accounts, renewals, qt]);

  if (quotaGap <= 0) {
    return (
      <Card className="border-status-green/30 bg-status-green/5">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Zap className="h-4 w-4 text-status-green" />
            Quota Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-status-green font-medium">You've hit quota — keep stacking!</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          Close the Gap
          <Badge variant="outline" className="text-[10px] ml-auto font-mono">
            ${(quotaGap / 1000).toFixed(0)}k remaining
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {moves.map((move, i) => {
          const Icon = move.icon;
          return (
            <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 border border-border/20">
              <div className={cn(
                "mt-0.5 rounded-full p-1",
                move.type === 'advance' ? "bg-status-green/10 text-status-green"
                  : move.type === 'renew' ? "bg-status-yellow/10 text-status-yellow"
                  : "bg-primary/10 text-primary"
              )}>
                <Icon className="h-3 w-3" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{move.label}</p>
                <p className="text-[10px] text-muted-foreground">{move.detail}</p>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                ~${(move.impact / 1000).toFixed(0)}k
              </span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
