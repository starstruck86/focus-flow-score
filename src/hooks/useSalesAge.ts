// Sales Age and Quota Pace hooks
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays, subMonths, startOfWeek, endOfWeek } from 'date-fns';
import { useStore } from '@/store/useStore';
import { 
  calculateQPI, 
  calculateSalesAge, 
  calculatePaceToQuota,
  calculateSalesAgeResult,
  generateRecommendations,
  getCurrentWeekEnding,
  DEFAULT_QUOTA_TARGETS,
  type QuotaTargets,
  type DailyMetrics,
  type SalesAgeResult,
  type PaceToQuota,
  type ActionRecommendation,
} from '@/lib/salesAgeCalculations';
import { calculateCommissionSummary, DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';

// Transform DB row to QuotaTargets
function transformQuotaTargets(data: any): QuotaTargets {
  return {
    fiscalYearStart: data.fiscal_year_start,
    fiscalYearEnd: data.fiscal_year_end,
    newArrQuota: parseFloat(data.new_arr_quota) || DEFAULT_QUOTA_TARGETS.newArrQuota,
    renewalArrQuota: parseFloat(data.renewal_arr_quota) || DEFAULT_QUOTA_TARGETS.renewalArrQuota,
    newArrAcr: parseFloat(data.new_arr_acr) || DEFAULT_QUOTA_TARGETS.newArrAcr,
    renewalArrAcr: parseFloat(data.renewal_arr_acr) || DEFAULT_QUOTA_TARGETS.renewalArrAcr,
    targetDialsPerDay: parseFloat(data.target_dials_per_day) || DEFAULT_QUOTA_TARGETS.targetDialsPerDay,
    targetConnectsPerDay: parseFloat(data.target_connects_per_day) || DEFAULT_QUOTA_TARGETS.targetConnectsPerDay,
    targetMeetingsSetPerWeek: parseFloat(data.target_meetings_set_per_week) || DEFAULT_QUOTA_TARGETS.targetMeetingsSetPerWeek,
    targetOppsCreatedPerWeek: parseFloat(data.target_opps_created_per_week) || DEFAULT_QUOTA_TARGETS.targetOppsCreatedPerWeek,
    targetCustomerMeetingsPerWeek: parseFloat(data.target_customer_meetings_per_week) || DEFAULT_QUOTA_TARGETS.targetCustomerMeetingsPerWeek,
    targetAccountsResearchedPerDay: parseFloat(data.target_accounts_researched_per_day) || DEFAULT_QUOTA_TARGETS.targetAccountsResearchedPerDay,
    targetContactsPreppedPerDay: parseFloat(data.target_contacts_prepped_per_day) || DEFAULT_QUOTA_TARGETS.targetContactsPreppedPerDay,
    qpiNewLogoWeight: parseFloat(data.qpi_new_logo_weight) || DEFAULT_QUOTA_TARGETS.qpiNewLogoWeight,
    qpiRenewalWeight: parseFloat(data.qpi_renewal_weight) || DEFAULT_QUOTA_TARGETS.qpiRenewalWeight,
  };
}

// Transform journal entry to DailyMetrics
function transformJournalToMetrics(entry: any): DailyMetrics {
  return {
    date: entry.date,
    dials: entry.dials || 0,
    conversations: entry.conversations || 0,
    meetingsSet: entry.meetings_set || 0,
    opportunitiesCreated: entry.opportunities_created || 0,
    customerMeetingsHeld: entry.customer_meetings_held || 0,
    accountsResearched: entry.accounts_researched || 0,
    contactsPrepped: entry.contacts_prepped || 0,
    prospectsAdded: entry.prospects_added || 0,
  };
}

// Fetch quota targets
export function useQuotaTargets() {
  return useQuery({
    queryKey: ['quota-targets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('quota_targets')
        .select('*')
        .maybeSingle();
      
      if (error) throw error;
      return data ? transformQuotaTargets(data) : DEFAULT_QUOTA_TARGETS;
    },
  });
}

// Upsert quota targets
export function useSaveQuotaTargets() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (targets: QuotaTargets) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const payload = {
        user_id: user.id,
        fiscal_year_start: targets.fiscalYearStart,
        fiscal_year_end: targets.fiscalYearEnd,
        new_arr_quota: targets.newArrQuota,
        renewal_arr_quota: targets.renewalArrQuota,
        new_arr_acr: targets.newArrAcr,
        renewal_arr_acr: targets.renewalArrAcr,
        target_dials_per_day: targets.targetDialsPerDay,
        target_connects_per_day: targets.targetConnectsPerDay,
        target_meetings_set_per_week: targets.targetMeetingsSetPerWeek,
        target_opps_created_per_week: targets.targetOppsCreatedPerWeek,
        target_customer_meetings_per_week: targets.targetCustomerMeetingsPerWeek,
        target_accounts_researched_per_day: targets.targetAccountsResearchedPerDay,
        target_contacts_prepped_per_day: targets.targetContactsPreppedPerDay,
        qpi_new_logo_weight: targets.qpiNewLogoWeight,
        qpi_renewal_weight: targets.qpiRenewalWeight,
      };
      
      const { data, error } = await supabase
        .from('quota_targets')
        .upsert(payload, { onConflict: 'user_id' })
        .select()
        .single();
      
      if (error) throw error;
      return transformQuotaTargets(data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quota-targets'] });
      queryClient.invalidateQueries({ queryKey: ['sales-age'] });
    },
  });
}

// Fetch daily journal entries for metrics calculation
export function useJournalMetrics(days: number) {
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');
  
  return useQuery({
    queryKey: ['journal-metrics', days],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('date, dials, conversations, meetings_set, opportunities_created, customer_meetings_held, accounts_researched, contacts_prepped, prospects_added')
        .gte('date', startDate)
        .order('date', { ascending: false });
      
      if (error) throw error;
      return (data || []).map(transformJournalToMetrics);
    },
  });
}

// Fetch prior sales age snapshot
export function usePriorSalesAgeSnapshot() {
  const priorWeekEnding = format(subDays(new Date(), 7), 'yyyy-MM-dd');
  
  return useQuery({
    queryKey: ['sales-age-snapshot-prior'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_age_snapshots')
        .select('*')
        .lte('week_ending', priorWeekEnding)
        .order('week_ending', { ascending: false })
        .limit(1)
        .maybeSingle();
      
      if (error) throw error;
      return data;
    },
  });
}

// Fetch sales age snapshot history
export function useSalesAgeHistory(weeks: number = 12) {
  return useQuery({
    queryKey: ['sales-age-history', weeks],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sales_age_snapshots')
        .select('*')
        .order('week_ending', { ascending: false })
        .limit(weeks);
      
      if (error) throw error;
      return data || [];
    },
  });
}

// Calculate and return current Sales Age data
export function useSalesAge() {
  const { data: targets } = useQuotaTargets();
  const { data: metrics30d } = useJournalMetrics(30);
  const { data: metrics6m } = useJournalMetrics(180);
  const { data: priorSnapshot } = usePriorSalesAgeSnapshot();
  const { opportunities, quotaConfig } = useStore();
  
  // Get closed won data from Zustand store
  const config = quotaConfig || DEFAULT_QUOTA_CONFIG;
  const now = new Date();
  const fyStart = targets?.fiscalYearStart || config.fiscalYearStart;
  const fyEnd = targets?.fiscalYearEnd || config.fiscalYearEnd;
  
  const dateFilter = {
    start: fyStart,
    end: format(now, 'yyyy-MM-dd'),
  };
  
  const commissionSummary = calculateCommissionSummary(opportunities, {
    ...config,
    newArrQuota: targets?.newArrQuota || config.newArrQuota,
    renewalArrQuota: targets?.renewalArrQuota || config.renewalArrQuota,
  }, dateFilter);
  
  return useQuery({
    queryKey: ['sales-age', targets, metrics30d?.length, metrics6m?.length, commissionSummary.newArrBooked],
    queryFn: async () => {
      const effectiveTargets = targets || DEFAULT_QUOTA_TARGETS;
      const m30d = metrics30d || [];
      const m6m = metrics6m || [];
      const prior = priorSnapshot ? {
        salesAge: Number(priorSnapshot.sales_age),
        qpiCombined: Number(priorSnapshot.qpi_combined),
      } : undefined;
      
      // Calculate 30-60 day metrics for comparison
      const priorMetrics = m6m.filter(m => {
        const date = new Date(m.date);
        const thirtyDaysAgo = subDays(new Date(), 30);
        const sixtyDaysAgo = subDays(new Date(), 60);
        return date >= sixtyDaysAgo && date < thirtyDaysAgo;
      });
      
      const result = calculateSalesAgeResult(
        m30d,
        m6m,
        priorMetrics,
        commissionSummary.newArrBooked,
        commissionSummary.renewalArrBooked,
        effectiveTargets,
        prior
      );
      
      return result;
    },
    enabled: !!targets || !!metrics30d,
  });
}

// Get pace to quota
export function usePaceToQuota() {
  const { data: targets } = useQuotaTargets();
  const { opportunities, quotaConfig } = useStore();
  
  const config = quotaConfig || DEFAULT_QUOTA_CONFIG;
  const effectiveTargets = targets || DEFAULT_QUOTA_TARGETS;
  
  const dateFilter = {
    start: effectiveTargets.fiscalYearStart,
    end: format(new Date(), 'yyyy-MM-dd'),
  };
  
  const commissionSummary = calculateCommissionSummary(opportunities, {
    ...config,
    newArrQuota: effectiveTargets.newArrQuota,
    renewalArrQuota: effectiveTargets.renewalArrQuota,
  }, dateFilter);
  
  return calculatePaceToQuota(
    commissionSummary.newArrBooked,
    commissionSummary.renewalArrBooked,
    effectiveTargets
  );
}

// Get actionable recommendations
export function useActionRecommendations() {
  const { data: salesAge } = useSalesAge();
  const paceToQuota = usePaceToQuota();
  const { data: targets } = useQuotaTargets();
  const { opportunities, renewals } = useStore();
  
  // Count opps/renewals in next 45 days
  const now = new Date();
  const fortyFiveDaysFromNow = format(subDays(now, -45), 'yyyy-MM-dd');
  
  const oppsNext45 = opportunities.filter(o => 
    o.status !== 'closed-won' && 
    o.status !== 'closed-lost' && 
    o.closeDate && 
    o.closeDate <= fortyFiveDaysFromNow
  ).length;
  
  const renewalsNext45 = renewals.filter(r => 
    r.renewalDue <= fortyFiveDaysFromNow
  ).length;
  
  if (!salesAge || !targets) return [];
  
  return generateRecommendations(
    salesAge.qpi,
    paceToQuota,
    oppsNext45,
    renewalsNext45,
    targets
  );
}

// Save weekly snapshot
export function useSaveSalesAgeSnapshot() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (snapshot: {
      salesAge: SalesAgeResult;
      newArrClosed: number;
      renewalArrClosed: number;
      newArrQuota: number;
      renewalArrQuota: number;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      
      const weekEnding = getCurrentWeekEnding();
      const { salesAge, newArrClosed, renewalArrClosed, newArrQuota, renewalArrQuota } = snapshot;
      
      const payload = {
        user_id: user.id,
        snapshot_date: format(new Date(), 'yyyy-MM-dd'),
        week_ending: weekEnding,
        qpi_new_logo: salesAge.qpi.qpiNewLogo,
        qpi_renewal: salesAge.qpi.qpiRenewal,
        qpi_combined: salesAge.qpi.qpiCombined,
        sales_age: salesAge.salesAge,
        pace_of_aging: salesAge.paceOfAging,
        status: salesAge.status,
        benchmark_30d_qpi: salesAge.benchmark30d,
        benchmark_6m_qpi: salesAge.benchmark6m,
        driver_dials_avg: salesAge.qpi.drivers.find(d => d.key === 'dials')?.value || 0,
        driver_connects_avg: salesAge.qpi.drivers.find(d => d.key === 'connects')?.value || 0,
        driver_meetings_set_avg: salesAge.qpi.drivers.find(d => d.key === 'meetingsSet')?.value || 0,
        driver_opps_created_avg: salesAge.qpi.drivers.find(d => d.key === 'oppsCreated')?.value || 0,
        driver_customer_meetings_avg: salesAge.qpi.drivers.find(d => d.key === 'customerMeetings')?.value || 0,
        driver_accounts_researched_avg: salesAge.qpi.drivers.find(d => d.key === 'accountsResearched')?.value || 0,
        driver_contacts_prepped_avg: salesAge.qpi.drivers.find(d => d.key === 'contactsPrepped')?.value || 0,
        new_arr_closed: newArrClosed,
        new_arr_quota: newArrQuota,
        renewal_arr_closed: renewalArrClosed,
        renewal_arr_quota: renewalArrQuota,
        projected_finish_30d: salesAge.projectedFinish30d,
        projected_finish_6m: salesAge.projectedFinish6m,
      };
      
      // Use any to bypass strict type checking for the onConflict option
      const { data, error } = await (supabase
        .from('sales_age_snapshots')
        .upsert(payload as any, { onConflict: 'user_id,week_ending' }) as any)
        .select()
        .single();
      
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-age-snapshot-prior'] });
      queryClient.invalidateQueries({ queryKey: ['sales-age-history'] });
    },
  });
}

// Performance rollups (WTD, MTD, QTD)
export function usePerformanceRollups() {
  const now = new Date();
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  const monthStart = format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
  
  return useQuery({
    queryKey: ['performance-rollups', weekStart],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('daily_journal_entries')
        .select('date, dials, conversations, meetings_set, customer_meetings_held, opportunities_created, accounts_researched, contacts_prepped')
        .gte('date', monthStart)
        .order('date', { ascending: false });
      
      if (error) throw error;
      
      const entries = data || [];
      
      // WTD
      const wtdEntries = entries.filter(e => e.date >= weekStart);
      const wtd = {
        dials: wtdEntries.reduce((s, e) => s + (e.dials || 0), 0),
        conversations: wtdEntries.reduce((s, e) => s + (e.conversations || 0), 0),
        meetingsSet: wtdEntries.reduce((s, e) => s + (e.meetings_set || 0), 0),
        customerMeetingsHeld: wtdEntries.reduce((s, e) => s + (e.customer_meetings_held || 0), 0),
        oppsCreated: wtdEntries.reduce((s, e) => s + (e.opportunities_created || 0), 0),
        accountsResearched: wtdEntries.reduce((s, e) => s + (e.accounts_researched || 0), 0),
        contactsPrepped: wtdEntries.reduce((s, e) => s + (e.contacts_prepped || 0), 0),
      };
      
      // MTD
      const mtd = {
        dials: entries.reduce((s, e) => s + (e.dials || 0), 0),
        conversations: entries.reduce((s, e) => s + (e.conversations || 0), 0),
        meetingsSet: entries.reduce((s, e) => s + (e.meetings_set || 0), 0),
        customerMeetingsHeld: entries.reduce((s, e) => s + (e.customer_meetings_held || 0), 0),
        oppsCreated: entries.reduce((s, e) => s + (e.opportunities_created || 0), 0),
        accountsResearched: entries.reduce((s, e) => s + (e.accounts_researched || 0), 0),
        contactsPrepped: entries.reduce((s, e) => s + (e.contacts_prepped || 0), 0),
      };
      
      return { wtd, mtd, wtdDays: wtdEntries.length, mtdDays: entries.length };
    },
  });
}
