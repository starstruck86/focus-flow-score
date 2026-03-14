import { format, isToday, isFuture, parseISO } from 'date-fns';
import { Check, X, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { WeekDaySummary } from '@/hooks/useWeekJournalEntries';

interface WeekStripProps {
  days: WeekDaySummary[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export function WeekStrip({ days, selectedDate, onSelectDate }: WeekStripProps) {
  return (
    <div className="flex items-center gap-1.5 w-full">
      {days.map((day) => {
        const dateObj = parseISO(day.date);
        const isSel = day.date === selectedDate;
        const future = isFuture(dateObj) && !isToday(dateObj);
        const todayDay = isToday(dateObj);

        return (
          <button
            key={day.date}
            onClick={() => !future && onSelectDate(day.date)}
            disabled={future}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-xl px-2 py-1.5 min-w-[44px] transition-all text-center',
              isSel
                ? 'bg-primary text-primary-foreground shadow-md scale-105'
                : future
                  ? 'opacity-30 cursor-not-allowed'
                  : 'hover:bg-muted cursor-pointer',
              todayDay && !isSel && 'ring-1 ring-primary/40'
            )}
          >
            <span className={cn(
              'text-[10px] font-medium uppercase',
              isSel ? 'text-primary-foreground/70' : 'text-muted-foreground'
            )}>
              {day.dayLabel}
            </span>
            <span className={cn(
              'text-sm font-bold',
              isSel ? 'text-primary-foreground' : 'text-foreground'
            )}>
              {day.dayNum}
            </span>
            <div className="h-4 flex items-center justify-center">
              {future ? (
                <Minus className="h-3 w-3 text-muted-foreground/40" />
              ) : day.checkedIn ? (
                day.goalMet ? (
                  <Check className={cn('h-3.5 w-3.5', isSel ? 'text-primary-foreground' : 'text-status-green')} />
                ) : (
                  <Check className={cn('h-3.5 w-3.5', isSel ? 'text-primary-foreground/70' : 'text-muted-foreground')} />
                )
              ) : (
                <X className={cn('h-3 w-3', isSel ? 'text-primary-foreground/50' : 'text-destructive/50')} />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
