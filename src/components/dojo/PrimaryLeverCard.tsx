/**
 * PrimaryLeverCard — The single most important coaching diagnosis.
 * Role: WHAT broke and WHY. Does NOT prescribe the fix (that's NextRepGoalBanner).
 */

import { Quote, Crosshair } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { selectPrimaryCoachingLever, normalizeDimensionScores, findBiggestMiss } from '@/lib/dojo/skillRubric';
import type { SkillFocus } from '@/lib/dojo/scenarios';

interface Props {
  dimensions: Record<string, unknown> | null | undefined;
  skill: SkillFocus;
  /** Omit the fix line to avoid overlap with NextRepGoalBanner */
  compact?: boolean;
}

export function PrimaryLeverCard({ dimensions, skill, compact = false }: Props) {
  const lever = selectPrimaryCoachingLever(dimensions, skill);
  const biggestMiss = findBiggestMiss(dimensions, skill);
  if (!lever || !biggestMiss) return null;

  return (
    <div className="rounded-lg border-l-4 border-l-destructive bg-destructive/5 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-2">
        <Crosshair className="h-3.5 w-3.5 text-destructive shrink-0" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-destructive">
          Fix This First
        </p>
        {lever.leverDiffersFromWeakest && (
          <Badge variant="outline" className="text-[9px] border-destructive/30 text-destructive">
            highest leverage
          </Badge>
        )}
      </div>

      <p className="text-sm font-semibold text-foreground leading-snug">
        {biggestMiss.dimensionLabel} — {biggestMiss.score}/10
      </p>

      {biggestMiss.reason && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {biggestMiss.reason}
        </p>
      )}

      {biggestMiss.evidence && (
        <div className="flex items-start gap-1.5">
          <Quote className="h-3 w-3 text-destructive/60 mt-0.5 shrink-0" />
          <p className="text-[11px] text-destructive/80 italic leading-relaxed">
            {biggestMiss.evidence}
          </p>
        </div>
      )}

      {lever.leverDiffersFromWeakest && lever.whyChosenCoaching && (
        <p className="text-[11px] text-muted-foreground italic leading-relaxed">
          {lever.whyChosenCoaching}
        </p>
      )}
    </div>
  );
}
