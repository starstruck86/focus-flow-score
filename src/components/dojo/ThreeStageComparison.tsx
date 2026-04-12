import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Phone, Target, RotateCcw, ArrowRight, TrendingUp, CheckCircle2, AlertTriangle } from 'lucide-react';
import type { DojoScoreResult } from '@/lib/dojo/types';
import { MISTAKE_LABELS } from '@/lib/dojo/scenarios';
import { assessImprovement } from '@/lib/dojo/improvementAssessment';

interface Stage {
  label: string;
  icon: typeof Phone;
  score: number;
  topMistake: string;
  summary?: string;
}

interface ThreeStageComparisonProps {
  original: DojoScoreResult;
  attempt1: DojoScoreResult;
  retry?: DojoScoreResult | null;
}

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.min(100, Math.max(0, (score / max) * 100));
  const color = score >= 75 ? 'bg-green-500' : score >= 50 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <div className="h-2 rounded-full bg-muted w-full">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function StageCard({ stage, highlight }: { stage: Stage; highlight?: boolean }) {
  const Icon = stage.icon;
  return (
    <div className={`flex-1 min-w-0 p-3 rounded-lg border ${highlight ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-muted/30'}`}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{stage.label}</span>
      </div>
      <p className={`text-2xl font-bold ${stage.score >= 75 ? 'text-green-600' : stage.score >= 50 ? 'text-amber-600' : 'text-red-600'}`}>
        {stage.score}
      </p>
      <ScoreBar score={stage.score} />
      <p className="text-[10px] text-muted-foreground mt-1.5 truncate">
        {MISTAKE_LABELS[stage.topMistake] || stage.topMistake}
      </p>
    </div>
  );
}

export function ThreeStageComparison({ original, attempt1, retry }: ThreeStageComparisonProps) {
  const stages: Stage[] = [
    { label: 'Live Call', icon: Phone, score: original.score, topMistake: original.topMistake },
    { label: '1st Practice', icon: Target, score: attempt1.score, topMistake: attempt1.topMistake },
  ];

  if (retry) {
    stages.push({ label: 'After Coaching', icon: RotateCcw, score: retry.score, topMistake: retry.topMistake });
  }

  // Compare original → best practice result
  const bestPractice = retry || attempt1;
  const verdict = assessImprovement({
    originalScore: original.score,
    trainedScore: bestPractice.score,
    originalTopMistake: original.topMistake,
    trainedTopMistake: bestPractice.topMistake,
  });

  const bestIdx = stages.reduce((best, s, i) => s.score > stages[best].score ? i : best, 0);

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" />
          Progress: Live Call → Practice
        </p>

        {/* Stage cards */}
        <div className="flex gap-2">
          {stages.map((s, i) => (
            <div key={i} className="flex-1 flex items-center gap-1">
              <StageCard stage={s} highlight={i === bestIdx} />
              {i < stages.length - 1 && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 -mx-0.5" />
              )}
            </div>
          ))}
        </div>

        {/* Verdict summary */}
        <div className={`p-3 rounded-lg border ${verdict.improved ? 'bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800' : 'bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {verdict.improved ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            )}
            <span className={`text-xs font-semibold ${verdict.improved ? 'text-green-700 dark:text-green-400' : 'text-amber-700 dark:text-amber-400'}`}>
              {verdict.improved ? `+${verdict.deltaScore} improvement` : 'More practice needed'}
            </span>
            {verdict.deltaScore > 0 && (
              <Badge variant="outline" className="text-[9px] h-4 ml-auto">
                {original.score} → {bestPractice.score}
              </Badge>
            )}
          </div>
          <p className="text-xs text-foreground/80">{verdict.coachingSummary}</p>
        </div>
      </CardContent>
    </Card>
  );
}
