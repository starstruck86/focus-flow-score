// Coaching Feed — Unified stream of AI coaching alerts, nudges, and insights
import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useStore } from '@/store/useStore';
import { usePipelineHygiene, useConversionMath } from '@/hooks/useCoachingEngine';
import { useTodayJournalEntry } from '@/hooks/useDailyJournal';
import { 
  Brain, AlertTriangle, TrendingDown, TrendingUp, 
  Target, Calendar, Clock, CheckCircle2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { differenceInDays, parseISO } from 'date-fns';

interface CoachingAlert {
  id: string;
  type: 'warning' | 'insight' | 'action' | 'win';
  icon: React.ElementType;
  title: string;
  detail: string;
  priority: number;
}

export function CoachingFeed() {
  const { data: hygiene } = usePipelineHygiene();
  const { data: convMath } = useConversionMath();
  const { data: todayEntry } = useTodayJournalEntry();
  const opportunities = useStore(s => s.opportunities);
  const renewals = useStore(s => s.renewals);

  const alerts = useMemo<CoachingAlert[]>(() => {
    const items: CoachingAlert[] = [];

    // Pace alerts from conversion math
    if (convMath) {
      if (!convMath.pace.onPace) {
        const dialGap = convMath.pace.required.dialsPerDay - convMath.pace.actual.dialsPerDay;
        if (dialGap > 5) {
          items.push({
            id: 'dial-pace',
            type: 'warning',
            icon: TrendingDown,
            title: `${Math.round(dialGap)} more dials/day needed`,
            detail: `Current: ${convMath.pace.actual.dialsPerDay}/day vs ${convMath.pace.required.dialsPerDay} required to hit number`,
            priority: 1,
          });
        }
      }
      if (convMath.pipeline.pipelineCoverage < 2.5) {
        items.push({
          id: 'coverage-low',
          type: 'warning',
          icon: Target,
          title: `Pipeline coverage at ${convMath.pipeline.pipelineCoverage}x`,
          detail: `Need 3x+ coverage. ${convMath.pipeline.activeDeals} active deals totaling ${formatCurrency(convMath.pipeline.activePipelineArr)}`,
          priority: 2,
        });
      }
      if (convMath.pace.onPace) {
        items.push({
          id: 'on-pace',
          type: 'win',
          icon: TrendingUp,
          title: 'Activity pace is on track',
          detail: `${convMath.pace.actual.dialsPerDay} dials/day, ${convMath.pace.actual.meetingsPerWeek} meetings/week`,
          priority: 8,
        });
      }
    }

    // Pipeline hygiene critical issues
    if (hygiene && typeof hygiene === 'object' && 'critical_issues' in hygiene) {
      const h = hygiene as { critical_issues: number; health_score: number };
      if (h.critical_issues > 0) {
        items.push({
          id: 'hygiene-critical',
          type: 'action',
          icon: AlertTriangle,
          title: `${h.critical_issues} critical pipeline issues`,
          detail: `Health score: ${h.health_score}/100. Run pipeline hygiene scan to review.`,
          priority: 1,
        });
      }
    }

    // Renewal risk check
    const today = new Date();
    const atRiskRenewals = renewals.filter(r => {
      const daysTo = differenceInDays(parseISO(r.renewalDue), today);
      return daysTo <= 45 && daysTo > 0 && (r.churnRisk === 'high' || r.churnRisk === 'certain');
    });
    if (atRiskRenewals.length > 0) {
      const totalArr = atRiskRenewals.reduce((s, r) => s + r.arr, 0);
      items.push({
        id: 'renewal-risk',
        type: 'warning',
        icon: AlertTriangle,
        title: `${atRiskRenewals.length} at-risk renewal(s) in 45 days`,
        detail: `${formatCurrency(totalArr)} ARR at risk. Focus on ${atRiskRenewals[0]?.accountName}`,
        priority: 1,
      });
    }

    // Stale deal check
    const staleDeals = opportunities.filter(o => {
      if (o.status !== 'active') return false;
      if (!o.lastTouchDate) return true;
      return differenceInDays(today, parseISO(o.lastTouchDate)) > 14;
    });
    if (staleDeals.length > 0) {
      items.push({
        id: 'stale-deals',
        type: 'action',
        icon: Clock,
        title: `${staleDeals.length} deal(s) untouched 14+ days`,
        detail: staleDeals.slice(0, 2).map(d => d.name).join(', '),
        priority: 3,
      });
    }

    // Journal nudge
    if (!todayEntry?.checkedIn) {
      items.push({
        id: 'journal-nudge',
        type: 'action',
        icon: Calendar,
        title: 'Log your day',
        detail: 'Daily check-in builds the data that powers your coaching insights.',
        priority: 5,
      });
    }

    return items.sort((a, b) => a.priority - b.priority);
  }, [convMath, hygiene, todayEntry, opportunities, renewals]);

  const typeStyles = {
    warning: 'border-l-strain text-strain',
    insight: 'border-l-primary text-primary',
    action: 'border-l-status-yellow text-status-yellow',
    win: 'border-l-recovery text-recovery',
  };

  // FIX: Show positive "all clear" state instead of returning null
  return (
    <Card className="metric-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          Coach
          {alerts.length > 0 && (
            <Badge variant="outline" className="text-[10px] ml-auto">{alerts.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-recovery/10 text-recovery">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="text-sm font-medium">All clear — you're in good shape today.</span>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {alerts.slice(0, 6).map(alert => {
                const Icon = alert.icon;
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "border-l-2 pl-3 py-2 rounded-r-md bg-muted/20",
                      typeStyles[alert.type]
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="text-xs font-semibold text-foreground">{alert.title}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-0.5 pl-5">{alert.detail}</p>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

function formatCurrency(n: number) {
  if (n >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `$${(n / 1000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
