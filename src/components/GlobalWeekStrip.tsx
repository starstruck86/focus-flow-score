import { format } from 'date-fns';
import { useWeekJournalEntries } from '@/hooks/useWeekJournalEntries';
import { WeekStrip } from '@/components/journal/WeekStrip';
import { useState } from 'react';
import { DailyScorecardModal } from '@/components/journal/DailyScorecardModal';

export function GlobalWeekStrip() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [showScorecard, setShowScorecard] = useState(false);
  const { data: days } = useWeekJournalEntries(new Date());

  if (!days || days.length === 0) return null;

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setShowScorecard(true);
  };

  return (
    <>
      <div className="w-full">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            Week
          </span>
        </div>
        <WeekStrip
          days={days}
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
