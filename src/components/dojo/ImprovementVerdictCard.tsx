import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';
import { type ImprovementVerdict } from '@/lib/dojo/improvementAssessment';

const TYPE_CONFIG: Record<string, { icon: typeof TrendingUp; color: string; label: string }> = {
  mistake_eliminated: { icon: CheckCircle2, color: 'text-green-600', label: 'Mistake Fixed' },
  severity_reduced: { icon: TrendingUp, color: 'text-green-600', label: 'Severity Reduced' },
  category_shifted: { icon: ArrowRight, color: 'text-blue-600', label: 'Focus Shifted' },
  specificity_increased: { icon: TrendingUp, color: 'text-blue-600', label: 'Execution Improved' },
  no_change: { icon: Minus, color: 'text-amber-600', label: 'No Real Change' },
  regression: { icon: TrendingDown, color: 'text-red-600', label: 'Regression' },
};

interface ImprovementVerdictCardProps {
  verdict: ImprovementVerdict;
  originalScore: number;
  trainedScore: number;
}

export function ImprovementVerdictCard({ verdict, originalScore, trainedScore }: ImprovementVerdictCardProps) {
  const config = TYPE_CONFIG[verdict.improvementType] || TYPE_CONFIG.no_change;
  const Icon = config.icon;

  return (
    <Card className={`border-l-4 ${verdict.improved ? 'border-l-green-500' : verdict.improvementType === 'regression' ? 'border-l-red-500' : 'border-l-amber-500'}`}>
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${config.color}`} />
            <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">Original: {originalScore}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className={verdict.deltaScore > 0 ? 'text-green-600 font-medium' : verdict.deltaScore < 0 ? 'text-red-600 font-medium' : 'text-muted-foreground'}>
              Trained: {trainedScore}
            </span>
            {verdict.deltaScore !== 0 && (
              <Badge variant={verdict.deltaScore > 0 ? 'default' : 'destructive'} className="text-[10px] h-4">
                {verdict.deltaScore > 0 ? '+' : ''}{verdict.deltaScore}
              </Badge>
            )}
          </div>
        </div>

        {/* Primary Change */}
        <p className="text-sm">{verdict.primaryChange}</p>

        {/* Dave's Coaching Summary */}
        <div className="bg-muted/50 rounded-lg p-3 border border-border/40">
          <p className="text-[10px] font-semibold text-muted-foreground mb-1">🎯 Dave's Assessment</p>
          <p className="text-sm">{verdict.coachingSummary}</p>
        </div>

        {/* Secondary Changes */}
        {verdict.secondaryChanges.length > 0 && (
          <div className="space-y-1">
            {verdict.secondaryChanges.map((change, i) => (
              <p key={i} className="text-xs text-muted-foreground flex items-center gap-1.5">
                <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                {change}
              </p>
            ))}
          </div>
        )}

        {/* Remaining Gaps */}
        {verdict.remainingGaps.length > 0 && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold text-muted-foreground">Still needs work:</p>
            {verdict.remainingGaps.map((gap, i) => (
              <p key={i} className="text-xs text-amber-600 flex items-center gap-1.5">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {gap}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
