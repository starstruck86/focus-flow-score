import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, Minus, TrendingUp, AlertTriangle, CheckCircle2, Flame } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllTranscriptGrades, useBehavioralPatterns } from '@/hooks/useTranscriptGrades';
import { startOfWeek, endOfWeek, parseISO, isWithinInterval, format } from 'date-fns';

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-grade-excellent', A: 'text-grade-excellent', 'A-': 'text-grade-excellent',
  'B+': 'text-grade-good', B: 'text-grade-good', 'B-': 'text-grade-good',
  'C+': 'text-grade-average', C: 'text-grade-average', 'C-': 'text-grade-average',
  'D+': 'text-grade-poor', D: 'text-grade-poor', F: 'text-grade-failing',
};

export function WeeklyCoachingDigest() {
  const { data: allGrades } = useAllTranscriptGrades();
  const { patterns, weakestArea, trendSummary } = useBehavioralPatterns();

  const digest = useMemo(() => {
    if (!allGrades?.length) return null;

    const now = new Date();
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const weekEnd = endOfWeek(now, { weekStartsOn: 1 });

    const thisWeek = allGrades.filter((g: any) => {
      const date = g.call_transcripts?.call_date ? parseISO(g.call_transcripts.call_date) : parseISO(g.created_at);
      return isWithinInterval(date, { start: weekStart, end: weekEnd });
    });

    const lastWeekStart = new Date(weekStart);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeek = allGrades.filter((g: any) => {
      const date = g.call_transcripts?.call_date ? parseISO(g.call_transcripts.call_date) : parseISO(g.created_at);
      return isWithinInterval(date, { start: lastWeekStart, end: weekStart });
    });

    const thisWeekAvg = thisWeek.length > 0
      ? Math.round(thisWeek.reduce((s: number, g: any) => s + g.overall_score, 0) / thisWeek.length)
      : null;
    const lastWeekAvg = lastWeek.length > 0
      ? Math.round(lastWeek.reduce((s: number, g: any) => s + g.overall_score, 0) / lastWeek.length)
      : null;

    // Improvements this week
    const improving = trendSummary.filter(t => t.direction === 'improving');
    const declining = trendSummary.filter(t => t.direction === 'declining');

    // Top coaching issues this week
    const issues = thisWeek
      .filter((g: any) => g.coaching_issue)
      .map((g: any) => g.coaching_issue);

    return {
      callsThisWeek: thisWeek.length,
      callsLastWeek: lastWeek.length,
      thisWeekAvg,
      lastWeekAvg,
      improving,
      declining,
      issues: [...new Set(issues)],
      totalCalls: allGrades.length,
    };
  }, [allGrades, trendSummary]);

  if (!digest || digest.totalCalls < 2) return null;

  const scoreDelta = digest.thisWeekAvg && digest.lastWeekAvg
    ? digest.thisWeekAvg - digest.lastWeekAvg
    : null;

  return (
    <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.03] to-transparent">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-sm flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary" />
          Weekly Coaching Digest
          <Badge variant="outline" className="text-[10px] ml-auto">
            {format(new Date(), 'MMM d')} week
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-3">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3 text-center">
          <div>
            <p className="text-2xl font-black font-mono">{digest.callsThisWeek}</p>
            <p className="text-[10px] text-muted-foreground">Calls This Week</p>
          </div>
          <div>
            {digest.thisWeekAvg !== null ? (
              <>
                <p className="text-2xl font-black font-mono">{digest.thisWeekAvg}</p>
                <p className="text-[10px] text-muted-foreground">Avg Score</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-black font-mono text-muted-foreground">—</p>
                <p className="text-[10px] text-muted-foreground">Avg Score</p>
              </>
            )}
          </div>
          <div>
            {scoreDelta !== null ? (
              <>
                <p className={cn(
                  'text-2xl font-black font-mono',
                  scoreDelta > 0 ? 'text-grade-excellent' : scoreDelta < 0 ? 'text-grade-failing' : 'text-muted-foreground'
                )}>
                  {scoreDelta > 0 ? '+' : ''}{scoreDelta}
                </p>
                <p className="text-[10px] text-muted-foreground">vs Last Week</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-black font-mono text-muted-foreground">—</p>
                <p className="text-[10px] text-muted-foreground">vs Last Week</p>
              </>
            )}
          </div>
        </div>

        {/* Trend badges */}
        {(digest.improving.length > 0 || digest.declining.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {digest.improving.map(t => (
              <Badge key={t.dimension} variant="outline" className="text-[10px] border-grade-excellent/30 text-grade-excellent gap-0.5">
                <ArrowUp className="h-2.5 w-2.5" /> {t.dimension}
              </Badge>
            ))}
            {digest.declining.map(t => (
              <Badge key={t.dimension} variant="outline" className="text-[10px] border-grade-failing/30 text-grade-failing gap-0.5">
                <ArrowDown className="h-2.5 w-2.5" /> {t.dimension}
              </Badge>
            ))}
          </div>
        )}

        {/* Top issues */}
        {digest.issues.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Recurring Issues</p>
            {digest.issues.slice(0, 3).map((issue, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 text-grade-average flex-shrink-0 mt-0.5" />
                {issue}
              </p>
            ))}
          </div>
        )}

        {/* Weakest area callout */}
        {weakestArea && (
          <div className="text-xs rounded bg-muted/30 p-2">
            <span className="font-semibold">🎯 Priority Focus:</span>{' '}
            <span className="text-muted-foreground">
              {weakestArea.category.replace(/_/g, ' ')} ({weakestArea.avg.toFixed(1)}/5 avg)
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
