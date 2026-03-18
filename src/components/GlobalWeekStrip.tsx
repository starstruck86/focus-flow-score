import { format } from 'date-fns';
import { useWeekJournalEntries } from '@/hooks/useWeekJournalEntries';
import { WeekStrip } from '@/components/journal/WeekStrip';
import { useState } from 'react';
import { useJournalModal } from '@/components/journal/JournalPromptManager';

export function GlobalWeekStrip() {
  const [selectedDate, setSelectedDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const { data: days } = useWeekJournalEntries(new Date());
  const { openScorecard } = useJournalModal();

  if (!days || days.length === 0) return null;

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    openScorecard?.(date);
  };

  return (
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
  );
}
