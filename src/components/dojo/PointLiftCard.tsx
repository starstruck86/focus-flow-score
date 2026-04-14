/**
 * PointLiftCard — "How to Raise Your Score" section.
 * Shows top 2–3 concrete actions with estimated point gains.
 * Skips the primary lever dimension to avoid repeating PrimaryLeverCard.
 */

import { TrendingUp, ChevronUp } from 'lucide-react';
import { computePointLiftSuggestions, selectPrimaryCoachingLever } from '@/lib/dojo/skillRubric';
import type { SkillFocus } from '@/lib/dojo/scenarios';

interface Props {
  dimensions: Record<string, unknown> | null | undefined;
  skill: SkillFocus;
}

export function PointLiftCard({ dimensions, skill }: Props) {
  const pointLifts = computePointLiftSuggestions(dimensions, skill);
  const lever = selectPrimaryCoachingLever(dimensions, skill);
  const primaryDim = lever?.primaryLever;

  // Filter out primary lever to avoid repeating PrimaryLeverCard advice
  const filtered = pointLifts.filter(l => l.dimension !== primaryDim);
  if (filtered.length === 0) return null;

  return (
    <div className="rounded-lg border border-green-500/20 bg-green-500/5 px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <TrendingUp className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
        <p className="text-xs font-semibold text-green-700 dark:text-green-400">
          Also Raise
        </p>
      </div>
      <div className="space-y-2">
        {filtered.slice(0, 2).map((lift) => (
          <div key={lift.dimension} className="space-y-0.5">
            <div className="flex items-center gap-2">
              <ChevronUp className="h-3 w-3 text-green-500 shrink-0" />
              <p className="text-xs font-semibold text-foreground">
                {lift.dimensionLabel}
              </p>
              <p className="text-[10px] text-green-600 dark:text-green-400 font-medium ml-auto whitespace-nowrap">
                +{lift.estimatedLift[0]}–{lift.estimatedLift[1]} pts
              </p>
            </div>
            <p className="text-xs text-foreground leading-snug pl-5">
              {lift.action}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
