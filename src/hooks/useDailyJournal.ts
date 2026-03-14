import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays } from 'date-fns';
import type {
  DailyJournalEntry,
  ActivityTotals,
  PreparednessInputs,
  RecoveryJournalInputs,
} from '@/types/journal';
import { 
  calculateDailyPoints, 
  calculateSalesStrain, 
  calculateSalesRecovery, 
  calculateSalesProductivity 
} from '@/lib/calculations';
import type { DailyRawInputs, DailyActivityInputs, RecoveryInputs } from '@/types';

// Transform DB row to app format
function transformJournalEntry(data: any): DailyJournalEntry {
  return {
    id: data.id,
    userId: data.user_id,
    date: data.date,
    activity: {
      dials: data.dials,
      conversations: data.conversations,
      prospectsAdded: data.prospects_added,
      managerPlusMessages: data.manager_plus_messages,
      manualEmails: data.manual_emails,
      automatedEmails: data.automated_emails,
      meetingsSet: data.meetings_set,
      customerMeetingsHeld: data.customer_meetings_held,
      opportunitiesCreated: data.opportunities_created,
      personalDevelopment: data.personal_development,
      prospectingBlockMinutes: data.prospecting_block_minutes,
      accountDeepWorkMinutes: data.account_deep_work_minutes,
      expansionTouchpoints: data.expansion_touchpoints,
      focusMode: data.focus_mode,
    },
    preparedness: {
      accountsResearched: data.accounts_researched,
      contactsPrepped: data.contacts_prepped,
      preppedForAllCallsTomorrow: data.prepped_for_all_calls_tomorrow,
      callsNeedPrepCount: data.calls_need_prep_count || 0,
      callsPrepNote: data.calls_prep_note || '',
      meetingPrepDone: data.meeting_prep_done,
      meetingsUnpreparedFor: data.meetings_unprepared_for,
      meetingsUnpreparedNote: data.meetings_unprepared_note || '',
    },
    recovery: {
      sleepHours: parseFloat(data.sleep_hours) || 7,
      energy: data.energy || 3,
      focusQuality: data.focus_quality || 3,
      stress: data.stress || 3,
      clarity: data.clarity || 3,
      distractions: data.distractions || 'medium',
      contextSwitching: data.context_switching || 'medium',
      adminHeavyDay: data.admin_heavy_day,
      travelDay: data.travel_day,
      whatDrainedYou: data.what_drained_you || '',
      whatWorkedToday: data.what_worked_today || '',
    },
    dailyScore: data.daily_score,
    salesStrain: data.sales_strain ? parseFloat(data.sales_strain) : null,
    salesRecovery: data.sales_recovery,
    salesProductivity: data.sales_productivity,
    goalMet: data.goal_met,
    checkedIn: data.checked_in,
    checkInTimestamp: data.check_in_timestamp,
    confirmed: data.confirmed,
    confirmationTimestamp: data.confirmation_timestamp,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

// Convert journal data to calculation format
function toRawInputs(activity: ActivityTotals): DailyRawInputs {
  return {
    prospectsAddedToCadence: activity.prospectsAdded,
    coldCallsWithConversations: activity.conversations,
    emailsInMailsToManager: activity.managerPlusMessages,
    initialMeetingsSet: activity.meetingsSet,
    opportunitiesCreated: activity.opportunitiesCreated,
    personalDevelopment: activity.personalDevelopment ? 1 : 0,
  };
}

function toActivityInputs(activity: ActivityTotals): DailyActivityInputs {
  const totalEmails = activity.manualEmails + activity.automatedEmails;
  const automatedPercent = totalEmails > 0 
    ? Math.round((activity.automatedEmails / totalEmails) * 100) as 0 | 25 | 50 | 75 | 100
    : 0;
  
  return {
    dials: activity.dials,
    emailsTotal: totalEmails,
    automatedPercent,
    execManagerOutreach: activity.managerPlusMessages,
    customerMeetingsHeld: activity.customerMeetingsHeld,
    accountDeepWorkMinutes: activity.accountDeepWorkMinutes,
    prospectingBlockMinutes: activity.prospectingBlockMinutes,
    expansionTouchpoints: activity.expansionTouchpoints,
    focusMode: activity.focusMode,
  };
}

function toRecoveryInputs(recovery: RecoveryJournalInputs): RecoveryInputs {
  return {
    energy: recovery.energy,
    focusQuality: recovery.focusQuality,
    stress: recovery.stress,
    sleepHours: recovery.sleepHours,
    distractions: recovery.distractions,
    adminHeavyDay: recovery.adminHeavyDay,
    travelDay: recovery.travelDay,
    clarity: recovery.clarity,
    contextSwitching: recovery.contextSwitching,
    meetingMinutes: 0,
  };
}

// Calculate scores from journal data
export function calculateJournalScores(
  activity: ActivityTotals,
  recovery: RecoveryJournalInputs
): {
  dailyScore: number;
  salesStrain: number;
  salesRecovery: number;
  salesProductivity: number;
  goalMet: boolean;
} {
  const rawInputs = toRawInputs(activity);
  const activityInputs = toActivityInputs(activity);
  const recoveryInputs = toRecoveryInputs(recovery);
  
  const dailyScore = calculateDailyPoints(rawInputs);
  const strainResult = calculateSalesStrain(rawInputs, activityInputs, recoveryInputs);
  const recoveryResult = calculateSalesRecovery(recoveryInputs);
  const productivityResult = calculateSalesProductivity(rawInputs, activityInputs, dailyScore);
  
  return {
    dailyScore,
    salesStrain: strainResult.strain,
    salesRecovery: recoveryResult.recovery,
    salesProductivity: productivityResult.productivity,
    goalMet: dailyScore >= 8 || productivityResult.productivity >= 75,
  };
}

// Hooks
export function useTodayJournalEntry() {
  const today = format(new Date(), 'yyyy-MM-dd');
  
  return useQuery({
    queryKey: ['journal-entry', today],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('date', today)
        .maybeSingle();
      
      if (error) throw error;
      return data ? transformJournalEntry(data) : null;
    },
  });
}

export function useYesterdayJournalEntry() {
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
  
  return useQuery({
    queryKey: ['journal-entry', yesterday],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('date', yesterday)
        .maybeSingle();
      
      if (error) throw error;
      return data ? transformJournalEntry(data) : null;
    },
  });
}

export function useJournalEntry(date: string) {
  return useQuery({
    queryKey: ['journal-entry', date],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('*')
        .eq('date', date)
        .maybeSingle();
      
      if (error) throw error;
      return data ? transformJournalEntry(data) : null;
    },
  });
}

export function useSaveJournalEntry() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({
      date,
      activity,
      preparedness,
      recovery,
      markAsCheckedIn = true,
    }: {
      date: string;
      activity: ActivityTotals;
      preparedness: PreparednessInputs;
      recovery: RecoveryJournalInputs;
      markAsCheckedIn?: boolean;
    }) => {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      // Calculate scores
      const scores = calculateJournalScores(activity, recovery);
      
      const payload = {
        user_id: user.id,
        date,
        // Activity
        dials: activity.dials,
        conversations: activity.conversations,
        prospects_added: activity.prospectsAdded,
        manager_plus_messages: activity.managerPlusMessages,
        manual_emails: activity.manualEmails,
        automated_emails: activity.automatedEmails,
        meetings_set: activity.meetingsSet,
        customer_meetings_held: activity.customerMeetingsHeld,
        opportunities_created: activity.opportunitiesCreated,
        personal_development: activity.personalDevelopment,
        prospecting_block_minutes: activity.prospectingBlockMinutes,
        account_deep_work_minutes: activity.accountDeepWorkMinutes,
        expansion_touchpoints: activity.expansionTouchpoints,
        focus_mode: activity.focusMode,
        // Preparedness
        accounts_researched: preparedness.accountsResearched,
        contacts_prepped: preparedness.contactsPrepped,
        prepped_for_all_calls_tomorrow: preparedness.preppedForAllCallsTomorrow,
        calls_need_prep_count: preparedness.callsNeedPrepCount,
        calls_prep_note: preparedness.callsPrepNote || null,
        meeting_prep_done: preparedness.meetingPrepDone,
        meetings_unprepared_for: preparedness.meetingsUnpreparedFor,
        meetings_unprepared_note: preparedness.meetingsUnpreparedNote || null,
        // Recovery
        sleep_hours: recovery.sleepHours,
        energy: recovery.energy,
        focus_quality: recovery.focusQuality,
        stress: recovery.stress,
        clarity: recovery.clarity,
        distractions: recovery.distractions,
        context_switching: recovery.contextSwitching,
        admin_heavy_day: recovery.adminHeavyDay,
        travel_day: recovery.travelDay,
        what_drained_you: recovery.whatDrainedYou || null,
        what_worked_today: recovery.whatWorkedToday || null,
        // Scores
        daily_score: scores.dailyScore,
        sales_strain: scores.salesStrain,
        sales_recovery: scores.salesRecovery,
        sales_productivity: scores.salesProductivity,
        goal_met: scores.goalMet,
        // Status
        checked_in: markAsCheckedIn,
        check_in_timestamp: markAsCheckedIn ? new Date().toISOString() : null,
      };
      
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .upsert(payload, { onConflict: 'user_id,date' })
        .select()
        .single();
      
      if (error) throw error;
      return transformJournalEntry(data);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entry', variables.date] });
      queryClient.invalidateQueries({ queryKey: ['streak-events'] });
      queryClient.invalidateQueries({ queryKey: ['streak-summary'] });
    },
  });
}

export function useConfirmJournalEntry() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (date: string) => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .update({
          confirmed: true,
          confirmation_timestamp: new Date().toISOString(),
        })
        .eq('date', date)
        .select()
        .single();
      
      if (error) throw error;
      return transformJournalEntry(data);
    },
    onSuccess: (_, date) => {
      queryClient.invalidateQueries({ queryKey: ['journal-entry', date] });
    },
  });
}

// Helper to parse time string (HH:MM:SS) to minutes from midnight
function parseTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

// Hook to check if prompts should show
export function useJournalPromptStatus() {
  const { data: today, isLoading: loadingToday } = useTodayJournalEntry();
  const { data: yesterday, isLoading: loadingYesterday } = useYesterdayJournalEntry();
  
  // Import config to get schedule times
  const { data: config, isLoading: loadingConfig } = useQuery({
    queryKey: ['work-schedule-config-journal'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_schedule_config')
        .select('eod_checkin_time, eod_reminder_time, morning_confirm_time, grace_window_end_time')
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      // Return defaults if no config exists
      return {
        eodCheckinTime: data?.eod_checkin_time || '16:30:00',
        eodReminderTime: data?.eod_reminder_time || '18:30:00',
        morningConfirmTime: data?.morning_confirm_time || '08:00:00',
        graceWindowEndTime: data?.grace_window_end_time || '02:00:00',
      };
    },
  });
  
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  const currentTime = currentHour * 60 + currentMinute;
  
  // Parse times from config or use defaults
  const eodCheckInTime = config ? parseTimeToMinutes(config.eodCheckinTime) : 16 * 60 + 30;
  const morningConfirmTime = config ? parseTimeToMinutes(config.morningConfirmTime) : 8 * 60;
  
  // Should show EOD check-in?
  const shouldShowEodCheckIn = 
    currentTime >= eodCheckInTime && 
    !today?.checkedIn;
  
  // Should show morning confirmation?
  const shouldShowMorningConfirm = 
    currentTime >= morningConfirmTime && 
    currentTime < eodCheckInTime &&
    yesterday?.checkedIn && 
    !yesterday?.confirmed;
  
  return {
    shouldShowEodCheckIn,
    shouldShowMorningConfirm,
    todayEntry: today,
    yesterdayEntry: yesterday,
    isLoading: loadingToday || loadingYesterday || loadingConfig,
    config,
  };
}
