/**
 * Weekly Coaching Plan Card — Phase 4
 *
 * Forward-looking weekly coaching at the top of Learn.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Calendar, CheckCircle2, Circle, Zap } from 'lucide-react';
import { ANCHOR_LABELS, type DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import type { WeeklyCoachingPlan } from '@/lib/learning/learnWeeklyEngine';

interface Props {
  plan: WeeklyCoachingPlan;
}

export function WeeklyCoachingPlanCard({ plan }: Props) {
  const completedSet = new Set(plan.anchorsCompleted);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            This Week
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge variant="outline" className="text-[10px]">
            Block {plan.blockNumber} · Week {plan.weekNumber}
          </Badge>
          <Badge variant="secondary" className="text-[10px] capitalize">
            {plan.phase}
          </Badge>
        </div>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          {/* Headline */}
          <p className="text-sm font-semibold text-foreground">{plan.coachingHeadline}</p>

          {plan.coachingBody && (
            <p className="text-xs text-muted-foreground leading-relaxed">{plan.coachingBody}</p>
          )}

          {/* Anchor progress */}
          <div className="flex gap-1.5">
            {plan.anchorsExpected.map(anchor => {
              const done = completedSet.has(anchor);
              const label = ANCHOR_LABELS[anchor];
              return (
                <div
                  key={anchor}
                  className="flex-1 flex flex-col items-center gap-1"
                  title={label}
                >
                  {done ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
                  )}
                  <span className="text-[9px] text-muted-foreground text-center leading-tight truncate w-full">
                    {label.split('/')[0].trim().slice(0, 8)}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Study priorities */}
          {plan.topStudyPriorities.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Focus this week
              </p>
              {plan.topStudyPriorities.map((p, i) => (
                <div key={i} className="flex items-start gap-2">
                  <Zap className="h-3 w-3 text-primary shrink-0 mt-0.5" />
                  <p className="text-xs text-foreground leading-relaxed">{p}</p>
                </div>
              ))}
            </div>
          )}

          {/* Friday badge */}
          {plan.fridayExpected && plan.fridayPressureExpected && (
            <div className="flex items-center gap-1.5 pt-1">
              <Badge variant="outline" className="text-[9px] border-orange-500/30 text-orange-600">
                Friday: Pressure Expected
              </Badge>
              {plan.multiThreadLikely && (
                <Badge variant="outline" className="text-[9px] border-violet-500/30 text-violet-600">
                  Multi-Thread Likely
                </Badge>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
