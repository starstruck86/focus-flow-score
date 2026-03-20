import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Clock, Target, TrendingDown, ChevronRight } from 'lucide-react';
import { useStore } from '@/store/useStore';
import { useDbOpportunities } from '@/hooks/useAccountsData';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { differenceInDays, parseISO } from 'date-fns';

interface DealRisk {
  oppId: string;
  oppName: string;
  accountName: string;
  arr: number;
  risks: { label: string; severity: 'high' | 'medium' }[];
  riskScore: number;
}

export function DealRiskAlerts() {
  const navigate = useNavigate();
  const { accounts } = useStore();
  const { data: dbOpps = [] } = useDbOpportunities();

  const alerts = useMemo(() => {
    const now = new Date();
    const results: DealRisk[] = [];

    for (const opp of dbOpps) {
      if (opp.status === 'closed-won' || opp.status === 'closed-lost') continue;

      const risks: { label: string; severity: 'high' | 'medium' }[] = [];
      const account = accounts.find(a => a.id === opp.account_id);

      // Stale activity
      if (opp.last_touch_date) {
        const days = differenceInDays(now, parseISO(opp.last_touch_date));
        if (days > 21) risks.push({ label: `${days}d stale`, severity: 'high' });
        else if (days > 10) risks.push({ label: `${days}d since touch`, severity: 'medium' });
      } else {
        const daysSinceCreation = differenceInDays(now, parseISO(opp.created_at));
        if (daysSinceCreation > 7) risks.push({ label: 'Never touched', severity: 'high' });
      }

      // Missing next step
      if (!opp.next_step || opp.next_step.trim().length < 3) {
        risks.push({ label: 'No next step', severity: 'high' });
      }

      // Past due close date
      if (opp.close_date) {
        const daysToClose = differenceInDays(parseISO(opp.close_date), now);
        if (daysToClose < 0) risks.push({ label: 'Past due', severity: 'high' });
        else if (daysToClose < 14) risks.push({ label: `${daysToClose}d to close`, severity: 'medium' });
      }

      if (risks.length > 0) {
        const score = risks.reduce((s, r) => s + (r.severity === 'high' ? 30 : 15), 0);
        results.push({
          oppId: opp.id,
          oppName: opp.name,
          accountName: account?.name || 'Unknown',
          arr: opp.arr || 0,
          risks,
          riskScore: Math.min(100, score),
        });
      }
    }

    return results.sort((a, b) => b.riskScore - a.riskScore).slice(0, 5);
  }, [dbOpps, accounts]);

  if (alerts.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-green" />
            Deal Risk Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">All deals looking healthy — no risk alerts.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-status-yellow" />
          Deal Risk Alerts
          <Badge variant="outline" className="text-[10px] ml-auto">{alerts.length} deals</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {alerts.map(alert => (
          <button
            key={alert.oppId}
            onClick={() => navigate(`/opportunity/${alert.oppId}`)}
            className="w-full text-left p-2 rounded-lg border border-border/30 hover:border-border/60 hover:bg-muted/30 transition-colors group"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium truncate block">{alert.oppName}</span>
                <span className="text-[10px] text-muted-foreground">{alert.accountName}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] font-mono text-muted-foreground">
                  ${(alert.arr / 1000).toFixed(0)}k
                </span>
                <ChevronRight className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              {alert.risks.map((risk, i) => (
                <Badge
                  key={i}
                  variant="outline"
                  className={cn(
                    "text-[9px] px-1 py-0",
                    risk.severity === 'high'
                      ? "border-status-red/40 text-status-red bg-status-red/5"
                      : "border-status-yellow/40 text-status-yellow bg-status-yellow/5"
                  )}
                >
                  {risk.label}
                </Badge>
              ))}
            </div>
          </button>
        ))}
      </CardContent>
    </Card>
  );
}
