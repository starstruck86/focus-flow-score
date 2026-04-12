/**
 * Weekly Summary Card
 *
 * Shows anchor coverage, per-anchor deltas, top improvement, gaps, and Friday score.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2, Target, Zap } from 'lucide-react';
import type { WeeklySummary } from '@/lib/dojo/v3/weeklySummaryEngine';
import { ANCHOR_LABELS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';

interface WeeklySummaryCardProps {
  summary: WeeklySummary;
}

const ANCHOR_ICONS: Record<DayAnchor, string> = {
  opening_cold_call: '📞',
  discovery_qualification: '🔍',
  objection_pricing: '🛡️',
  deal_control_negotiation: '🎯',
  executive_roi_mixed: '👔',
};

export function WeeklySummaryCard({ summary }: WeeklySummaryCardProps) {
  const coveragePercent = Math.round((summary.anchorsCovered.length / 5) * 100);

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Calendar className="h-4 w-4" />
          Week {summary.weekNumber} Summary
        </CardTitle>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant={coveragePercent === 100 ? 'default' : 'secondary'} className="text-[10px]">
            {summary.anchorsCovered.length}/5 anchors
          </Badge>
          <span className="text-xs text-muted-foreground">
            {summary.totalSessions} sessions · {summary.avgScore} avg
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Anchor coverage grid */}
        <div className="flex gap-1">
          {(['opening_cold_call', 'discovery_qualification', 'objection_pricing', 'deal_control_negotiation', 'executive_roi_mixed'] as DayAnchor[]).map(anchor => {
            const covered = summary.anchorsCovered.includes(anchor);
            const stat = summary.perAnchorStats.find(s => s.anchor === anchor);
            return (
              <div
                key={anchor}
                className={`flex-1 rounded-md p-2 text-center ${covered ? 'bg-primary/10 border border-primary/20' : 'bg-muted/30 border border-border/30'}`}
              >
                <span className="text-sm">{ANCHOR_ICONS[anchor]}</span>
                <p className="text-[9px] font-medium text-muted-foreground mt-0.5 truncate">
                  {ANCHOR_LABELS[anchor]?.split(' / ')[0]}
                </p>
                {covered && stat && stat.currentWeekAvg > 0 && (
                  <p className={`text-xs font-bold mt-0.5 ${stat.currentWeekAvg >= 75 ? 'text-green-600' : stat.currentWeekAvg >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
                    {stat.currentWeekAvg}
                  </p>
                )}
                {!covered && (
                  <p className="text-[9px] text-muted-foreground/50 mt-0.5">—</p>
                )}
              </div>
            );
          })}
        </div>

        {/* Key signals */}
        <div className="space-y-1.5">
          {summary.topImprovement && (
            <div className="flex items-center gap-1.5 text-xs">
              <TrendingUp className="h-3 w-3 text-green-600 shrink-0" />
              <span className="text-green-700 dark:text-green-400">{summary.topImprovement}</span>
            </div>
          )}
          {summary.biggestGap && (
            <div className="flex items-center gap-1.5 text-xs">
              <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400">{summary.biggestGap}</span>
            </div>
          )}
          {summary.fridayScore !== null && (
            <div className="flex items-center gap-1.5 text-xs">
              <Target className="h-3 w-3 text-primary shrink-0" />
              <span>Friday simulation: <span className="font-semibold">{summary.fridayScore}</span></span>
            </div>
          )}
        </div>

        {/* Per-anchor deltas */}
        {summary.perAnchorStats.some(s => s.delta !== 0 && s.priorWeekAvg > 0) && (
          <div className="pt-2 border-t border-border/40">
            <p className="text-[10px] font-semibold text-muted-foreground mb-1">Week-over-week</p>
            <div className="space-y-1">
              {summary.perAnchorStats
                .filter(s => s.priorWeekAvg > 0)
                .map(s => (
                  <div key={s.anchor} className="flex items-center gap-2 text-xs">
                    {s.delta > 0 ? (
                      <TrendingUp className="h-3 w-3 text-green-600" />
                    ) : s.delta < 0 ? (
                      <TrendingDown className="h-3 w-3 text-red-600" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 text-muted-foreground" />
                    )}
                    <span className="w-20 truncate">{s.label}</span>
                    <span className="text-muted-foreground">{s.priorWeekAvg}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-medium">{s.currentWeekAvg}</span>
                    <Badge variant="outline" className={`text-[9px] h-4 ${s.delta > 0 ? 'text-green-600 border-green-300' : s.delta < 0 ? 'text-red-600 border-red-300' : ''}`}>
                      {s.delta > 0 ? '+' : ''}{s.delta}
                    </Badge>
                  </div>
                ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
