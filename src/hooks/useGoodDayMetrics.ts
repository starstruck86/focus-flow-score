// Good Day Metrics hooks - Expected vs Actual tracking
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, startOfWeek, endOfWeek, startOfMonth, subDays } from 'date-fns';
import { 
  calculateGoodDayPoints, 
  getTemplateById, 
  calculateWeeklyExpectations,
  type DayTypeTemplate,
  type WeeklyExpectedMetrics,
} from '@/lib/goodDayModel';
import { 
  useWorkScheduleConfig, 
  useHolidays, 
  usePtoDays, 
  useWorkdayOverrides,
  isEligibleDay 
} from '@/hooks/useStreakData';

// Get eligible workdays for a date range
export function useEligibleWorkdays(startDate: Date, endDate: Date) {
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  
  const eligibleDays: string[] = [];
  
  if (config && holidays && ptoDays && overrides) {
    let current = new Date(startDate);
    while (current <= endDate) {
      if (isEligibleDay(current, config, holidays, ptoDays, overrides)) {
        eligibleDays.push(format(current, 'yyyy-MM-dd'));
      }
      current.setDate(current.getDate() + 1);
    }
  }
  
  return eligibleDays;
}

// Get week-to-date journal entries and calculate rollups
export function useWeekToDateMetrics() {
  const { user } = useAuth();
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday start
  
  return useQuery({
    queryKey: ['wtd-metrics', format(weekStart, 'yyyy-MM-dd')],
    queryFn: async () => {
      const startStr = format(weekStart, 'yyyy-MM-dd');
      const endStr = format(today, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      // Calculate totals
      const totals = {
        dials: 0,
        conversations: 0,
        prospectsAdded: 0,
        managerPlusMessages: 0,
        manualEmails: 0,
        automatedEmails: 0,
        meetingsSet: 0,
        customerMeetingsHeld: 0,
        oppsCreated: 0,
        personalDevelopmentDays: 0,
        accountsResearched: 0,
        contactsPrepped: 0,
        pointsEarned: 0,
        daysLogged: data?.length || 0,
      };
      
      for (const entry of data || []) {
        totals.dials += entry.dials || 0;
        totals.conversations += entry.conversations || 0;
        totals.prospectsAdded += entry.prospects_added || 0;
        totals.managerPlusMessages += entry.manager_plus_messages || 0;
        totals.manualEmails += entry.manual_emails || 0;
        totals.automatedEmails += entry.automated_emails || 0;
        totals.meetingsSet += entry.meetings_set || 0;
        totals.customerMeetingsHeld += entry.customer_meetings_held || 0;
        totals.oppsCreated += entry.opportunities_created || 0;
        totals.personalDevelopmentDays += entry.personal_development ? 1 : 0;
        totals.accountsResearched += entry.accounts_researched || 0;
        totals.contactsPrepped += entry.contacts_prepped || 0;
        totals.pointsEarned += entry.daily_score || 0;
      }
      
      return {
        ...totals,
        entries: data || [],
        weekStart,
        today,
      };
    },
    enabled: !!user,
  });
}

// Get month-to-date metrics
export function useMonthToDateMetrics() {
  const { user } = useAuth();
  const today = new Date();
  const monthStart = startOfMonth(today);
  
  return useQuery({
    queryKey: ['mtd-metrics', format(monthStart, 'yyyy-MM-dd')],
    queryFn: async () => {
      const startStr = format(monthStart, 'yyyy-MM-dd');
      const endStr = format(today, 'yyyy-MM-dd');
      
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .gte('date', startStr)
        .lte('date', endStr)
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      const totals = {
        dials: 0,
        conversations: 0,
        prospectsAdded: 0,
        managerPlusMessages: 0,
        meetingsSet: 0,
        customerMeetingsHeld: 0,
        oppsCreated: 0,
        personalDevelopmentDays: 0,
        accountsResearched: 0,
        contactsPrepped: 0,
        pointsEarned: 0,
        daysLogged: data?.length || 0,
      };
      
      for (const entry of data || []) {
        totals.dials += entry.dials || 0;
        totals.conversations += entry.conversations || 0;
        totals.prospectsAdded += entry.prospects_added || 0;
        totals.managerPlusMessages += entry.manager_plus_messages || 0;
        totals.meetingsSet += entry.meetings_set || 0;
        totals.customerMeetingsHeld += entry.customer_meetings_held || 0;
        totals.oppsCreated += entry.opportunities_created || 0;
        totals.personalDevelopmentDays += entry.personal_development ? 1 : 0;
        totals.accountsResearched += entry.accounts_researched || 0;
        totals.contactsPrepped += entry.contacts_prepped || 0;
        totals.pointsEarned += entry.daily_score || 0;
      }
      
      return {
        ...totals,
        entries: data || [],
        monthStart,
        today,
      };
    },
    enabled: !!user,
  });
}

// Get rolling averages (30D and 6M)
export function useRollingAverages() {
  const { user } = useAuth();
  const today = new Date();
  const start30d = subDays(today, 30);
  const start6m = subDays(today, 180);
  
  return useQuery({
    queryKey: ['rolling-averages'],
    queryFn: async () => {
      const { data: entries6m, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .gte('date', format(start6m, 'yyyy-MM-dd'))
        .lte('date', format(today, 'yyyy-MM-dd'))
        .order('date', { ascending: true });
      
      if (error) throw error;
      
      const entries30d = entries6m?.filter(e => e.date >= format(start30d, 'yyyy-MM-dd')) || [];
      
      const calculate = (entries: any[]) => {
        if (entries.length === 0) {
          return {
            dials: 0,
            conversations: 0,
            prospectsAdded: 0,
            managerPlusMessages: 0,
            meetingsSet: 0,
            oppsCreated: 0,
            pointsPerDay: 0,
          };
        }
        
        const sum = entries.reduce((acc, e) => ({
          dials: acc.dials + (e.dials || 0),
          conversations: acc.conversations + (e.conversations || 0),
          prospectsAdded: acc.prospectsAdded + (e.prospects_added || 0),
          managerPlusMessages: acc.managerPlusMessages + (e.manager_plus_messages || 0),
          meetingsSet: acc.meetingsSet + (e.meetings_set || 0),
          oppsCreated: acc.oppsCreated + (e.opportunities_created || 0),
          points: acc.points + (e.daily_score || 0),
        }), { dials: 0, conversations: 0, prospectsAdded: 0, managerPlusMessages: 0, meetingsSet: 0, oppsCreated: 0, points: 0 });
        
        const count = entries.length;
        return {
          dials: sum.dials / count,
          conversations: sum.conversations / count,
          prospectsAdded: sum.prospectsAdded / count,
          managerPlusMessages: sum.managerPlusMessages / count,
          meetingsSet: sum.meetingsSet / count,
          oppsCreated: sum.oppsCreated / count,
          pointsPerDay: sum.points / count,
        };
      };
      
      return {
        avg30d: calculate(entries30d),
        avg6m: calculate(entries6m || []),
        count30d: entries30d.length,
        count6m: entries6m?.length || 0,
      };
    },
  });
}

// Calculate expected vs actual for the week
export interface ExpectedVsActual {
  metric: string;
  expected: number;
  actual: number;
  gap: number;
  percentComplete: number;
  status: 'ahead' | 'on-track' | 'behind';
}

export function calculateExpectedVsActual(
  expected: WeeklyExpectedMetrics,
  actual: {
    prospectsAdded: number;
    conversations: number;
    managerPlusMessages: number;
    meetingsSet: number;
    oppsCreated: number;
    personalDevelopmentDays: number;
    pointsEarned: number;
  },
  daysElapsed: number
): ExpectedVsActual[] {
  const proratedExpected = (value: number) => 
    expected.eligibleDays > 0 ? (value / expected.eligibleDays) * daysElapsed : 0;
  
  const createMetric = (
    name: string,
    expectedValue: number,
    actualValue: number
  ): ExpectedVsActual => {
    const proratedExp = proratedExpected(expectedValue);
    const gap = proratedExp - actualValue;
    const percentComplete = proratedExp > 0 ? actualValue / proratedExp : 1;
    
    let status: 'ahead' | 'on-track' | 'behind';
    if (percentComplete >= 1.0) status = 'ahead';
    else if (percentComplete >= 0.8) status = 'on-track';
    else status = 'behind';
    
    return {
      metric: name,
      expected: Math.round(proratedExp),
      actual: actualValue,
      gap: Math.round(gap),
      percentComplete,
      status,
    };
  };
  
  return [
    createMetric('Points', expected.pointsTarget, actual.pointsEarned),
    createMetric('Prospects Added', expected.prospectsAdded, actual.prospectsAdded),
    createMetric('Conversations', expected.conversations, actual.conversations),
    createMetric('Manager+ Messages', expected.managerPlusMessages, actual.managerPlusMessages),
    createMetric('Meetings Set', expected.meetingsSet, actual.meetingsSet),
    createMetric('Opps Created', expected.oppsCreated, actual.oppsCreated),
    createMetric('PD Hours', expected.personalDevelopmentHours, actual.personalDevelopmentDays),
  ];
}
