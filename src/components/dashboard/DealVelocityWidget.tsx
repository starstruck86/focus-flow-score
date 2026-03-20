import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Gauge, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { useDbOpportunities } from '@/hooks/useAccountsData';
import { differenceInDays, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

export function DealVelocityWidget({ opportunityId }: { opportunityId?: string }) {
  const { data: dbOpps = [] } = useDbOpportunities();

  const velocity = useMemo(() => {
    const closedDeals = dbOpps.filter(o => o.status === 'closed-won' && o.created_at && o.close_date);
    if (closedDeals.length === 0) return null;

    const cycleDays = closedDeals.map(o => differenceInDays(parseISO(o.close_date!), parseISO(o.created_at)));
    const avgCycle = Math.round(cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length);

    const currentDeal = opportunityId ? dbOpps.find(o => o.id === opportunityId) : null;
    const currentAge = currentDeal ? differenceInDays(new Date(), parseISO(currentDeal.created_at)) : null;

    const avgArr = Math.round(closedDeals.reduce((s, o) => s + (o.arr || 0), 0) / closedDeals.length);
    const pipelineVelocity = closedDeals.length * avgArr / Math.max(avgCycle, 1);

    return {
      avgCycleDays: avgCycle,
      currentDealAge: currentAge,
      paceStatus: currentAge !== null
        ? currentAge > avgCycle * 1.3 ? 'slow' : currentAge < avgCycle * 0.7 ? 'fast' : 'on-pace'
        : null,
      closedCount: closedDeals.length,
      avgArr,
      dailyVelocity: Math.round(pipelineVelocity / 30),
    };
  }, [dbOpps, opportunityId]);

  if (!velocity) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" />
            Deal Velocity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">Close deals to establish velocity benchmarks.</p>
        </CardContent>
      </Card>
    );
  }

  const PaceIcon = velocity.paceStatus === 'fast' ? TrendingUp : velocity.paceStatus === 'slow' ? TrendingDown : Minus;
  const paceColor = velocity.paceStatus === 'fast' ? 'text-status-green' : velocity.paceStatus === 'slow' ? 'text-status-red' : 'text-muted-foreground';

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="h-4 w-4 text-primary" />
          Deal Velocity
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold font-mono">{velocity.avgCycleDays}d</p>
            <p className="text-[10px] text-muted-foreground">Avg Cycle</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold font-mono">${(velocity.avgArr / 1000).toFixed(0)}k</p>
            <p className="text-[10px] text-muted-foreground">Avg Deal</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold font-mono">{velocity.closedCount}</p>
            <p className="text-[10px] text-muted-foreground">Deals Won</p>
          </div>
        </div>

        {velocity.currentDealAge !== null && (
          <div className={cn("mt-3 flex items-center gap-2 p-2 rounded-lg border border-border/30", 
            velocity.paceStatus === 'slow' ? "bg-status-red/5" : velocity.paceStatus === 'fast' ? "bg-status-green/5" : "bg-muted/30"
          )}>
            <PaceIcon className={cn("h-3.5 w-3.5", paceColor)} />
            <div className="flex-1">
              <p className="text-xs font-medium">
                {velocity.currentDealAge}d old
                <span className="text-muted-foreground font-normal"> vs {velocity.avgCycleDays}d avg</span>
              </p>
            </div>
            <Badge variant="outline" className={cn("text-[9px]", paceColor)}>
              {velocity.paceStatus === 'fast' ? 'Ahead' : velocity.paceStatus === 'slow' ? 'Behind' : 'On Pace'}
            </Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
