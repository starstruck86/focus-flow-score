// Results-First Dashboard with Commission Pacing, Expected vs Actual, and Actionable Recommendations
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
  usePaceToQuota, 
  useActionRecommendations,
  usePerformanceRollups,
  useQuotaTargets,
} from '@/hooks/useSalesAge';
import { useCommissionPacing } from '@/hooks/useCommissionPacing';
import { useWeekToDateMetrics, useMonthToDateMetrics, calculateExpectedVsActual } from '@/hooks/useGoodDayMetrics';
import { getTemplateById, calculateWeeklyExpectations } from '@/lib/goodDayModel';
import { calculateCommissionSummary, DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { format, differenceInBusinessDays, startOfWeek } from 'date-fns';
import {
  PaceToQuotaCard,
  WhatToDoNext,
  Next45DaysRisk,
  PerformanceSnapshot,
  CommissionSnapshot,
  CheckInBanner,
  CommissionPacingTile,
  CommissionPacingDetailModal,
  ExpectedVsActualCard,
} from '@/components/dashboard';

export default function Dashboard() {
  const [showDailyCheckIn, setShowDailyCheckIn] = useState(false);
  const [showCommissionDetail, setShowCommissionDetail] = useState(false);
  
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
  
  // Commission Pacing (top tile)
  const { data: commissionPacing, isLoading: pacingLoading } = useCommissionPacing();
  
  // Pace to quota and recommendations
  const paceToQuota = usePaceToQuota();
  const recommendations = useActionRecommendations();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: performanceRollups, isLoading: rollupsLoading } = usePerformanceRollups();
  
  // Expected vs Actual metrics
  const { data: wtdMetrics, isLoading: wtdLoading } = useWeekToDateMetrics();
  const { data: mtdMetrics, isLoading: mtdLoading } = useMonthToDateMetrics();
  
  // Check if today is eligible and if already checked in
  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const isTodayEligible = config && holidays && ptoDays && overrides
    ? isEligibleDay(today, config, holidays, ptoDays, overrides)
    : false;
  const todayEvent = streakEvents?.find(e => e.date === todayStr);
  const todayCheckedIn = todayEvent?.checkedIn || todayJournalEntry?.checkedIn || false;
  
  // Calculate expected vs actual for the week
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const daysElapsedThisWeek = Math.min(5, differenceInBusinessDays(today, weekStart) + 1);
  
  // Use balanced-pd as default template for expectations
  const defaultTemplate = getTemplateById('balanced-pd');
  const weeklyExpectations = calculateWeeklyExpectations(defaultTemplate, 5);
  
  const expectedVsActualMetrics = wtdMetrics ? calculateExpectedVsActual(
    weeklyExpectations,
    {
      prospectsAdded: wtdMetrics.prospectsAdded,
      conversations: wtdMetrics.conversations,
      managerPlusMessages: wtdMetrics.managerPlusMessages,
      meetingsSet: wtdMetrics.meetingsSet,
      oppsCreated: wtdMetrics.oppsCreated,
      personalDevelopmentDays: wtdMetrics.personalDevelopmentDays,
      pointsEarned: wtdMetrics.pointsEarned,
    },
    daysElapsedThisWeek
  ) : [];
  
  // Commission summary for snapshot
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
        
        {/* SECTION 1: Commission Pacing (Top Tile) */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <CommissionPacingTile 
            projectedQuarterCommission={commissionPacing?.projectedQuarterCommission || 0}
            weeklyPaceTrend={commissionPacing?.weeklyPaceTrend || 0}
            projectedAttainment={commissionPacing?.projectedAttainment || 0}
            status={commissionPacing?.status || 'stable'}
            isLoading={pacingLoading}
            onClick={() => setShowCommissionDetail(true)}
          />
        </motion.div>
        
        {/* SECTION 2: Expected vs Actual (Today + WTD) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          {/* Today's Progress */}
          <ExpectedVsActualCard
            title="Today's Progress"
            subtitle={todayCheckedIn ? "Checked in" : "Not yet checked in"}
            metrics={todayJournalEntry ? [
              {
                metric: 'Points',
                expected: 8,
                actual: todayJournalEntry.dailyScore || 0,
                gap: 8 - (todayJournalEntry.dailyScore || 0),
                percentComplete: (todayJournalEntry.dailyScore || 0) / 8,
                status: (todayJournalEntry.dailyScore || 0) >= 8 ? 'ahead' : 
                        (todayJournalEntry.dailyScore || 0) >= 6 ? 'on-track' : 'behind',
              },
              {
                metric: 'Conversations',
                expected: defaultTemplate.conversations,
                actual: todayJournalEntry.activity.conversations,
                gap: defaultTemplate.conversations - todayJournalEntry.activity.conversations,
                percentComplete: todayJournalEntry.activity.conversations / defaultTemplate.conversations,
                status: todayJournalEntry.activity.conversations >= defaultTemplate.conversations ? 'ahead' : 'behind',
              },
              {
                metric: 'Prospects Added',
                expected: defaultTemplate.prospectsAdded,
                actual: todayJournalEntry.activity.prospectsAdded,
                gap: defaultTemplate.prospectsAdded - todayJournalEntry.activity.prospectsAdded,
                percentComplete: todayJournalEntry.activity.prospectsAdded / defaultTemplate.prospectsAdded,
                status: todayJournalEntry.activity.prospectsAdded >= defaultTemplate.prospectsAdded ? 'ahead' : 'behind',
              },
            ] : []}
            pointsEarned={todayJournalEntry?.dailyScore || 0}
            pointsTarget={8}
            isLoading={!todayJournalEntry && !todayCheckedIn}
          />
          
          {/* Week-to-Date Progress */}
          <ExpectedVsActualCard
            title="Week-to-Date"
            subtitle={`${daysElapsedThisWeek} of 5 workdays`}
            metrics={expectedVsActualMetrics}
            pointsEarned={wtdMetrics?.pointsEarned || 0}
            pointsTarget={8 * daysElapsedThisWeek}
            isLoading={wtdLoading}
          />
        </div>
        
        {/* SECTION 3: Pace to Quota */}
        <PaceToQuotaCard paceToQuota={paceToQuota} />
        
        {/* SECTION 4: What To Do Next */}
        <div className="mt-6">
          <WhatToDoNext 
            recommendations={commissionPacing?.actionPlan.map((a, i) => ({
              id: `action-${i}`,
              priority: (i + 1) as 1 | 2 | 3,
              action: a.action,
              target: a.target,
              timeframe: a.timeframe,
              workflow: a.workflow as any,
              why: `Based on current pace`,
              impact: a.impact,
              qpiImpact: 0.05 * (3 - i), // Decreasing impact estimate
            })) || []} 
            isLoading={pacingLoading}
          />
        </div>
        
        {/* SECTION 5: Next 45 Days Risk Window */}
        <div className="mt-6">
          <Next45DaysRisk 
            opportunities={opportunities} 
            renewals={renewals} 
          />
        </div>
        
        {/* SECTION 6: Performance + Commission Snapshots */}
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
      
      {/* Commission Pacing Detail Modal */}
      <CommissionPacingDetailModal
        open={showCommissionDetail}
        onOpenChange={setShowCommissionDetail}
        projectedCommission={commissionPacing?.projectedQuarterCommission || 0}
        currentCommission={commissionPacing?.currentCommission || 0}
        weeklyPaceTrend={commissionPacing?.weeklyPaceTrend || 0}
        projectedAttainment={commissionPacing?.projectedAttainment || 0}
        benchmarks={{
          pace30d: commissionPacing?.pace30d || 0,
          pace6m: commissionPacing?.pace6m || 0,
          paceRequired: commissionPacing?.paceRequired || 0,
        }}
        drivers={commissionPacing?.drivers || []}
        actionPlan={commissionPacing?.actionPlan || []}
        sensitivityAnalysis={commissionPacing?.sensitivityAnalysis || []}
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
