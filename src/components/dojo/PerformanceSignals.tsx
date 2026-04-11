import { useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import {
  BarChart3, TrendingUp, TrendingDown, AlertTriangle, Target, Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SKILL_LABELS, type SkillFocus } from '@/lib/dojo/scenarios';
import type { SkillStat } from '@/lib/dojo/scenarios';
import type { CoachingInsights } from '@/lib/dojo/types';

interface PerformanceSignalsProps {
  skillStats: SkillStat[];
  coachingInsights: CoachingInsights | null;
}

export function PerformanceSignals({ skillStats, coachingInsights }: PerformanceSignalsProps) {
  if (skillStats.length === 0 && !coachingInsights) return null;

  return (
    <div className="space-y-4">
      {/* Skill progress bars */}
      {skillStats.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <BarChart3 className="h-3.5 w-3.5" />
            Skill Profile
          </p>
          <div className="space-y-2">
            {skillStats.map(s => (
              <div key={s.skill} className="flex items-center gap-3 px-1">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-xs font-medium truncate">{SKILL_LABELS[s.skill]}</p>
                    <span className="text-xs text-muted-foreground">{s.avgFirstAttempt} avg · {s.count} reps</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full transition-all',
                        s.avgFirstAttempt >= 75 ? 'bg-green-500' :
                        s.avgFirstAttempt >= 60 ? 'bg-amber-500' : 'bg-red-500'
                      )}
                      style={{ width: `${Math.min(s.avgFirstAttempt, 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Coaching signals */}
      {coachingInsights && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5" />
            Coaching Signals
          </p>
          <Card className="border-border/60">
            <CardContent className="p-3 space-y-2.5">
              <SignalRow
                icon={AlertTriangle}
                label="You miss most"
                value={coachingInsights.whatYouMissMost}
                color="text-red-500"
              />
              <SignalRow
                icon={TrendingUp}
                label="Improving fastest"
                value={coachingInsights.whatYouImproveFastest}
                color="text-green-500"
              />
              <SignalRow
                icon={Target}
                label="Retries stick on"
                value={coachingInsights.whereRetriesStick}
                color="text-amber-500"
              />
              <div className="pt-1 border-t border-border/40">
                <p className="text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Dave says: </span>
                  {coachingInsights.whatDaveWantsNext}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function SignalRow({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: string; color: string }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', color)} />
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}: </span>
        {value}
      </p>
    </div>
  );
}
