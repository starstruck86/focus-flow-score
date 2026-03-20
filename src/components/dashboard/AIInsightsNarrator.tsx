import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, TrendingUp, TrendingDown, Minus, Lightbulb } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTrendsData } from '@/hooks/useTrendsData';

export function AIInsightsNarrator() {
  const { data, isLoading } = useTrendsData('14d');

  const insights = useMemo(() => {
    if (!data?.dailyMetrics || data.dailyMetrics.length < 5) return [];

    const metrics = data.dailyMetrics;
    const results: { text: string; type: 'positive' | 'negative' | 'neutral'; icon: typeof TrendingUp }[] = [];

    // Score trend
    const recentScores = metrics.slice(-7).filter(m => m.dailyScore != null).map(m => m.dailyScore!);
    const olderScores = metrics.slice(0, -7).filter(m => m.dailyScore != null).map(m => m.dailyScore!);
    if (recentScores.length >= 3 && olderScores.length >= 3) {
      const recentAvg = recentScores.reduce((s, v) => s + v, 0) / recentScores.length;
      const olderAvg = olderScores.reduce((s, v) => s + v, 0) / olderScores.length;
      const diff = recentAvg - olderAvg;
      if (diff > 1) {
        results.push({ text: `Daily score trending up (+${diff.toFixed(1)} pts) — momentum building`, type: 'positive', icon: TrendingUp });
      } else if (diff < -1) {
        results.push({ text: `Daily score declining (${diff.toFixed(1)} pts) — review your routines`, type: 'negative', icon: TrendingDown });
      }
    }

    // Dial consistency
    const dialDays = metrics.filter(m => m.dials > 0).length;
    const totalDays = metrics.length;
    const dialConsistency = dialDays / totalDays;
    if (dialConsistency >= 0.8) {
      results.push({ text: `Strong prospecting consistency: ${Math.round(dialConsistency * 100)}% of days had dials`, type: 'positive', icon: TrendingUp });
    } else if (dialConsistency < 0.5) {
      results.push({ text: `Prospecting gaps: only ${Math.round(dialConsistency * 100)}% of days had dial activity`, type: 'negative', icon: TrendingDown });
    }

    // Meeting conversion
    const totalDials = metrics.reduce((s, m) => s + m.dials, 0);
    const totalMeetings = metrics.reduce((s, m) => s + m.meetingsSet, 0);
    if (totalDials > 20 && totalMeetings > 0) {
      const rate = totalMeetings / totalDials;
      if (rate > 0.05) {
        results.push({ text: `Above-average dial-to-meeting conversion: ${(rate * 100).toFixed(1)}%`, type: 'positive', icon: Lightbulb });
      }
    }

    // Goal met rate
    const goalMetDays = metrics.filter(m => m.goalMet).length;
    const goalRate = goalMetDays / totalDays;
    if (goalRate >= 0.7) {
      results.push({ text: `Hitting daily goals ${Math.round(goalRate * 100)}% of the time — elite consistency`, type: 'positive', icon: TrendingUp });
    } else if (goalRate < 0.3) {
      results.push({ text: `Goal achievement at ${Math.round(goalRate * 100)}% — consider adjusting targets or focus`, type: 'negative', icon: TrendingDown });
    }

    // Correlations
    if (data.correlations?.length > 0) {
      const strongest = data.correlations[0];
      if (strongest.correlation > 0.5) {
        results.push({ text: `${strongest.factor1} and ${strongest.factor2} are strongly correlated — leverage this`, type: 'neutral', icon: Lightbulb });
      }
    }

    return results.slice(0, 4);
  }, [data]);

  if (isLoading || insights.length === 0) {
    return (
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" />
            AI Insights
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {isLoading ? 'Analyzing trends...' : 'Log more daily data to unlock AI insights.'}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Brain className="h-4 w-4 text-primary" />
          AI Insights
          <Badge variant="outline" className="text-[10px] ml-auto">14d analysis</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {insights.map((insight, i) => {
          const Icon = insight.icon;
          return (
            <div key={i} className="flex items-start gap-2 text-xs">
              <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0",
                insight.type === 'positive' ? 'text-status-green'
                  : insight.type === 'negative' ? 'text-status-red'
                  : 'text-primary'
              )} />
              <span className="text-muted-foreground">{insight.text}</span>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
