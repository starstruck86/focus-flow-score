/**
 * "Who You Missed" Card — Phase 3
 *
 * Surfaces missed stakeholders and deal momentum from multi-thread reps.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Users, AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { MultiThreadMiss } from '@/lib/learning/learnAdaptationEngine';

interface Props {
  miss: MultiThreadMiss;
}

const MOMENTUM_LABEL: Record<string, string> = {
  forward: 'Forward',
  neutral: 'Neutral',
  at_risk: 'At Risk',
};

const MOMENTUM_COLOR: Record<string, string> = {
  forward: 'text-green-500',
  neutral: 'text-amber-500',
  at_risk: 'text-destructive',
};

export function StakeholderMissCard({ miss }: Props) {
  // Don't show if everything was fine
  if (miss.missedStakeholders.length === 0 && miss.momentum === 'forward') return null;

  const headline = miss.momentum === 'at_risk'
    ? 'You answered one party, but the room did not move.'
    : 'You handled the moment, but didn\'t align the room.';

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Users className="h-3.5 w-3.5 text-violet-500" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Who You Missed
        </p>
      </div>

      <Card className="border-violet-500/15">
        <CardContent className="p-4 space-y-3">
          <p className="text-xs text-foreground leading-relaxed font-medium">{headline}</p>

          {/* Stakeholders grid */}
          <div className="space-y-1.5">
            {miss.stakeholdersDetected.map(s => {
              const addressed = miss.stakeholdersAddressed.includes(s);
              const missed = miss.missedStakeholders.includes(s);
              return (
                <div key={s} className="flex items-center gap-2">
                  {addressed ? (
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  ) : (
                    <AlertTriangle className="h-3 w-3 text-destructive shrink-0" />
                  )}
                  <span className="text-xs text-foreground capitalize">{s.replace(/_/g, ' ')}</span>
                  {missed && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-destructive border-destructive/30">
                      missed
                    </Badge>
                  )}
                </div>
              );
            })}
          </div>

          {/* Momentum */}
          <div className="flex items-center gap-2">
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Deal momentum:</span>
            <span className={`text-xs font-medium ${MOMENTUM_COLOR[miss.momentum]}`}>
              {MOMENTUM_LABEL[miss.momentum]}
            </span>
          </div>

          {/* Coaching note */}
          {miss.coachingNote && (
            <div className="bg-background/60 rounded-md p-2.5">
              <p className="text-xs text-foreground leading-relaxed">{miss.coachingNote}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
