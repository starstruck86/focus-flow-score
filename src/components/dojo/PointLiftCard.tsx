/**
 * PointLiftCard — "How to Raise Your Score" section.
 * Shows top 2-3 concrete actions with estimated point gains.
 */

import { TrendingUp, ChevronUp } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { computePointLiftSuggestions } from '@/lib/dojo/skillRubric';
import type { SkillFocus } from '@/lib/dojo/scenarios';

interface Props {
  dimensions: Record<string, unknown> | null | undefined;
  skill: SkillFocus;
}

export function PointLiftCard({ dimensions, skill }: Props) {
  const pointLifts = computePointLiftSuggestions(dimensions, skill);
  if (pointLifts.length === 0) return null;

  return (
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
  );
}
