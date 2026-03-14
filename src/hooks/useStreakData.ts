import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { 
  WorkScheduleConfig, 
  Holiday, 
  PtoDay, 
  WorkdayOverride, 
  StreakEvent, 
  StreakSummary,
  BadgeEarned,
  getLevelFromStreak,
  CheckInMethod,
} from '@/types/streak';
import { format, parseISO, getDay, startOfWeek, endOfWeek, eachDayOfInterval, isWeekend } from 'date-fns';

// Transform DB snake_case to camelCase
function transformConfig(data: any): WorkScheduleConfig {
  return {
    id: data.id,
    workingDays: data.working_days,
    reminderEnabled: data.reminder_enabled,
    reminderTime: data.reminder_time,
    graceWindowHours: data.grace_window_hours,
    goalDailyScoreThreshold: data.goal_daily_score_threshold,
    goalProductivityThreshold: data.goal_productivity_threshold,
    eodCheckinTime: data.eod_checkin_time || '16:30:00',
    eodReminderTime: data.eod_reminder_time || '18:30:00',
    morningConfirmTime: data.morning_confirm_time || '08:00:00',
    graceWindowEndTime: data.grace_window_end_time || '02:00:00',
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function transformStreakEvent(data: any): StreakEvent {
  return {
    id: data.id,
    date: data.date,
    isEligibleDay: data.is_eligible_day,
    checkedIn: data.checked_in,
    checkInMethod: data.check_in_method,
    checkInTime: data.check_in_time,
    goalMet: data.goal_met,
    dailyScore: data.daily_score,
    productivityScore: data.productivity_score,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

function transformSummary(data: any): StreakSummary {
  return {
    id: data.id,
    currentCheckinStreak: data.current_checkin_streak,
    currentPerformanceStreak: data.current_performance_streak,
    longestCheckinStreak: data.longest_checkin_streak,
    longestPerformanceStreak: data.longest_performance_streak,
    totalEligibleDays: data.total_eligible_days,
    totalCheckins: data.total_checkins,
    totalGoalsMet: data.total_goals_met,
    checkinLevel: data.checkin_level,
    performanceLevel: data.performance_level,
    updatedAt: data.updated_at,
  };
}

function transformBadge(data: any): BadgeEarned {
  return {
    id: data.id,
    badgeType: data.badge_type,
    badgeName: data.badge_name,
    earnedAt: data.earned_at,
    metadata: data.metadata,
  };
}

export function useWorkScheduleConfig() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['work-schedule-config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_schedule_config')
        .select('*')
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      // Return defaults if no config exists
      if (!data) {
        return {
          id: '',
          workingDays: [1, 2, 3, 4, 5], // Mon-Fri
          reminderEnabled: true,
          reminderTime: '16:30:00',
          graceWindowHours: 2,
          goalDailyScoreThreshold: 8,
          goalProductivityThreshold: 75,
          eodCheckinTime: '16:30:00',
          eodReminderTime: '18:30:00',
          morningConfirmTime: '08:00:00',
          graceWindowEndTime: '02:00:00',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        } as WorkScheduleConfig;
      }
      return transformConfig(data);
    },
    enabled: !!user,
  });
}

export function useHolidays() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['holidays'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holidays')
        .select('*')
        .order('date', { ascending: true });
      
      if (error) throw error;
      return data.map((h: any) => ({
        id: h.id,
        date: h.date,
        name: h.name,
        createdAt: h.created_at,
      })) as Holiday[];
    },
    enabled: !!user,
  });
}

export function usePtoDays() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['pto-days'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pto_days')
        .select('*')
        .order('date', { ascending: true });
      
      if (error) throw error;
      return data.map((p: any) => ({
        id: p.id,
        date: p.date,
        note: p.note,
        createdAt: p.created_at,
      })) as PtoDay[];
    },
    enabled: !!user,
  });
}

export function useWorkdayOverrides() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['workday-overrides'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workday_overrides')
        .select('*')
        .order('date', { ascending: true });
      
      if (error) throw error;
      return data.map((o: any) => ({
        id: o.id,
        date: o.date,
        isWorkday: o.is_workday,
        reason: o.reason,
        createdAt: o.created_at,
      })) as WorkdayOverride[];
    },
    enabled: !!user,
  });
}

export function useStreakEvents() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['streak-events'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streak_events')
        .select('*')
        .eq('user_id', user!.id)
        .order('date', { ascending: false });
      
      if (error) throw error;
      return data.map(transformStreakEvent);
    },
    enabled: !!user,
  });
}

export function useStreakSummary() {
  return useQuery({
    queryKey: ['streak-summary'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return {
          id: '',
          currentCheckinStreak: 0,
          currentPerformanceStreak: 0,
          longestCheckinStreak: 0,
          longestPerformanceStreak: 0,
          totalEligibleDays: 0,
          totalCheckins: 0,
          totalGoalsMet: 0,
          checkinLevel: 1,
          performanceLevel: 1,
          updatedAt: new Date().toISOString(),
        } as StreakSummary;
      }
      
      const { data, error } = await supabase
        .from('streak_summary')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      // Return defaults if no summary exists
      if (!data) {
        return {
          id: '',
          currentCheckinStreak: 0,
          currentPerformanceStreak: 0,
          longestCheckinStreak: 0,
          longestPerformanceStreak: 0,
          totalEligibleDays: 0,
          totalCheckins: 0,
          totalGoalsMet: 0,
          checkinLevel: 1,
          performanceLevel: 1,
          updatedAt: new Date().toISOString(),
        } as StreakSummary;
      }
      return transformSummary(data);
    },
  });
}

export function useBadgesEarned() {
  return useQuery({
    queryKey: ['badges-earned'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('badges_earned')
        .select('*')
        .order('earned_at', { ascending: false });
      
      if (error) throw error;
      return data.map(transformBadge);
    },
  });
}

// Check if a date is an eligible workday
export function isEligibleDay(
  date: Date,
  config: WorkScheduleConfig,
  holidays: Holiday[],
  ptoDays: PtoDay[],
  overrides: WorkdayOverride[]
): boolean {
  const dateStr = format(date, 'yyyy-MM-dd');
  
  // Check for explicit override first
  const override = overrides.find(o => o.date === dateStr);
  if (override) {
    return override.isWorkday;
  }
  
  // Check if it's a holiday
  if (holidays.some(h => h.date === dateStr)) {
    return false;
  }
  
  // Check if it's PTO
  if (ptoDays.some(p => p.date === dateStr)) {
    return false;
  }
  
  // Check if it's a configured working day
  const dayOfWeek = getDay(date); // 0=Sun, 1=Mon, ...
  return config.workingDays.includes(dayOfWeek);
}

// Get current week's day statuses for mini calendar
export function useWeekStatus() {
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: events } = useStreakEvents();
  
  if (!config || !holidays || !ptoDays || !overrides || !events) {
    return { weekDays: [], isLoading: true };
  }
  
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 }); // Monday
  const weekEnd = endOfWeek(today, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: weekStart, end: weekEnd });
  
  const weekDays = days.map(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const eligible = isEligibleDay(day, config, holidays, ptoDays, overrides);
    const event = events.find(e => e.date === dateStr);
    const isToday = format(today, 'yyyy-MM-dd') === dateStr;
    const isPast = day < today && !isToday;
    
    return {
      date: day,
      dateStr,
      dayName: format(day, 'EEE'),
      dayNumber: format(day, 'd'),
      isEligible: eligible,
      checkedIn: event?.checkedIn || false,
      goalMet: event?.goalMet || false,
      isToday,
      isPast,
      isFuture: day > today,
    };
  });
  
  return { weekDays, isLoading: false };
}

// Mutations
export function useUpdateConfig() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (updates: Partial<WorkScheduleConfig>) => {
      const { data: current } = await supabase
        .from('work_schedule_config')
        .select('id')
        .limit(1)
        .single();
      
      const dbUpdates: any = {};
      if (updates.workingDays !== undefined) dbUpdates.working_days = updates.workingDays;
      if (updates.reminderEnabled !== undefined) dbUpdates.reminder_enabled = updates.reminderEnabled;
      if (updates.reminderTime !== undefined) dbUpdates.reminder_time = updates.reminderTime;
      if (updates.graceWindowHours !== undefined) dbUpdates.grace_window_hours = updates.graceWindowHours;
      if (updates.goalDailyScoreThreshold !== undefined) dbUpdates.goal_daily_score_threshold = updates.goalDailyScoreThreshold;
      if (updates.goalProductivityThreshold !== undefined) dbUpdates.goal_productivity_threshold = updates.goalProductivityThreshold;
      if (updates.eodCheckinTime !== undefined) dbUpdates.eod_checkin_time = updates.eodCheckinTime;
      if (updates.eodReminderTime !== undefined) dbUpdates.eod_reminder_time = updates.eodReminderTime;
      if (updates.morningConfirmTime !== undefined) dbUpdates.morning_confirm_time = updates.morningConfirmTime;
      if (updates.graceWindowEndTime !== undefined) dbUpdates.grace_window_end_time = updates.graceWindowEndTime;
      
      const { error } = await supabase
        .from('work_schedule_config')
        .update(dbUpdates)
        .eq('id', current?.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-schedule-config'] });
    },
  });
}

export function useAddHoliday() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ date, name }: { date: string; name: string }) => {
      const { error } = await supabase
        .from('holidays')
        .insert({ date, name });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

export function useRemoveHoliday() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('holidays')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holidays'] });
    },
  });
}

export function useAddPtoDay() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ date, note }: { date: string; note?: string }) => {
      const { error } = await supabase
        .from('pto_days')
        .insert({ date, note });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pto-days'] });
    },
  });
}

export function useRemovePtoDay() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('pto_days')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pto-days'] });
    },
  });
}

export function useRecordCheckIn() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ 
      date, 
      method, 
      dailyScore, 
      productivityScore,
      isEligible,
      goalMet,
    }: { 
      date: string; 
      method: CheckInMethod;
      dailyScore?: number;
      productivityScore?: number;
      isEligible: boolean;
      goalMet: boolean;
    }) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Upsert streak event
      const { error: eventError } = await supabase
        .from('streak_events')
        .upsert({
          user_id: user.id,
          date,
          is_eligible_day: isEligible,
          checked_in: true,
          check_in_method: method,
          check_in_time: new Date().toISOString(),
          goal_met: goalMet,
          daily_score: dailyScore,
          productivity_score: productivityScore,
        }, { onConflict: 'user_id,date' });
      
      if (eventError) throw eventError;
      
      // Recalculate streaks
      const { data: events } = await supabase
        .from('streak_events')
        .select('*')
        .eq('user_id', user.id)
        .order('date', { ascending: false });
      
      if (!events) return;
      
      // Calculate current streaks
      let checkinStreak = 0;
      let performanceStreak = 0;
      let foundBreakCheckin = false;
      let foundBreakPerformance = false;
      
      for (const event of events) {
        if (!event.is_eligible_day) continue;
        
        if (!foundBreakCheckin) {
          if (event.checked_in) {
            checkinStreak++;
          } else {
            foundBreakCheckin = true;
          }
        }
        
        if (!foundBreakPerformance) {
          if (event.goal_met) {
            performanceStreak++;
          } else {
            foundBreakPerformance = true;
          }
        }
        
        if (foundBreakCheckin && foundBreakPerformance) break;
      }
      
      // Get current summary
      const { data: summary } = await supabase
        .from('streak_summary')
        .select('*')
        .eq('user_id', user.id)
        .limit(1)
        .single();
      
      const totalCheckins = events.filter(e => e.checked_in).length;
      const totalGoalsMet = events.filter(e => e.goal_met).length;
      const totalEligible = events.filter(e => e.is_eligible_day).length;
      
      // Update summary
      const { error: summaryError } = await supabase
        .from('streak_summary')
        .update({
          current_checkin_streak: checkinStreak,
          current_performance_streak: performanceStreak,
          longest_checkin_streak: Math.max(summary?.longest_checkin_streak || 0, checkinStreak),
          longest_performance_streak: Math.max(summary?.longest_performance_streak || 0, performanceStreak),
          total_eligible_days: totalEligible,
          total_checkins: totalCheckins,
          total_goals_met: totalGoalsMet,
          checkin_level: getLevelFromStreak(checkinStreak),
          performance_level: getLevelFromStreak(performanceStreak),
        })
        .eq('id', summary?.id);
      
      if (summaryError) throw summaryError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['streak-events'] });
      queryClient.invalidateQueries({ queryKey: ['streak-summary'] });
    },
  });
}
