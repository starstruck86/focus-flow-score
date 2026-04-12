/**
 * "Under Pressure" Card — Phase 3
 *
 * Shows where execution changes when pressure increases.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Flame, ArrowDown, ArrowUp, Minus } from 'lucide-react';
import type { PressureBreakdown } from '@/lib/learning/learnAdaptationEngine';

interface Props {
  pressure: PressureBreakdown;
}

export function PressureBreakdownCard({ pressure }: Props) {
  if (pressure.pressureScore == null || pressure.firstAttemptStrength === 0) return null;

  const gap = pressure.gap ?? 0;
  const gapColor = gap <= 5 ? 'text-green-500' : gap <= 12 ? 'text-amber-500' : 'text-destructive';
  const GapIcon = gap <= 5 ? Minus : ArrowDown;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Flame className="h-3.5 w-3.5 text-orange-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Under Pressure
        </p>
      </div>

      <Card className="border-orange-500/15">
        <CardContent className="p-4 space-y-3">
          {/* Score comparison */}
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">{pressure.firstAttemptStrength}</p>
              <p className="text-[10px] text-muted-foreground">Baseline</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-foreground">{pressure.pressureScore}</p>
              <p className="text-[10px] text-muted-foreground">Under Pressure</p>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1">
                <GapIcon className={`h-3.5 w-3.5 ${gapColor}`} />
                <p className={`text-lg font-semibold ${gapColor}`}>{gap}</p>
              </div>
              <p className="text-[10px] text-muted-foreground">Gap</p>
            </div>
          </div>

          {/* Interpretation */}
          <p className="text-xs text-foreground leading-relaxed">{pressure.interpretation}</p>

          {/* Detail metrics if available */}
          {(pressure.flowControl != null || pressure.closingUnderPressure != null || pressure.lateTurnDropoff != null) && (
            <div className="flex gap-3 pt-1">
              {pressure.flowControl != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Flow:</span>
                  <span className="text-xs font-medium text-foreground">{pressure.flowControl}</span>
                </div>
              )}
              {pressure.closingUnderPressure != null && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Closing:</span>
                  <span className="text-xs font-medium text-foreground">{pressure.closingUnderPressure}</span>
                </div>
              )}
              {pressure.lateTurnDropoff != null && pressure.lateTurnDropoff > 0 && (
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] text-muted-foreground">Late drop:</span>
                  <span className="text-xs font-medium text-destructive">-{pressure.lateTurnDropoff}</span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
