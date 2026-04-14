/**
 * ExplainableScoreCard — Transparent scoring breakdown.
 * Shows: rubric dimensions with scores, biggest miss, point-lift suggestions.
 */

import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, AlertTriangle, Target, ChevronUp } from 'lucide-react';
import { getSkillRubric, computePointLiftSuggestions, findBiggestMiss } from '@/lib/dojo/skillRubric';
import type { SkillFocus } from '@/lib/dojo/scenarios';

interface Props {
  dimensions: Record<string, number> | null | undefined;
  skill: SkillFocus;
  totalScore: number;
}

export function ExplainableScoreCard({ dimensions, skill, totalScore }: Props) {
  const rubric = getSkillRubric(skill);
  if (!dimensions || !rubric) return null;

  const biggestMiss = findBiggestMiss(dimensions, skill);
  const pointLifts = computePointLiftSuggestions(dimensions, skill);

  return (
    <div className="space-y-3">
      {/* Dimension Breakdown */}
      <Card className="border-border/60">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-semibold text-foreground">Scoring Rubric</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{rubric.label}</Badge>
          </div>

          <div className="space-y-2">
            {rubric.dimensions.map((dim) => {
              const score = dimensions[dim.key] ?? 0;
              const isWeak = score <= 4;
              const isStrong = score >= 8;

              return (
                <div key={dim.key} className="space-y-0.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-muted-foreground">
                      {dim.label}
                      <span className="text-[9px] ml-1 opacity-60">({dim.weight}%)</span>
                    </span>
                    <span className={`text-[11px] font-mono font-bold ${
                      isStrong ? 'text-green-500' : isWeak ? 'text-destructive' : 'text-amber-500'
                    }`}>
                      {score}/10
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isStrong ? 'bg-green-500' : isWeak ? 'bg-destructive' : 'bg-amber-500'
                      }`}
                      style={{ width: `${score * 10}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Biggest Miss */}
      {biggestMiss && (
        <div className="rounded-lg border-l-4 border-l-destructive bg-destructive/5 px-3.5 py-3 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
              Biggest Scoring Drag
            </p>
          </div>
          <p className="text-[13px] font-semibold text-foreground leading-snug pl-[22px]">
            {biggestMiss.dimensionLabel} — {biggestMiss.score}/10
          </p>
          <p className="text-xs text-muted-foreground pl-[22px] leading-relaxed">
            {biggestMiss.reason}
          </p>
        </div>
      )}

      {/* Point-Lift Suggestions */}
      {pointLifts.length > 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-3 space-y-2.5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              <p className="text-xs font-semibold text-green-700 dark:text-green-400">
                How to Raise Your Score
              </p>
            </div>
            <div className="space-y-2">
              {pointLifts.map((lift) => (
                <div key={lift.dimension} className="flex items-start gap-2 pl-[22px]">
                  <ChevronUp className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs text-foreground leading-snug">
                      {lift.action}
                    </p>
                    <p className="text-[10px] text-green-600 dark:text-green-400 font-medium">
                      likely +{lift.estimatedLift[0]} to +{lift.estimatedLift[1]} pts
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
