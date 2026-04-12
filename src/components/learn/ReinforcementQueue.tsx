/**
 * Reinforcement Queue
 *
 * Shows up to 3 KIs that need reinforcement based on recent missed reps.
 */

import { Card, CardContent } from '@/components/ui/card';
import { RefreshCw, AlertTriangle } from 'lucide-react';
import type { ReinforcementItem } from '@/lib/learning/learnEngine';

interface Props {
  items: ReinforcementItem[];
}

export function ReinforcementQueue({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <RefreshCw className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Needs Reinforcement
        </p>
      </div>

      <div className="space-y-1.5">
        {items.map(item => (
          <Card key={item.kiId} className="border-amber-500/15">
            <CardContent className="p-3 flex items-start gap-2.5">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{item.kiTitle}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  {item.mistakeItFixes && (
                    <span className="text-[10px] text-muted-foreground">
                      Fixes: {item.mistakeItFixes}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    · missed {item.missCount}× recently
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
