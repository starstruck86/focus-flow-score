/**
 * Deal Movement Card — V6 Multi-Thread Feedback
 *
 * Shows stakeholder alignment and deal momentum after a multi-thread rep.
 * Only renders when multiThread assessment is present.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Users, ArrowUpRight, Minus, AlertTriangle } from 'lucide-react';
import type { MultiThreadAssessment, DealMomentum } from '@/lib/dojo/v6/multiThreadTypes';
import {
  DEAL_MOMENTUM_LABELS,
  DEAL_MOMENTUM_COLORS,
  DEAL_MOMENTUM_BG,
} from '@/lib/dojo/v6/multiThreadTypes';

interface DealMovementCardProps {
  assessment: MultiThreadAssessment;
}

const MOMENTUM_ICONS: Record<DealMomentum, React.ReactNode> = {
  forward: <ArrowUpRight className="h-3.5 w-3.5" />,
  neutral: <Minus className="h-3.5 w-3.5" />,
  at_risk: <AlertTriangle className="h-3.5 w-3.5" />,
};

export function DealMovementCard({ assessment }: DealMovementCardProps) {
  const {
    dealMomentum,
    coachingNote,
    stakeholdersDetected,
    stakeholdersAddressed,
    breakdown,
  } = assessment;

  const missed = breakdown?.missedStakeholders?.filter(s => s.length > 0) ?? [];

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Deal Movement
            </span>
          </div>
          <Badge
            variant="outline"
            className={`text-[10px] ${DEAL_MOMENTUM_COLORS[dealMomentum]} ${DEAL_MOMENTUM_BG[dealMomentum]}`}
          >
            <span className="flex items-center gap-1">
              {MOMENTUM_ICONS[dealMomentum]}
              {DEAL_MOMENTUM_LABELS[dealMomentum]}
            </span>
          </Badge>
        </div>

        {/* Coaching note */}
        {coachingNote && (
          <p className="text-sm text-foreground leading-relaxed">
            {coachingNote}
          </p>
        )}

        {/* Missed stakeholders */}
        {missed.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-destructive">Missed:</span>{' '}
            {missed.map(s => s.replace(/_/g, ' ')).join(', ')}
          </p>
        )}

        {/* Stakeholder coverage summary */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{stakeholdersAddressed.length}/{stakeholdersDetected.length} stakeholders addressed</span>
        </div>
      </CardContent>
    </Card>
  );
}
