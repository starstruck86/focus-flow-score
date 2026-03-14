import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useStreakSummary } from '@/hooks/useStreakData';
import { usePerformanceProfile } from '@/hooks/usePerformanceProfile';
import { useSalesAge } from '@/hooks/useSalesAge';
import { getLevelTitle, getProgressToNextLevel } from '@/types/streak';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { 
  Flame, Target, Zap, Phone, Users, CalendarCheck, 
  Briefcase, Trophy, TrendingUp, Clock, Star, Award
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

interface PerformanceProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PerformanceProfileSheet({ open, onOpenChange }: PerformanceProfileSheetProps) {
  const { data: summary } = useStreakSummary();
  const { data: records, isLoading } = usePerformanceProfile();
  const { data: salesAgeData } = useSalesAge();

  const level = summary?.checkinLevel || 0;
  const levelTitle = getLevelTitle(level);
  const progress = getProgressToNextLevel(summary?.currentCheckinStreak || 0);
  const salesAge = salesAgeData?.salesAge ?? 45;

  const statItems = records ? [
    { label: 'Most Dials', value: records.mostDialsInDay, icon: Phone, color: 'text-strain' },
    { label: 'Most Conversations', value: records.mostConversationsInDay, icon: Users, color: 'text-recovery' },
    { label: 'Most Meetings Set', value: records.mostMeetingsSetInDay, icon: CalendarCheck, color: 'text-productivity' },
    { label: 'Most Opps Created', value: records.mostOppsCreatedInDay, icon: Briefcase, color: 'text-strain' },
    { label: 'Best Daily Score', value: records.bestDailyScore, icon: Star, color: 'text-recovery' },
    { label: 'Best Week Avg', value: records.bestWeekAvgScore, icon: TrendingUp, color: 'text-productivity' },
    { label: 'Longest Check-in Streak', value: records.longestCheckinStreak, icon: Zap, color: 'text-recovery' },
    { label: 'Longest Goal Streak', value: records.longestPerformanceStreak, icon: Target, color: 'text-productivity' },
    { label: 'Biggest Deal Closed', value: records.biggestDealClosed > 0 ? `$${(records.biggestDealClosed / 1000).toFixed(0)}k` : '—', icon: Trophy, color: 'text-strain' },
  ] : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl border-t border-border/50 bg-gradient-to-b from-card to-background overflow-y-auto">
        <SheetHeader className="sr-only">
          <SheetTitle>Performance Profile</SheetTitle>
        </SheetHeader>

        {/* Hero Section */}
        <div className="text-center pt-2 pb-6 border-b border-border/30">
          {/* Level Badge */}
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-primary/10 border border-primary/30 mb-4">
            <Award className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold text-primary">Level {level}</span>
            <span className="text-xs text-muted-foreground">•</span>
            <span className="text-xs font-medium text-foreground">{levelTitle}</span>
          </div>

          {/* Sales Age - Hero Number */}
          <div className="mb-2">
            <span className="text-7xl font-display font-bold bg-gradient-to-r from-recovery to-productivity bg-clip-text text-transparent">
              {Math.round(salesAge)}
            </span>
          </div>
          <div className="text-sm text-muted-foreground uppercase tracking-wider mb-4">Sales Age</div>

          {/* Dual Streaks */}
          <div className="flex items-center justify-center gap-6 mb-4">
            <div className="flex items-center gap-1.5">
              <Zap className="h-4 w-4 text-recovery" />
              <span className="text-lg font-display font-bold text-recovery">{summary?.currentCheckinStreak || 0}</span>
              <span className="text-xs text-muted-foreground">day streak</span>
            </div>
            <div className="w-px h-5 bg-border" />
            <div className="flex items-center gap-1.5">
              <Target className="h-4 w-4 text-productivity" />
              <span className="text-lg font-display font-bold text-productivity">{summary?.currentPerformanceStreak || 0}</span>
              <span className="text-xs text-muted-foreground">goal streak</span>
            </div>
          </div>

          {/* Level Progress */}
          <div className="max-w-xs mx-auto">
            <Progress value={progress.progress} className="h-2 bg-muted/50" />
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>Level {level}</span>
              <span>{progress.remaining} to Level {level + 1}</span>
            </div>
          </div>
        </div>

        {/* Notable Stats */}
        <div className="py-6">
          <div className="flex items-center gap-2 mb-4">
            <Trophy className="h-4 w-4 text-strain" />
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Personal Records</h3>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-3 gap-3">
              {Array.from({ length: 9 }).map((_, i) => (
                <div key={i} className="h-20 bg-muted/20 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {statItems.map((stat) => (
                <div
                  key={stat.label}
                  className="rounded-xl border border-border/50 bg-card/50 p-3 text-center hover:border-primary/30 transition-colors"
                >
                  <stat.icon className={cn("h-4 w-4 mx-auto mb-1.5", stat.color)} />
                  <div className="text-lg font-display font-bold text-foreground">
                    {typeof stat.value === 'number' ? stat.value : stat.value}
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{stat.label}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Lifetime Stats */}
        <div className="py-4 border-t border-border/30">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground">Lifetime</h3>
          </div>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-display font-bold text-foreground">{records?.totalDaysTracked || 0}</div>
              <div className="text-[10px] text-muted-foreground">Days Tracked</div>
            </div>
            <div>
              <div className="text-2xl font-display font-bold text-foreground">{summary?.totalCheckins || 0}</div>
              <div className="text-[10px] text-muted-foreground">Check-ins</div>
            </div>
            <div>
              <div className="text-2xl font-display font-bold text-foreground">{summary?.totalGoalsMet || 0}</div>
              <div className="text-[10px] text-muted-foreground">Goals Met</div>
            </div>
          </div>
          {records?.memberSince && (
            <div className="text-center mt-4 text-xs text-muted-foreground">
              Member since {format(new Date(records.memberSince), 'MMMM yyyy')}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
