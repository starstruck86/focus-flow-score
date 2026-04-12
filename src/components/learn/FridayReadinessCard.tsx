/**
 * Friday Readiness Card — Phase 4
 *
 * Prepares the user for Friday before they hit it.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Flame, AlertTriangle, BookOpen, Shield } from 'lucide-react';
import type { FridayReadiness } from '@/lib/learning/learnWeeklyEngine';

interface Props {
  readiness: FridayReadiness;
}

export function FridayReadinessCard({ readiness }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Flame className="h-3.5 w-3.5 text-orange-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Before Friday
        </p>
      </div>

      <Card className="border-orange-500/15">
        <CardContent className="p-4 space-y-3">
          {/* Expectations */}
          <div className="flex flex-wrap gap-1.5">
            {readiness.pressureExpected && (
              <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-600">
                Pressure
              </Badge>
            )}
            {readiness.simulationExpected && (
              <Badge variant="outline" className="text-[9px] border-primary/30 text-primary">
                Simulation
              </Badge>
            )}
            {readiness.multiThreadLikely && (
              <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600">
                Multi-Thread
              </Badge>
            )}
          </div>

          {/* Why it matters */}
          <p className="text-xs text-foreground leading-relaxed">{readiness.whyItMatters}</p>

          {/* Primary risk */}
          {readiness.primaryRisk && (
            <div className="flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-foreground leading-relaxed">
                <span className="font-medium">Risk: </span>
                {readiness.primaryRisk}
              </p>
            </div>
          )}

          {/* Prep focus */}
          <div className="flex gap-2">
            <Shield className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              <span className="font-medium">Prep: </span>
              {readiness.prepFocus}
            </p>
          </div>

          {/* Recommended KIs */}
          {readiness.recommendedKITitles.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Study before Friday
              </p>
              {readiness.recommendedKITitles.map((title, i) => (
                <div key={i} className="flex items-start gap-2">
                  <BookOpen className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">{title}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
