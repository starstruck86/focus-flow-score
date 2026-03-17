import { useState } from 'react';
import { format, parseISO, startOfWeek, addWeeks, subWeeks } from 'date-fns';
import { ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { WeekStrip } from './WeekStrip';
import { AccountabilityToggles } from './AccountabilityToggles';
import { useWeekJournalEntries } from '@/hooks/useWeekJournalEntries';
import { useJournalEntry } from '@/hooks/useDailyJournal';
import { DailyScorecardModal } from './DailyScorecardModal';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function JournalDashboardCard() {
  const today = format(new Date(), 'yyyy-MM-dd');
  const [selectedDate, setSelectedDate] = useState(today);
  const [weekAnchor, setWeekAnchor] = useState(new Date());
  const [showScorecard, setShowScorecard] = useState(false);

  const { data: weekDays, isLoading } = useWeekJournalEntries(weekAnchor);
  const { data: selectedEntry } = useJournalEntry(selectedDate);

  const currentWeekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const anchorWeekStart = startOfWeek(weekAnchor, { weekStartsOn: 1 });
  const isCurrentWeek = format(currentWeekStart, 'yyyy-MM-dd') === format(anchorWeekStart, 'yyyy-MM-dd');

  const navWeek = (dir: 'prev' | 'next') => {
    const fn = dir === 'prev' ? subWeeks : addWeeks;
    const newAnchor = fn(weekAnchor, 1);
    setWeekAnchor(newAnchor);
    const ws = startOfWeek(newAnchor, { weekStartsOn: 1 });
    setSelectedDate(format(ws, 'yyyy-MM-dd'));
  };

  const selectedDay = weekDays?.find(d => d.date === selectedDate);
  const score = selectedDay?.dailyScore;

  return (
    <>
      <Card className="border-border/50 bg-card/80 backdrop-blur-sm">
        <CardContent className="p-4 space-y-3">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="font-display text-sm font-bold">Journal</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => navWeek('prev')}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <span className="text-xs text-muted-foreground font-medium min-w-[60px] text-center">
                {isCurrentWeek ? 'This Week' : format(anchorWeekStart, 'MMM d')}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6"
                onClick={() => navWeek('next')}
                disabled={isCurrentWeek}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {/* Week strip */}
          {isLoading ? (
            <div className="flex gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 flex-1 rounded-xl" />
              ))}
            </div>
          ) : weekDays ? (
            <WeekStrip
              days={weekDays}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
          ) : null}

          {/* Selected day detail */}
          <div className="flex items-center justify-between pt-1 border-t border-border/30">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {format(parseISO(selectedDate), 'EEEE, MMM d')}
              </span>
              {score !== null && score !== undefined && (
                <span className={cn(
                  'text-xs font-bold px-2 py-0.5 rounded-full',
                  score >= 8 ? 'bg-status-green/15 text-status-green'
                    : score >= 5 ? 'bg-status-amber/15 text-status-amber'
                      : 'bg-destructive/15 text-destructive'
                )}>
                  {score} pts
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-xs h-7"
              onClick={() => setShowScorecard(true)}
            >
              {selectedDay?.checkedIn ? 'Edit' : 'Log Day'}
            </Button>
          </div>

          {/* Accountability toggles for selected day */}
          <AccountabilityToggles
            date={selectedDate}
            habits={selectedDay?.accountabilityHabits || {}}
            readOnly={!selectedDay?.hasEntry && selectedDate !== today}
          />
        </CardContent>
      </Card>

      <DailyScorecardModal
        open={showScorecard}
        onOpenChange={setShowScorecard}
        date={selectedDate}
      />
    </>
  );
}
