/**
 * ExplainableScoreCard — Transparent, rep-specific scoring breakdown.
 * Shows: rubric dimensions with scores, expandable per-dimension explanations,
 * primary coaching lever (not always weakest), point-lift suggestions tied to actual response.
 */

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { TrendingUp, AlertTriangle, Target, ChevronUp, ChevronDown, ChevronRight, Quote, Crosshair } from 'lucide-react';
import { getSkillRubric, computePointLiftSuggestions, findBiggestMiss, normalizeDimensionScores, selectPrimaryCoachingLever } from '@/lib/dojo/skillRubric';
import type { SkillFocus } from '@/lib/dojo/scenarios';

interface Props {
  dimensions: Record<string, unknown> | null | undefined;
  skill: SkillFocus;
  totalScore: number;
}

export function ExplainableScoreCard({ dimensions, skill, totalScore }: Props) {
  const rubric = getSkillRubric(skill);
  const normalized = normalizeDimensionScores(dimensions);
  if (!normalized || !rubric) return null;

  const lever = selectPrimaryCoachingLever(dimensions, skill);
  const biggestMiss = findBiggestMiss(dimensions, skill);
  const pointLifts = computePointLiftSuggestions(dimensions, skill);
  const primaryKey = lever?.primaryLever;

  return (
    <div className="space-y-3">
      {/* Dimension Breakdown */}
      <Card className="border-border/60">
        <CardContent className="p-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-3.5 w-3.5 text-primary" />
              <p className="text-xs font-semibold text-foreground">Scoring Breakdown</p>
            </div>
            <Badge variant="outline" className="text-[10px]">{rubric.label}</Badge>
          </div>

          <div className="space-y-1">
            {rubric.dimensions.map((dim) => {
              const detail = normalized[dim.key];
              const score = detail?.score ?? 0;
              const hasDetail = !!(detail?.reason || detail?.evidence);
              const isPrimary = dim.key === primaryKey;

              return (
                <DimensionRow
                  key={dim.key}
                  label={dim.label}
                  weight={dim.weight}
                  score={score}
                  reason={detail?.reason || ''}
                  evidence={detail?.evidence || ''}
                  improvementAction={detail?.improvementAction || dim.pointLiftCue}
                  targetFor7={detail?.targetFor7 || dim.good}
                  targetFor9={detail?.targetFor9 || dim.elite}
                  hasDetail={hasDetail}
                  isPrimaryLever={isPrimary}
                />
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
          {biggestMiss.evidence && (
            <div className="flex items-start gap-1.5 pl-[22px]">
              <Quote className="h-3 w-3 text-destructive/60 mt-0.5 shrink-0" />
              <p className="text-xs text-destructive/80 italic leading-relaxed">
                {biggestMiss.evidence}
              </p>
            </div>
          )}
          <div className="pl-[22px] pt-1">
            <p className="text-xs text-foreground font-medium">
              <span className="text-destructive">Fix: </span>{biggestMiss.fix}
            </p>
          </div>
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
            <div className="space-y-2.5">
              {pointLifts.map((lift) => (
                <div key={lift.dimension} className="pl-[22px] space-y-0.5">
                  <div className="flex items-center gap-2">
                    <ChevronUp className="h-3 w-3 text-green-500 shrink-0" />
                    <p className="text-xs font-semibold text-foreground">
                      {lift.dimensionLabel}
                    </p>
                    <p className="text-[10px] text-green-600 dark:text-green-400 font-medium ml-auto">
                      likely +{lift.estimatedLift[0]} to +{lift.estimatedLift[1]} pts
                    </p>
                  </div>
                  {lift.evidence && (
                    <p className="text-[11px] text-muted-foreground italic pl-5">
                      You said: "{lift.evidence}"
                    </p>
                  )}
                  <p className="text-xs text-foreground leading-snug pl-5">
                    {lift.action}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Expandable dimension row */
function DimensionRow({
  label, weight, score, reason, evidence, improvementAction, targetFor7, targetFor9, hasDetail,
}: {
  label: string;
  weight: number;
  score: number;
  reason: string;
  evidence: string;
  improvementAction: string;
  targetFor7: string;
  targetFor9: string;
  hasDetail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isWeak = score <= 4;
  const isStrong = score >= 8;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="w-full" disabled={!hasDetail}>
        <div className="space-y-0.5 py-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground flex items-center gap-1">
              {hasDetail && (
                open ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />
              )}
              {label}
              <span className="text-[9px] opacity-60">({weight}%)</span>
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
      </CollapsibleTrigger>

      <CollapsibleContent>
        <div className="pl-4 pb-2 pt-1 space-y-2 border-l-2 border-border/40 ml-1.5">
          {reason && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Why this score</p>
              <p className="text-xs text-foreground leading-relaxed">{reason}</p>
            </div>
          )}
          {evidence && (
            <div className="flex items-start gap-1.5">
              <Quote className="h-3 w-3 text-muted-foreground/50 mt-0.5 shrink-0" />
              <p className="text-[11px] text-muted-foreground italic leading-relaxed">{evidence}</p>
            </div>
          )}
          {improvementAction && (
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">To improve</p>
              <p className="text-xs text-foreground leading-relaxed">{improvementAction}</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {targetFor7 && (
              <div className="rounded-md bg-amber-500/5 border border-amber-500/15 px-2 py-1.5">
                <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wider mb-0.5">~7/10</p>
                <p className="text-[11px] text-foreground leading-snug">{targetFor7}</p>
              </div>
            )}
            {targetFor9 && (
              <div className="rounded-md bg-green-500/5 border border-green-500/15 px-2 py-1.5">
                <p className="text-[9px] font-bold text-green-600 dark:text-green-400 uppercase tracking-wider mb-0.5">~9/10</p>
                <p className="text-[11px] text-foreground leading-snug">{targetFor9}</p>
              </div>
            )}
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
