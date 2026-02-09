// Results-First Dashboard with Sales Age, Pace to Quota, and Actionable Recommendations
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, ClipboardCheck } from 'lucide-react';
import { Layout } from '@/components/Layout';
import { DailyCheckInModal } from '@/components/journal';
import { useStore } from '@/store/useStore';
import { 
  useWorkScheduleConfig, 
  useHolidays, 
  usePtoDays, 
  useWorkdayOverrides,
  useStreakEvents,
  isEligibleDay 
} from '@/hooks/useStreakData';
import { useTodayJournalEntry } from '@/hooks/useDailyJournal';
import { 
  useSalesAge, 
  usePaceToQuota, 
  useActionRecommendations,
  usePerformanceRollups,
  useQuotaTargets,
  useSalesAgeHistory,
} from '@/hooks/useSalesAge';
import { calculateCommissionSummary, DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { format } from 'date-fns';
import {
  SalesAgeTile,
  PaceToQuotaCard,
  WhatToDoNext,
  Next45DaysRisk,
  PerformanceSnapshot,
  CommissionSnapshot,
  SalesAgeDetailModal,
  CheckInBanner,
} from '@/components/dashboard';

export default function Dashboard() {
  const [showDailyCheckIn, setShowDailyCheckIn] = useState(false);
  const [showSalesAgeDetail, setShowSalesAgeDetail] = useState(false);
  
  // Store data
  const { opportunities, renewals, quotaConfig } = useStore();
  
  // Streak data hooks
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: streakEvents } = useStreakEvents();
  
  // Journal entry for today
  const { data: todayJournalEntry } = useTodayJournalEntry();
  
  // Sales Age and quota data
  const { data: salesAge, isLoading: salesAgeLoading } = useSalesAge();
  const paceToQuota = usePaceToQuota();
  const recommendations = useActionRecommendations();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: snapshotHistory } = useSalesAgeHistory();
  const { data: performanceRollups, isLoading: rollupsLoading } = usePerformanceRollups();
  
  // Check if today is eligible and if already checked in
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  const todayEvent = streakEvents?.find(e => e.date === todayStr);
  const todayCheckedIn = todayEvent?.checkedIn || todayJournalEntry?.checkedIn || false;
  
  // Commission summary
  const effectiveConfig = quotaConfig || DEFAULT_QUOTA_CONFIG;
  const effectiveTargets = quotaTargets || DEFAULT_QUOTA_TARGETS;
  const fyStart = effectiveTargets.fiscalYearStart;
  const dateFilter = {
    start: fyStart,
    end: format(today, 'yyyy-MM-dd'),
  };
  const commissionSummary = calculateCommissionSummary(opportunities, {
    ...effectiveConfig,
    newArrQuota: effectiveTargets.newArrQuota,
    renewalArrQuota: effectiveTargets.renewalArrQuota,
  }, dateFilter);
  
  const combinedAttainment = (commissionSummary.newArrBooked + commissionSummary.renewalArrBooked) / 
    (effectiveTargets.newArrQuota + effectiveTargets.renewalArrQuota);
  
  // Performance targets for snapshot
  const performanceTargets = {
    dialsPerDay: effectiveTargets.targetDialsPerDay,
    connectsPerDay: effectiveTargets.targetConnectsPerDay,
    meetingsPerWeek: effectiveTargets.targetMeetingsSetPerWeek,
    oppsPerWeek: effectiveTargets.targetOppsCreatedPerWeek,
    customerMeetingsPerWeek: effectiveTargets.targetCustomerMeetingsPerWeek,
    accountsResearchedPerDay: effectiveTargets.targetAccountsResearchedPerDay,
    contactsPreppedPerDay: effectiveTargets.targetContactsPreppedPerDay,
  };

  return (
    <Layout>
      <div className="p-6 lg:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 text-muted-foreground text-sm mb-2">
            <Calendar className="h-4 w-4" />
            {today.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}
          </div>
          <h1 className="font-display text-3xl font-bold">Dashboard</h1>
        </div>
        
        {/* Check-In Banner */}
        <CheckInBanner
          checkedIn={todayCheckedIn}
          isEligibleDay={isTodayEligible}
          onStartCheckIn={() => setShowDailyCheckIn(true)}
          onEditCheckIn={() => setShowDailyCheckIn(true)}
          confirmed={todayJournalEntry?.confirmed}
        />
        
        {/* SECTION 1: Sales Age (Top Tile) */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <SalesAgeTile 
            salesAge={salesAge} 
            isLoading={salesAgeLoading}
            onClick={() => setShowSalesAgeDetail(true)}
          />
        </motion.div>
        
        {/* SECTION 2: Pace to Quota */}
        <PaceToQuotaCard paceToQuota={paceToQuota} />
        
        {/* SECTION 3: What To Do Next */}
        <div className="mt-6">
          <WhatToDoNext 
            recommendations={recommendations} 
            isLoading={salesAgeLoading}
          />
        </div>
        
        {/* SECTION 4: Next 45 Days Risk Window */}
        <div className="mt-6">
          <Next45DaysRisk 
            opportunities={opportunities} 
            renewals={renewals} 
          />
        </div>
        
        {/* SECTION 5 & 6: Performance + Commission Snapshots */}
        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          <PerformanceSnapshot
            wtd={performanceRollups?.wtd || {
              dials: 0, conversations: 0, meetingsSet: 0, 
              customerMeetingsHeld: 0, oppsCreated: 0,
              accountsResearched: 0, contactsPrepped: 0
            }}
            mtd={performanceRollups?.mtd || {
              dials: 0, conversations: 0, meetingsSet: 0, 
              customerMeetingsHeld: 0, oppsCreated: 0,
              accountsResearched: 0, contactsPrepped: 0
            }}
            wtdDays={performanceRollups?.wtdDays || 0}
            mtdDays={performanceRollups?.mtdDays || 0}
            targets={performanceTargets}
            isLoading={rollupsLoading}
          />
          
          <CommissionSnapshot
            totalCommission={commissionSummary.totalCommission}
            newArrAttainment={commissionSummary.newArrAttainment}
            renewalArrAttainment={commissionSummary.renewalArrAttainment}
            combinedAttainment={combinedAttainment}
            projectedImpact={{
              additionalNewArr: 50000,
              additionalCommission: 50000 * effectiveConfig.newArrAcr,
            }}
          />
        </div>
      </div>
      
      {/* Sales Age Detail Modal */}
      <SalesAgeDetailModal
        open={showSalesAgeDetail}
        onOpenChange={setShowSalesAgeDetail}
        salesAge={salesAge}
        recommendations={recommendations}
        snapshotHistory={snapshotHistory || []}
      />
      
      {/* Daily Check-In Modal */}
      <DailyCheckInModal
        open={showDailyCheckIn}
        onOpenChange={setShowDailyCheckIn}
        initialActivity={todayJournalEntry?.activity}
        initialPreparedness={todayJournalEntry?.preparedness}
        initialRecovery={todayJournalEntry?.recovery}
      />
    </Layout>
  );
}
