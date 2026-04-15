import { useWeekJournalEntries } from '@/hooks/useWeekJournalEntries';
import { WeekStrip } from '@/components/journal/WeekStrip';
import { useState } from 'react';
import { todayET, bostonNow } from '@/lib/timeFormat';
import { DailyScorecardModal } from '@/components/journal/DailyScorecardModal';
import { useIsMobile } from '@/hooks/use-mobile';

export function GlobalWeekStrip() {
  const [selectedDate, setSelectedDate] = useState(todayET());
  const [showScorecard, setShowScorecard] = useState(false);
  const { data: days } = useWeekJournalEntries(bostonNow());
  const isMobile = useIsMobile();

  if (!days || days.length === 0) return null;

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setShowScorecard(true);
  };

  // On mobile, show only today + 1 day before and after (3 days max)
  const visibleDays = isMobile
    ? (() => {
        const todayIdx = days.findIndex(d => d.date === todayET());
        if (todayIdx === -1) return days.slice(0, 3);
        const start = Math.max(0, todayIdx - 1);
        return days.slice(start, start + 3);
      })()
    : days;

  return (
    <>
      <div className="w-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Daily Journal
          </span>
        </div>
        <WeekStrip
          days={visibleDays}
          selectedDate={selectedDate}
          onSelectDate={handleSelectDate}
        />
      </div>
      <DailyScorecardModal
        open={showScorecard}
        onOpenChange={setShowScorecard}
        date={selectedDate}
      />
    </>
  );
}
