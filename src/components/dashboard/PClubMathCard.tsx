// P-Club Math Card — shows exactly what activity is needed to hit quota
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConversionMath } from '@/hooks/useCoachingEngine';
import { Target, TrendingUp, TrendingDown, ArrowRight, Calculator, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

function formatCurrency(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

export function PClubMathCard() {
  const { data, isLoading } = useConversionMath();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) {
    return (
      <Card className="metric-card">
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="metric-card border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            P-Club Math
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground text-center py-4">
            Configure your quota and conversion benchmarks in Settings → Coaching to see your path to P-Club.
          </p>
        </CardContent>
      </Card>
    );
  }

  const { quota, timeline, funnel, pace, pipeline } = data;

  return (
    <Card className="metric-card border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-display flex items-center gap-2">
            <Calculator className="h-4 w-4 text-primary" />
            P-Club Math
          </CardTitle>
          <Badge variant={pace.onPace ? "default" : "destructive"} className="text-xs">
            {pace.onPace ? "On Pace" : "Behind Pace"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Quota Gap Summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">Quota Gap</div>
            <div className="font-display font-bold text-lg text-destructive">{formatCurrency(quota.totalGap)}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">Days Left</div>
            <div className="font-display font-bold text-lg">{timeline.daysRemaining}</div>
          </div>
          <div className="text-center p-2 rounded-lg bg-muted/30">
            <div className="text-xs text-muted-foreground">Coverage</div>
            <div className={cn("font-display font-bold text-lg", pipeline.coverageHealthy ? "text-recovery" : "text-strain")}>
              {pipeline.pipelineCoverage}x
            </div>
          </div>
        </div>

        {/* Required Daily Activity */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Daily Targets to Hit Number</div>
          <div className="grid grid-cols-2 gap-2">
            <ActivityRow
              label="Dials"
              required={funnel.dailyTargets.dials}
              actual={pace.actual.dialsPerDay}
            />
            <ActivityRow
              label="Connects"
              required={funnel.dailyTargets.connects}
              actual={Math.round(pace.actual.conversationsPerDay)}
            />
            <ActivityRow
              label="Meetings/wk"
              required={funnel.weeklyTargets.meetings}
              actual={pace.actual.meetingsPerWeek}
            />
            <ActivityRow
              label="Opps/wk"
              required={funnel.weeklyTargets.opps}
              actual={pace.actual.oppsPerWeek}
            />
          </div>
        </div>

        {/* Expandable Funnel Detail */}
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs text-muted-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
          {expanded ? "Hide" : "Show"} Full Funnel Math
        </Button>

        {expanded && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            {/* Funnel visualization */}
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reverse Funnel to {formatCurrency(quota.newArrGap)} New ARR</div>
            <div className="flex flex-col gap-1">
              <FunnelStep label="Dials" value={funnel.totalNeeded.dials} rate={`${(funnel.benchmarks.dialsToConnect * 100).toFixed(0)}%`} />
              <FunnelArrow />
              <FunnelStep label="Connects" value={funnel.totalNeeded.connects} rate={`${(funnel.benchmarks.connectToMeeting * 100).toFixed(0)}%`} />
              <FunnelArrow />
              <FunnelStep label="Meetings" value={funnel.totalNeeded.meetings} rate={`${(funnel.benchmarks.meetingToOpp * 100).toFixed(0)}%`} />
              <FunnelArrow />
              <FunnelStep label="Opps" value={funnel.totalNeeded.opps} rate={`${(funnel.benchmarks.oppToClose * 100).toFixed(0)}%`} />
              <FunnelArrow />
              <FunnelStep label="Deals Won" value={funnel.totalNeeded.deals} rate={`@ ${formatCurrency(funnel.benchmarks.avgDealSize)} avg`} highlight />
            </div>

            {/* Quota breakdown */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="p-2 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">New Logo</div>
                <div className="font-semibold">{(quota.newArrAttainment * 100).toFixed(0)}% attained</div>
                <div className="text-xs text-muted-foreground">{formatCurrency(quota.newArrGap)} gap</div>
              </div>
              <div className="p-2 rounded-lg bg-muted/30">
                <div className="text-xs text-muted-foreground">Renewals</div>
                <div className="font-semibold">{(quota.renewalArrAttainment * 100).toFixed(0)}% attained</div>
                <div className="text-xs text-muted-foreground">{formatCurrency(quota.renewalArrGap)} gap</div>
              </div>
            </div>

            <div className="text-xs text-muted-foreground italic">
              Based on {pace.dataPoints} days of activity data. Update benchmarks in Settings → Coaching.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ActivityRow({ label, required, actual }: { label: string; required: number; actual: number }) {
  const ahead = actual >= required;
  return (
    <div className="flex items-center justify-between p-2 rounded-lg bg-muted/20">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={cn("text-sm font-semibold", ahead ? "text-recovery" : "text-strain")}>{actual}</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs text-muted-foreground">{required}</span>
        {ahead ? <TrendingUp className="h-3 w-3 text-recovery" /> : <TrendingDown className="h-3 w-3 text-strain" />}
      </div>
    </div>
  );
}

function FunnelStep({ label, value, rate, highlight }: { label: string; value: number; rate: string; highlight?: boolean }) {
  return (
    <div className={cn(
      "flex items-center justify-between p-2 rounded-lg",
      highlight ? "bg-primary/10 border border-primary/20" : "bg-muted/20"
    )}>
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <span className={cn("font-display font-bold", highlight && "text-primary")}>{value.toLocaleString()}</span>
        <Badge variant="outline" className="text-[10px]">{rate}</Badge>
      </div>
    </div>
  );
}

function FunnelArrow() {
  return (
    <div className="flex justify-center py-0.5">
      <ArrowRight className="h-3 w-3 text-muted-foreground rotate-90" />
    </div>
  );
}
