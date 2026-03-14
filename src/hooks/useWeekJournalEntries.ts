import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, startOfWeek, endOfWeek, eachDayOfInterval } from 'date-fns';

export interface WeekDaySummary {
  date: string;
  dayLabel: string;
  dayNum: number;
  checkedIn: boolean;
  goalMet: boolean;
  dailyScore: number | null;
  hasEntry: boolean;
  accountabilityHabits: Record<string, boolean>;
}

export function useWeekJournalEntries(selectedDate?: Date) {
  const { user } = useAuth();
  const anchor = selectedDate || new Date();
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(anchor, { weekStartsOn: 1 });
  const startStr = format(weekStart, 'yyyy-MM-dd');
  const endStr = format(weekEnd, 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['journal-week', startStr],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('date, checked_in, goal_met, daily_score, accountability_habits')
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date');

      if (error) throw error;

      const entryMap = new Map(
        (data || []).map((d: any) => [d.date, d])
      );

      const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
      return days.map((day): WeekDaySummary => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const entry = entryMap.get(dateStr) as any;
        return {
          date: dateStr,
          dayLabel: format(day, 'EEE'),
          dayNum: day.getDate(),
          checkedIn: entry?.checked_in || false,
          goalMet: entry?.goal_met || false,
          dailyScore: entry?.daily_score ?? null,
          hasEntry: !!entry,
          accountabilityHabits: (entry?.accountability_habits as Record<string, boolean>) || {},
        };
      });
    },
    enabled: !!user,
  });
}
