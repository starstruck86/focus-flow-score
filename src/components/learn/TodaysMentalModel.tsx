/**
 * Today's Mental Model Card
 *
 * Top of Learn page. Shows what matters today, common failure pattern,
 * and correct behavior — all derived from real assignment + skill data.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Brain, AlertTriangle, Zap, Users } from 'lucide-react';
import type { MentalModel } from '@/lib/learning/learnEngine';

interface Props {
  model: MentalModel;
}

export function TodaysMentalModel({ model }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Brain className="h-3.5 w-3.5 text-primary" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Today's Mental Model
        </p>
      </div>

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="p-4 space-y-3">
          {/* What matters */}
          <p className="text-sm font-semibold text-foreground leading-relaxed">
            {model.whatMatters}
          </p>

          {/* Persistent mistake warning */}
          {model.persistentMistake && (
            <div className="flex gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-500 dark:text-red-400 font-medium">
                {model.persistentMistake}
              </p>
            </div>
          )}

          {/* Failure pattern */}
          <div className="bg-background/60 rounded-md p-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">
              Common failure
            </p>
            <p className="text-xs text-foreground leading-relaxed">
              {model.failurePattern}
            </p>
          </div>

          {/* Correct behavior */}
          <div className="flex gap-2">
            <Zap className="h-3.5 w-3.5 text-green-500 shrink-0 mt-0.5" />
            <p className="text-xs text-foreground leading-relaxed">
              {model.correctBehavior}
            </p>
          </div>

          {/* Multi-thread advisory */}
          {model.multiThreadAdvisory && (
            <div className="flex gap-2 pt-1 border-t border-primary/10">
              <Users className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {model.multiThreadAdvisory}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
