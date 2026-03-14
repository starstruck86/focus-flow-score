import { useState } from 'react';
import { Flame, Zap } from 'lucide-react';
import { useStreakSummary } from '@/hooks/useStreakData';
import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { getLevelTitle } from '@/types/streak';
import { PerformanceProfileSheet } from '@/components/PerformanceProfileSheet';

interface StreakChipProps {
  variant?: 'compact' | 'full';
  className?: string;
}

export function StreakChip({ variant = 'compact', className }: StreakChipProps) {
  const { data: summary, isLoading } = useStreakSummary();
  const [profileOpen, setProfileOpen] = useState(false);
  
  if (isLoading || !summary) {
    return (
      <div className={cn("h-6 w-16 bg-muted/30 rounded-full animate-pulse", className)} />
    );
  }
  
  if (variant === 'compact') {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full",
              "bg-gradient-to-r from-recovery/20 to-productivity/20",
              "border border-recovery/30",
              "text-xs font-medium",
              className
            )}>
              <Flame className="h-3 w-3 text-strain" />
              <span className="text-recovery">{summary.currentCheckinStreak}</span>
              <span className="text-muted-foreground">/</span>
              <span className="text-productivity">{summary.currentPerformanceStreak}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <div className="text-xs space-y-1">
              <div className="flex items-center gap-2">
                <Zap className="h-3 w-3 text-recovery" />
                <span>Check-in: {summary.currentCheckinStreak} days</span>
              </div>
              <div className="flex items-center gap-2">
                <Flame className="h-3 w-3 text-productivity" />
                <span>Performance: {summary.currentPerformanceStreak} days</span>
              </div>
              <div className="text-muted-foreground pt-1 border-t border-border/50">
                Level {summary.checkinLevel}: {getLevelTitle(summary.checkinLevel)}
              </div>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  
  return (
    <div className={cn(
      "inline-flex items-center gap-3 px-3 py-1.5 rounded-lg",
      "bg-gradient-to-r from-recovery/10 to-productivity/10",
      "border border-border/50",
      className
    )}>
      <div className="flex items-center gap-1">
        <Zap className="h-3.5 w-3.5 text-recovery" />
        <span className="text-sm font-medium text-recovery">{summary.currentCheckinStreak}</span>
        <span className="text-xs text-muted-foreground">check-in</span>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1">
        <Flame className="h-3.5 w-3.5 text-productivity" />
        <span className="text-sm font-medium text-productivity">{summary.currentPerformanceStreak}</span>
        <span className="text-xs text-muted-foreground">goals</span>
      </div>
    </div>
  );
}
