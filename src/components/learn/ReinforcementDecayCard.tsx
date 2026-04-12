/**
 * "What's Fading" Card — Phase 3
 *
 * Identifies KIs the user learned but has not retained.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Clock, AlertCircle } from 'lucide-react';
import type { DecayItem } from '@/lib/learning/learnAdaptationEngine';

interface Props {
  items: DecayItem[];
}

function formatDecayReason(item: DecayItem): string {
  if (item.missesSinceLearned >= 3) {
    return `Shown ${item.missesSinceLearned} times recently — still not landing.`;
  }
  if (!item.lastAppliedAt) {
    return 'You know this concept, but it isn\'t showing up in your reps.';
  }
  return 'You applied this before, but it\'s stopped appearing consistently.';
}

export function ReinforcementDecayCard({ items }: Props) {
  if (!items || items.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Clock className="h-3.5 w-3.5 text-amber-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          What's Fading
        </p>
      </div>

      <Card className="border-amber-500/15">
        <CardContent className="p-4 space-y-3">
          {items.map((item) => (
            <div key={item.kiId} className="space-y-1">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-3 w-3 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-medium text-foreground">{item.kiTitle}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {formatDecayReason(item)}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
