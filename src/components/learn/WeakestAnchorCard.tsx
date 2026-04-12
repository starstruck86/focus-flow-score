/**
 * Weakest Anchor Card — Phase 4
 *
 * Shows the weakest anchor with coaching context.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Target } from 'lucide-react';

interface Props {
  anchorLabel: string;
  reason: string;
}

export function WeakestAnchorCard({ anchorLabel, reason }: Props) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Target className="h-3.5 w-3.5 text-destructive" />
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Weakest Anchor
        </p>
      </div>

      <Card className="border-destructive/15">
        <CardContent className="p-4 space-y-2">
          <p className="text-sm font-semibold text-foreground">{anchorLabel}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{reason}</p>
        </CardContent>
      </Card>
    </div>
  );
}
