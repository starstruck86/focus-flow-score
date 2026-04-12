import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { BlockPhase } from '@/lib/dojo/v3/blockManager';
import type { DayAnchor } from '@/lib/dojo/v3/dayAnchors';
import { ANCHORS_IN_ORDER, DAY_ANCHORS } from '@/lib/dojo/v3/dayAnchors';

interface BlockHeaderProps {
  blockNumber: number;
  currentWeek: number;
  phase: BlockPhase;
  stage: string;
  completedAnchors: DayAnchor[];
  todayAnchor: DayAnchor | null;
}

const PHASE_LABELS: Record<BlockPhase, string> = {
  benchmark: 'Benchmark',
  foundation: 'Foundation',
  build: 'Build',
  peak: 'Peak',
  retest: 'Retest',
};

const PHASE_COLORS: Record<BlockPhase, string> = {
  benchmark: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  foundation: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  build: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  peak: 'bg-red-500/10 text-red-600 border-red-500/20',
  retest: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
};

export function BlockHeader({
  blockNumber,
  currentWeek,
  phase,
  stage,
  completedAnchors,
  todayAnchor,
}: BlockHeaderProps) {
  return (
    <div className="space-y-3">
      {/* Block + Week + Phase */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">
            Block {blockNumber}
          </span>
          <span className="text-sm text-muted-foreground">·</span>
          <span className="text-sm text-muted-foreground">
            Week {currentWeek}
          </span>
          <Badge
            variant="outline"
            className={cn('text-[10px] font-medium', PHASE_COLORS[phase])}
          >
            {PHASE_LABELS[phase]}
          </Badge>
        </div>
        <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">
          {stage}
        </Badge>
      </div>

      {/* Week progress dots — 5 anchors, based on real completion data */}
      <div className="flex items-center gap-1.5">
        {ANCHORS_IN_ORDER.map((anchor) => {
          const def = DAY_ANCHORS[anchor];
          const isCompleted = completedAnchors.includes(anchor);
          const isToday = anchor === todayAnchor;

          return (
            <div key={anchor} className="flex flex-col items-center gap-1 flex-1">
              <div
                className={cn(
                  'h-2 w-full rounded-full transition-colors',
                  isCompleted
                    ? 'bg-primary'
                    : isToday
                      ? 'bg-primary/30 ring-1 ring-primary/50'
                      : 'bg-muted',
                )}
              />
              <span
                className={cn(
                  'text-[9px] leading-none',
                  isCompleted ? 'text-primary font-medium' : isToday ? 'text-primary font-medium' : 'text-muted-foreground',
                )}
              >
                {def.icon}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
