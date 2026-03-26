import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowUp, ArrowDown, TrendingUp, AlertTriangle, Lightbulb, Target, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAllTranscriptGrades, useBehavioralPatterns } from '@/hooks/useTranscriptGrades';
import { useWeeklyPlaybookSummary } from '@/hooks/usePlaybookUsageTracking';
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
  const { data: playbookSummary } = useWeeklyPlaybookSummary();

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

    const improving = trendSummary.filter(t => t.direction === 'improving');
    const declining = trendSummary.filter(t => t.direction === 'declining');

    // Recurring coaching issues
    const issues = thisWeek
      .filter((g: any) => g.coaching_issue)
      .map((g: any) => g.coaching_issue);

    // Repeated patterns — flags appearing in 50%+ of calls
    const repeatedMisses = patterns.filter(p => p.pct >= 50).slice(0, 3);

    // Repeated strengths — find most common strengths
    const strengthCounts = new Map<string, number>();
    allGrades.slice(0, 10).forEach((g: any) => {
      (g.strengths || []).forEach((s: string) => {
        strengthCounts.set(s, (strengthCounts.get(s) || 0) + 1);
      });
    });
    const repeatedSuccesses = [...strengthCounts.entries()]
      .filter(([, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([s]) => s);

    // Underused playbooks — recommended but never practiced
    const underusedPlaybooks = playbookSummary && playbookSummary.recommendationsShown > 0 && playbookSummary.roleplaysCompleted === 0;

    return {
      callsThisWeek: thisWeek.length,
      callsLastWeek: lastWeek.length,
      thisWeekAvg,
      lastWeekAvg,
      improving,
      declining,
      issues: [...new Set(issues)],
      totalCalls: allGrades.length,
      repeatedMisses,
      repeatedSuccesses,
      underusedPlaybooks,
    };
  }, [allGrades, trendSummary, patterns, playbookSummary]);

  // Build recommendations
  const recommendations = useMemo(() => {
    if (!digest || !weakestArea) return null;

    const recs: { icon: typeof Target; label: string; detail: string }[] = [];

    // 1-2 things to improve
    if (digest.repeatedMisses.length > 0) {
      recs.push({
        icon: AlertTriangle,
        label: 'Fix this pattern',
        detail: digest.repeatedMisses[0].label,
      });
    }
    if (weakestArea) {
      recs.push({
        icon: Target,
        label: 'Focus area',
        detail: `${weakestArea.category.replace(/_/g, ' ')} (${weakestArea.avg.toFixed(1)}/5)`,
      });
    }

    // 1 playbook to focus on
    if (playbookSummary?.topPlaybooks?.[0]) {
      recs.push({
        icon: BookOpen,
        label: 'Keep practicing',
        detail: playbookSummary.topPlaybooks[0].title,
      });
    } else if (digest.underusedPlaybooks) {
      recs.push({
        icon: BookOpen,
        label: 'Try a roleplay',
        detail: 'You have recommendations but haven\'t practiced yet',
      });
    }

    return recs.length > 0 ? recs : null;
  }, [digest, weakestArea, playbookSummary]);

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

        {/* Repeated patterns — misses & successes */}
        {(digest.repeatedMisses.length > 0 || digest.repeatedSuccesses.length > 0) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Patterns</p>
            {digest.repeatedMisses.map((m) => (
              <p key={m.flag} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <AlertTriangle className="h-3 w-3 text-grade-average flex-shrink-0 mt-0.5" />
                <span><span className="font-medium text-foreground">{m.label}</span> — {m.pct}% of calls</span>
              </p>
            ))}
            {digest.repeatedSuccesses.map((s) => (
              <p key={s} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <ArrowUp className="h-3 w-3 text-grade-excellent flex-shrink-0 mt-0.5" />
                <span className="text-foreground">{s}</span>
              </p>
            ))}
          </div>
        )}

        {/* Recurring issues */}
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

        {/* Recommendations — the actionable part */}
        {recommendations && (
          <div className="space-y-1.5 pt-1 border-t border-border/50">
            <p className="text-[10px] font-semibold text-primary uppercase tracking-wider flex items-center gap-1">
              <Lightbulb className="h-3 w-3" /> Next Week Focus
            </p>
            {recommendations.map((rec, i) => (
              <div key={i} className="flex items-start gap-1.5 text-xs">
                <rec.icon className="h-3 w-3 text-primary flex-shrink-0 mt-0.5" />
                <span>
                  <span className="font-semibold text-foreground">{rec.label}:</span>{' '}
                  <span className="text-muted-foreground">{rec.detail}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
