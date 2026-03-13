import { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Phone,
  MessageSquare,
  Users,
  Calendar,
  TrendingUp,
  Plus,
  Minus,
  Check,
  Clock,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, subDays, eachDayOfInterval } from 'date-fns';
import { isEligibleDay, useWorkScheduleConfig, useHolidays, usePtoDays, useWorkdayOverrides } from '@/hooks/useStreakData';
import { useSaveJournalEntry } from '@/hooks/useDailyJournal';
import { useRecordCheckIn } from '@/hooks/useStreakData';
import { toast } from 'sonner';

interface BackfillEntry {
  date: string;
  dials: number;
  conversations: number;
  prospectsAdded: number;
  meetingsSet: number;
  meetingsHeld: number;
  oppsCreated: number;
  saved: boolean;
}

function MiniCounter({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      <button
        onClick={() => onChange(Math.max(0, value - 1))}
        className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-secondary"
      >
        <Minus className="h-3 w-3" />
      </button>
      <button
        onClick={() => {
          const input = prompt('Enter value:', value.toString());
          if (input !== null) {
            const num = parseInt(input, 10);
            if (!isNaN(num) && num >= 0) onChange(num);
          }
        }}
        className="w-8 text-center font-mono text-sm font-bold"
      >
        {value}
      </button>
      <button
        onClick={() => onChange(value + 1)}
        className="w-5 h-5 flex items-center justify-center rounded text-muted-foreground hover:bg-secondary"
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}

export function BackfillCards() {
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const queryClient = useQueryClient();
  const saveJournal = useSaveJournalEntry();
  const recordCheckIn = useRecordCheckIn();

  // Find unlogged eligible days in the last 7 days
  const { data: missedDays } = useQuery({
    queryKey: ['backfill-missed-days'],
    queryFn: async () => {
      if (!config || !holidays || !ptoDays || !overrides) return [];

      const today = new Date();
      const days = eachDayOfInterval({
        start: subDays(today, 7),
        end: subDays(today, 1),
      });

      const eligibleDays = days
        .filter(d => isEligibleDay(d, config, holidays, ptoDays, overrides))
        .map(d => format(d, 'yyyy-MM-dd'));

      if (eligibleDays.length === 0) return [];

      // Check which have journal entries
      const { data: entries } = await supabase
        .from('daily_journal_entries')
        .select('date')
        .in('date', eligibleDays)
        .eq('checked_in', true);

      const loggedDates = new Set(entries?.map(e => e.date) || []);
      return eligibleDays.filter(d => !loggedDates.has(d));
    },
    enabled: !!config && !!holidays && !!ptoDays && !!overrides,
  });

  const [entries, setEntries] = useState<Record<string, BackfillEntry>>({});

  const getEntry = (date: string): BackfillEntry =>
    entries[date] || {
      date,
      dials: 0,
      conversations: 0,
      prospectsAdded: 0,
      meetingsSet: 0,
      meetingsHeld: 0,
      oppsCreated: 0,
      saved: false,
    };

  const updateEntry = (date: string, field: keyof BackfillEntry, value: any) => {
    setEntries(prev => ({
      ...prev,
      [date]: { ...getEntry(date), [field]: value },
    }));
  };

  const handleSave = async (date: string) => {
    const entry = getEntry(date);
    try {
      await saveJournal.mutateAsync({
        date,
        activity: {
          dials: entry.dials,
          conversations: entry.conversations,
          prospectsAdded: entry.prospectsAdded,
          managerPlusMessages: 0,
          manualEmails: 0,
          automatedEmails: 0,
          meetingsSet: entry.meetingsSet,
          customerMeetingsHeld: entry.meetingsHeld,
          opportunitiesCreated: entry.oppsCreated,
          personalDevelopment: false,
          prospectingBlockMinutes: 0,
          accountDeepWorkMinutes: 0,
          expansionTouchpoints: 0,
          focusMode: 'balanced',
        },
        preparedness: {
          accountsResearched: 0,
          contactsPrepped: 0,
          preppedForAllCallsTomorrow: null,
          callsNeedPrepCount: 0,
          callsPrepNote: '',
          meetingPrepDone: null,
          meetingsUnpreparedFor: null,
          meetingsUnpreparedNote: '',
        },
        recovery: {
          sleepHours: 7,
          energy: 3,
          focusQuality: 3,
          stress: 3,
          clarity: 3,
          distractions: 'low',
          contextSwitching: 'low',
          adminHeavyDay: false,
          travelDay: false,
          whatDrainedYou: '',
          whatWorkedToday: '',
        },
        markAsCheckedIn: true,
      });

      await recordCheckIn.mutateAsync({
        date,
        method: 'backfill',
        dailyScore: 0,
        productivityScore: 0,
        isEligible: true,
        goalMet: false,
      });

      setEntries(prev => ({
        ...prev,
        [date]: { ...getEntry(date), saved: true },
      }));

      queryClient.invalidateQueries({ queryKey: ['backfill-missed-days'] });
      toast.success(`${date} backfilled`);
    } catch {
      toast.error('Failed to save');
    }
  };

  if (!missedDays || missedDays.length === 0) return null;

  const icons = [Phone, MessageSquare, Users, Calendar, Calendar, TrendingUp];
  const labels = ['Dials', 'Convos', 'Prospects', 'Set', 'Held', 'Opps'];
  const fields: (keyof BackfillEntry)[] = [
    'dials', 'conversations', 'prospectsAdded', 'meetingsSet', 'meetingsHeld', 'oppsCreated',
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <Clock className="h-4 w-4 text-status-yellow" />
        <span className="text-sm font-medium">
          {missedDays.length} day{missedDays.length > 1 ? 's' : ''} unlogged
        </span>
        <Badge variant="secondary" className="text-[10px]">estimated</Badge>
      </div>

      <div className="space-y-2">
        {missedDays.map(date => {
          const entry = getEntry(date);
          if (entry.saved) return null;

          return (
            <div
              key={date}
              className="p-3 rounded-lg border bg-card"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-muted-foreground">
                  {format(new Date(date + 'T12:00:00'), 'EEE, MMM d')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 text-xs gap-1"
                  onClick={() => handleSave(date)}
                >
                  <Check className="h-3 w-3" /> Save
                </Button>
              </div>
              <div className="grid grid-cols-6 gap-1">
                {fields.map((field, i) => {
                  const Icon = icons[i];
                  return (
                    <div key={field} className="text-center">
                      <Icon className="h-3 w-3 mx-auto mb-0.5 text-muted-foreground" />
                      <MiniCounter
                        value={entry[field] as number}
                        onChange={v => updateEntry(date, field, v)}
                      />
                      <span className="text-[9px] text-muted-foreground">{labels[i]}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}
