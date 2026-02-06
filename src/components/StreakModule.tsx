import { motion } from 'framer-motion';
import { Flame, Target, TrendingUp, Zap, Calendar, Check, Star, Clock } from 'lucide-react';
import { useStreakSummary, useWeekStatus, useWorkScheduleConfig } from '@/hooks/useStreakData';
import { getProgressToNextLevel, getLevelTitle, BADGE_DEFINITIONS } from '@/types/streak';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface StreakModuleProps {
  onManualCheckIn?: () => void;
  todayCheckedIn?: boolean;
}

export function StreakModule({ onManualCheckIn, todayCheckedIn }: StreakModuleProps) {
  const { data: summary, isLoading: summaryLoading } = useStreakSummary();
  const { weekDays, isLoading: weekLoading } = useWeekStatus();
  const { data: config } = useWorkScheduleConfig();
  
  if (summaryLoading || weekLoading || !summary) {
    return (
      <div className="metric-card animate-pulse">
        <div className="h-32 bg-muted/30 rounded-lg" />
      </div>
    );
  }
  
  const checkinProgress = getProgressToNextLevel(summary.currentCheckinStreak);
  const performanceProgress = getProgressToNextLevel(summary.currentPerformanceStreak);
  const checkinLevel = summary.checkinLevel;
  const performanceLevel = summary.performanceLevel;
  
  return (
    <motion.div
      className="rounded-xl border border-primary/30 bg-gradient-to-br from-card via-card to-primary/5 p-6"
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Flame className="h-5 w-5 text-strain" />
          <h2 className="font-display text-lg font-semibold">Streaks & Habits</h2>
        </div>
        {!todayCheckedIn && onManualCheckIn && (
          <Button 
            size="sm" 
            variant="outline" 
            onClick={onManualCheckIn}
            className="text-xs gap-1"
          >
            <Check className="h-3 w-3" />
            Check In
          </Button>
        )}
      </div>
      
      {/* Dual Streak Display */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        {/* Check-in Streak */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Zap className="h-4 w-4 text-recovery" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Check-in</span>
          </div>
          <div className="text-4xl font-display font-bold text-recovery">
            {summary.currentCheckinStreak}
          </div>
          <div className="text-xs text-muted-foreground">day streak</div>
          <div className="mt-2">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-1">
              <span>Level {checkinLevel}</span>
              <span className="text-recovery">• {getLevelTitle(checkinLevel)}</span>
            </div>
            <Progress 
              value={checkinProgress.progress} 
              className="h-1.5 bg-muted/50"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {checkinProgress.remaining} to Level {checkinLevel + 1}
            </div>
          </div>
        </div>
        
        {/* Performance Streak */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <Target className="h-4 w-4 text-productivity" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider">Performance</span>
          </div>
          <div className="text-4xl font-display font-bold text-productivity">
            {summary.currentPerformanceStreak}
          </div>
          <div className="text-xs text-muted-foreground">goal streak</div>
          <div className="mt-2">
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground mb-1">
              <span>Level {performanceLevel}</span>
              <span className="text-productivity">• {getLevelTitle(performanceLevel)}</span>
            </div>
            <Progress 
              value={performanceProgress.progress} 
              className="h-1.5 bg-muted/50"
            />
            <div className="text-[10px] text-muted-foreground mt-1">
              {performanceProgress.remaining} to Level {performanceLevel + 1}
            </div>
          </div>
        </div>
      </div>
      
      {/* Weekly Mini Calendar */}
      <div className="border-t border-border/50 pt-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="h-4 w-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground uppercase tracking-wider">This Week</span>
        </div>
        
        <TooltipProvider>
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((day) => (
              <Tooltip key={day.dateStr}>
                <TooltipTrigger asChild>
                  <div className="flex flex-col items-center">
                    <span className="text-[10px] text-muted-foreground mb-1">
                      {day.dayName}
                    </span>
                    <div
                      className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-all",
                        // Not eligible (weekend/PTO/holiday)
                        !day.isEligible && "bg-muted/20 text-muted-foreground/50",
                        // Eligible but future
                        day.isEligible && day.isFuture && "border-2 border-dashed border-muted-foreground/30 text-muted-foreground",
                        // Today not checked in
                        day.isEligible && day.isToday && !day.checkedIn && "border-2 border-primary bg-primary/10 text-primary ring-2 ring-primary/30",
                        // Checked in but goal not met
                        day.isEligible && day.checkedIn && !day.goalMet && "bg-recovery/20 text-recovery",
                        // Goal met
                        day.isEligible && day.goalMet && "bg-productivity text-productivity-foreground",
                        // Eligible past day not checked in (missed)
                        day.isEligible && day.isPast && !day.checkedIn && "bg-destructive/20 text-destructive border border-destructive/50"
                      )}
                    >
                      {day.goalMet ? (
                        <Star className="h-3.5 w-3.5 fill-current" />
                      ) : day.checkedIn ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        day.dayNumber
                      )}
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  <div className="font-medium">{format(day.date, 'EEEE, MMM d')}</div>
                  {!day.isEligible && <div className="text-muted-foreground">Non-working day</div>}
                  {day.isEligible && day.goalMet && <div className="text-productivity">Goal met! ⭐</div>}
                  {day.isEligible && day.checkedIn && !day.goalMet && <div className="text-recovery">Checked in ✓</div>}
                  {day.isEligible && day.isPast && !day.checkedIn && <div className="text-destructive">Missed</div>}
                  {day.isEligible && day.isToday && !day.checkedIn && <div className="text-primary">Check in today!</div>}
                  {day.isEligible && day.isFuture && <div className="text-muted-foreground">Upcoming</div>}
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
      </div>
      
      {/* Stats Row */}
      <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-border/50">
        <div className="text-center">
          <div className="text-lg font-display font-bold text-foreground">
            {summary.totalCheckins}
          </div>
          <div className="text-[10px] text-muted-foreground">Total Check-ins</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-display font-bold text-foreground">
            {summary.totalGoalsMet}
          </div>
          <div className="text-[10px] text-muted-foreground">Goals Met</div>
        </div>
        <div className="text-center">
          <div className="text-lg font-display font-bold text-foreground">
            {summary.longestCheckinStreak}
          </div>
          <div className="text-[10px] text-muted-foreground">Best Streak</div>
        </div>
      </div>
    </motion.div>
  );
}
