import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { TrendingUp, TrendingDown, Minus, Target, ShieldCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useStore } from '@/store/useStore';
import { useAllTranscriptGrades } from '@/hooks/useTranscriptGrades';
import { format, parseISO } from 'date-fns';

const CATEGORY_LABELS: Record<string, string> = {
  structure: 'Structure',
  cotm: 'Command of Message',
  meddicc: 'MEDDICC',
  discovery: 'Discovery',
  presence: 'Presence',
  commercial: 'Commercial',
  next_step: 'Next Step',
};

const GRADE_COLORS: Record<string, string> = {
  'A+': 'text-grade-excellent', A: 'text-grade-excellent', 'A-': 'text-grade-excellent',
  'B+': 'text-grade-good', B: 'text-grade-good', 'B-': 'text-grade-good',
  'C+': 'text-grade-average', C: 'text-grade-average', 'C-': 'text-grade-average',
  'D+': 'text-grade-poor', D: 'text-grade-poor', F: 'text-grade-failing',
};

interface DealSummary {
  opportunityId: string;
  opportunityName: string;
  accountName: string;
  callCount: number;
  avgScore: number;
  latestGrade: string;
  trend: 'improving' | 'declining' | 'stable';
  meddiccProgress: number;
  weakestCategory: string;
  grades: any[];
}

export function DealIntelligence() {
  const opportunities = useStore(s => s.opportunities);
  const accounts = useStore(s => s.accounts);
  const { data: allGrades } = useAllTranscriptGrades();

  const dealSummaries = useMemo(() => {
    if (!allGrades?.length) return [];

    // Group grades by opportunity_id first, then fall back to account_id
    const byOpp = new Map<string, { type: 'opp' | 'account'; grades: any[] }>();
    allGrades.forEach((g: any) => {
      const oppId = g.call_transcripts?.opportunity_id;
      const accountId = g.call_transcripts?.account_id;
      // Prefer opportunity-level grouping when available
      if (oppId) {
        const key = `opp:${oppId}`;
        if (!byOpp.has(key)) byOpp.set(key, { type: 'opp', grades: [] });
        byOpp.get(key)!.grades.push(g);
      } else if (accountId) {
        const key = `account:${accountId}`;
        if (!byOpp.has(key)) byOpp.set(key, { type: 'account', grades: [] });
        byOpp.get(key)!.grades.push(g);
      }
    });

    const summaries: DealSummary[] = [];

    byOpp.forEach((grades, accountId) => {
      if (grades.length < 1) return;

      const account = accounts.find(a => a.id === accountId);
      const relatedOpps = opportunities.filter(o => o.accountId === accountId);

      // Sort by date
      const sorted = [...grades].sort((a, b) => {
        const dA = a.call_transcripts?.call_date || a.created_at;
        const dB = b.call_transcripts?.call_date || b.created_at;
        return dA.localeCompare(dB);
      });

      const avgScore = Math.round(sorted.reduce((s: number, g: any) => s + g.overall_score, 0) / sorted.length);
      const latest = sorted[sorted.length - 1];

      // Trend
      let trend: 'improving' | 'declining' | 'stable' = 'stable';
      if (sorted.length >= 2) {
        const recent = sorted[sorted.length - 1].overall_score;
        const prev = sorted[sorted.length - 2].overall_score;
        if (recent - prev > 5) trend = 'improving';
        else if (prev - recent > 5) trend = 'declining';
      }

      // MEDDICC progress from latest grade
      const meddicc = latest.meddicc_signals as any || {};
      const meddiccFields = ['metrics', 'economic_buyer', 'decision_criteria', 'decision_process', 'identify_pain', 'champion', 'competition'];
      const meddiccCovered = meddiccFields.filter(k => meddicc[k]).length;
      const meddiccProgress = Math.round((meddiccCovered / meddiccFields.length) * 100);

      // Weakest category
      const categories = ['structure', 'cotm', 'meddicc', 'discovery', 'presence', 'commercial', 'next_step'];
      const catAvgs = categories.map(cat => ({
        cat,
        avg: sorted.reduce((s: number, g: any) => s + ((g as any)[`${cat}_score`] || 0), 0) / sorted.length,
      }));
      catAvgs.sort((a, b) => a.avg - b.avg);

      summaries.push({
        opportunityId: relatedOpps[0]?.id || accountId,
        opportunityName: relatedOpps[0]?.name || account?.name || 'Unknown',
        accountName: account?.name || 'Unknown',
        callCount: sorted.length,
        avgScore,
        latestGrade: latest.overall_grade,
        trend,
        meddiccProgress,
        weakestCategory: CATEGORY_LABELS[catAvgs[0].cat] || catAvgs[0].cat,
        grades: sorted,
      });
    });

    return summaries.sort((a, b) => b.callCount - a.callCount);
  }, [allGrades, opportunities, accounts]);

  if (dealSummaries.length === 0) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="p-6 text-center text-muted-foreground">
          <Target className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm font-medium">No deal-level data yet</p>
          <p className="text-xs">Link transcripts to accounts to see aggregate intelligence per deal</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Deal-Level Intelligence</p>
      {dealSummaries.map(deal => (
        <Card key={deal.opportunityId} className="border-border/50 hover:border-primary/20 transition-colors">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{deal.opportunityName}</p>
                <p className="text-xs text-muted-foreground">{deal.accountName} · {deal.callCount} call{deal.callCount > 1 ? 's' : ''} graded</p>
              </div>
              <div className="flex items-center gap-2">
                {deal.trend === 'improving' && <TrendingUp className="h-4 w-4 text-grade-excellent" />}
                {deal.trend === 'declining' && <TrendingDown className="h-4 w-4 text-grade-failing" />}
                {deal.trend === 'stable' && <Minus className="h-4 w-4 text-muted-foreground" />}
                <span className={cn('text-xl font-black font-mono', GRADE_COLORS[deal.latestGrade])}>
                  {deal.latestGrade}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <p className="text-muted-foreground">Avg Score</p>
                <p className="font-mono font-bold">{deal.avgScore}/100</p>
              </div>
              <div>
                <p className="text-muted-foreground">MEDDICC</p>
                <div className="flex items-center gap-1.5">
                  <Progress value={deal.meddiccProgress} className="h-1.5 flex-1" />
                  <span className="font-mono text-[10px]">{deal.meddiccProgress}%</span>
                </div>
              </div>
              <div>
                <p className="text-muted-foreground">Focus Area</p>
                <Badge variant="outline" className="text-[9px] h-4">{deal.weakestCategory}</Badge>
              </div>
            </div>

            {/* Mini grade timeline */}
            <div className="flex gap-1 items-center">
              <span className="text-[10px] text-muted-foreground mr-1">Calls:</span>
              {deal.grades.map((g: any, i: number) => (
                <span
                  key={i}
                  className={cn(
                    'text-[10px] font-mono font-bold px-1 rounded',
                    GRADE_COLORS[g.overall_grade],
                    'bg-muted/30'
                  )}
                  title={g.call_transcripts?.call_date ? format(parseISO(g.call_transcripts.call_date), 'MMM d') : ''}
                >
                  {g.overall_grade}
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
