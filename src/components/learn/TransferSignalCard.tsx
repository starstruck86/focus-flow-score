/**
 * "Is It Sticking?" Card — Phase 3
 *
 * Shows whether training is transferring from rep to rep.
 */

import { Card, CardContent } from '@/components/ui/card';
import { TrendingUp, TrendingDown, Minus, Activity } from 'lucide-react';
import type { TransferSignal } from '@/lib/learning/learnAdaptationEngine';

interface Props {
  signal: TransferSignal;
}

const STATE_CONFIG = {
  sticking: {
    icon: TrendingUp,
    color: 'text-green-500',
    border: 'border-green-500/15',
    label: 'Sticking',
  },
  partial: {
    icon: Minus,
    color: 'text-amber-500',
    border: 'border-amber-500/15',
    label: 'Partial',
  },
  not_yet: {
    icon: TrendingDown,
    color: 'text-destructive',
    border: 'border-destructive/15',
    label: 'Not Yet',
  },
} as const;

export function TransferSignalCard({ signal }: Props) {
  const config = STATE_CONFIG[signal.state];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Activity className="h-3.5 w-3.5 text-muted-foreground" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Is It Sticking?
        </p>
      </div>

      <Card className={config.border}>
        <CardContent className="p-4 space-y-3">
          {/* State indicator */}
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 ${config.color}`} />
            <span className={`text-sm font-semibold ${config.color}`}>{config.label}</span>
          </div>

          {/* Coaching line */}
          <p className="text-xs text-foreground leading-relaxed">{signal.coachingLine}</p>

          {/* Metrics */}
          <div className="flex gap-4 pt-1">
            <div>
              <p className="text-lg font-semibold text-foreground">{signal.appliedRate}%</p>
              <p className="text-[10px] text-muted-foreground">Focus applied</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-foreground">
                {signal.avgScoreDelta > 0 ? '+' : ''}{signal.avgScoreDelta}
              </p>
              <p className="text-[10px] text-muted-foreground">Score trend</p>
            </div>
            {signal.sameMistakeRecurring && (
              <div className="flex items-center gap-1">
                <TrendingDown className="h-3 w-3 text-destructive" />
                <p className="text-[10px] text-destructive font-medium">Same mistake recurring</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
