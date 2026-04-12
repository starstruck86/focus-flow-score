import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Info } from 'lucide-react';
import { DAY_ANCHORS } from '@/lib/dojo/v3/dayAnchors';
import type { DailyAssignment } from '@/lib/dojo/v3/programmingEngine';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';

interface DailyAssignmentCardProps {
  assignment: DailyAssignment;
}

export function DailyAssignmentCard({ assignment }: DailyAssignmentCardProps) {
  const anchorDef = DAY_ANCHORS[assignment.dayAnchor];
  const focusLabel = FOCUS_PATTERN_LABELS[assignment.focusPattern]
    ?? assignment.focusPattern?.replace(/_/g, ' ')
    ?? '';

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-4 space-y-3">
        {/* Anchor + Difficulty */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">{anchorDef.icon}</span>
            <span className="text-sm font-semibold text-foreground">{anchorDef.label}</span>
          </div>
          <Badge variant="outline" className="text-[10px] capitalize">
            {assignment.difficulty}
          </Badge>
        </div>

        {/* Focus pattern */}
        {focusLabel && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Focus:</span>
            <span className="text-xs font-medium text-foreground">{focusLabel}</span>
          </div>
        )}

        {/* Reason */}
        <div className="flex items-start gap-2 pt-1 border-t border-primary/10">
          <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            {assignment.reason}
          </p>
        </div>

        {/* Benchmark tag */}
        {assignment.benchmarkTag && (
          <Badge className="text-[10px] bg-blue-500/10 text-blue-600 border-blue-500/20" variant="outline">
            {assignment.blockPhase === 'benchmark' ? '📊 Benchmark' : '🔄 Retest'}
          </Badge>
        )}

        {/* Scenario count */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{assignment.scenarios.length} rep{assignment.scenarios.length !== 1 ? 's' : ''}</span>
          {assignment.kis.length > 0 && (
            <>
              <span>·</span>
              <span>{assignment.kis.length} KI{assignment.kis.length !== 1 ? 's' : ''}</span>
            </>
          )}
          <span>·</span>
          <span>~{5 + assignment.scenarios.length * 3} min</span>
        </div>
      </CardContent>
    </Card>
  );
}
