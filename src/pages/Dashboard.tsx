// Results-First Dashboard with customizable widget layout
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar } from 'lucide-react';
import { StreakChip } from '@/components/StreakChip';
import { Layout } from '@/components/Layout';
import { DailyScorecardModal, BackfillCards, JournalDashboardCard } from '@/components/journal';
import { WeeklyRealignmentModal } from '@/components/weekly/WeeklyRealignmentModal';
import { WeeklyReviewBanner } from '@/components/dashboard/WeeklyReviewBanner';
import { useCurrentWeekReview } from '@/hooks/useWeeklyReview';
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
import { useQuotaTargets } from '@/hooks/useSalesAge';
import { useCommissionPacing } from '@/hooks/useCommissionPacing';
import { useWeekToDateMetrics, calculateExpectedVsActual } from '@/hooks/useGoodDayMetrics';
import { getTemplateById, calculateWeeklyExpectations } from '@/lib/goodDayModel';
import { DEFAULT_QUOTA_CONFIG } from '@/lib/commissionCalculations';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { format, differenceInBusinessDays, startOfWeek } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useDashboardWidgets } from '@/hooks/useDashboardWidgets';
import { WidgetCustomizer } from '@/components/dashboard/WidgetCustomizer';
import {
  CheckInBanner,
  CommissionPacingTile,
  CommissionPacingDetailModal,
  ExpectedVsActualCard,
  TodayAgenda,
  MeetingPrepCard,
  SmartWorkQueue,
  DailyDigest,
  MeetingPrepPrompt,
  CalendarIntelligence,
  DailyTimeBlocks,
  PClubMathCard,
  WeeklyBattlePlanCard,
  CoachingFeed,
} from '@/components/dashboard';
import { WidgetErrorBoundary } from '@/components/dashboard/WidgetErrorBoundary';

export default function Dashboard() {
  // Dashboard state
  const [showDailyCheckIn, setShowDailyCheckIn] = useState(false);
  const [showCommissionDetail, setShowCommissionDetail] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const { widgets, toggleWidget, moveWidget, resetWidgets } = useDashboardWidgets();
  const { data: currentWeekReview, isLoading: weeklyReviewLoading } = useCurrentWeekReview();
  
  const { opportunities, renewals, quotaConfig } = useStore();
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: streakEvents } = useStreakEvents();
  const { data: todayJournalEntry, isLoading: journalLoading } = useTodayJournalEntry();
  const { data: commissionPacing, isLoading: pacingLoading } = useCommissionPacing();
  const paceToQuota = usePaceToQuota();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: performanceRollups, isLoading: rollupsLoading } = usePerformanceRollups();
  const { data: wtdMetrics, isLoading: wtdLoading } = useWeekToDateMetrics();

  // Wrap all derived calculations in try-catch to prevent render crashes
  let today: Date;
  let todayStr: string;
  let isTodayEligible = false;
  let todayCheckedIn = false;
  let daysElapsedThisWeek = 1;
  let defaultTemplate: ReturnType<typeof getTemplateById>;
  let weeklyExpectations: ReturnType<typeof calculateWeeklyExpectations>;
  let expectedVsActualMetrics: any[] = [];
  let effectiveConfig = quotaConfig || DEFAULT_QUOTA_CONFIG;
  let effectiveTargets = quotaTargets || DEFAULT_QUOTA_TARGETS;
  let commissionSummary: any = { newArrBooked: 0, renewalArrBooked: 0, newArrAttainment: 0, renewalArrAttainment: 0, totalCommission: 0 };
  let combinedAttainment = 0;
  let performanceTargets: any = {};

  try {
    today = new Date();
    todayStr = format(today, 'yyyy-MM-dd');
    isTodayEligible = config && holidays && ptoDays && overrides
      ? isEligibleDay(today, config, holidays, ptoDays, overrides)
      : false;
    const todayEvent = streakEvents?.find(e => e.date === todayStr);
    todayCheckedIn = todayEvent?.checkedIn || todayJournalEntry?.checkedIn || false;
    
    const weekStart = startOfWeek(today, { weekStartsOn: 1 });
    daysElapsedThisWeek = Math.min(5, differenceInBusinessDays(today, weekStart) + 1);
    defaultTemplate = getTemplateById('balanced-pd');
    weeklyExpectations = calculateWeeklyExpectations(defaultTemplate, 5);
    
    expectedVsActualMetrics = wtdMetrics ? calculateExpectedVsActual(
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
    
    effectiveConfig = quotaConfig || DEFAULT_QUOTA_CONFIG;
    effectiveTargets = quotaTargets || DEFAULT_QUOTA_TARGETS;
    const fyStart = effectiveTargets.fiscalYearStart;
    const dateFilter = { start: fyStart, end: format(today, 'yyyy-MM-dd') };
    commissionSummary = calculateCommissionSummary(opportunities, {
      ...effectiveConfig,
      newArrQuota: effectiveTargets.newArrQuota,
      renewalArrQuota: effectiveTargets.renewalArrQuota,
    }, dateFilter);
    
    const totalQuota = (effectiveTargets.newArrQuota || 0) + (effectiveTargets.renewalArrQuota || 0);
    combinedAttainment = totalQuota > 0
      ? (commissionSummary.newArrBooked + commissionSummary.renewalArrBooked) / totalQuota
      : 0;
    
    performanceTargets = {
      dialsPerDay: effectiveTargets.targetDialsPerDay,
      connectsPerDay: effectiveTargets.targetConnectsPerDay,
      meetingsPerWeek: effectiveTargets.targetMeetingsSetPerWeek,
      oppsPerWeek: effectiveTargets.targetOppsCreatedPerWeek,
      customerMeetingsPerWeek: effectiveTargets.targetCustomerMeetingsPerWeek,
      accountsResearchedPerDay: effectiveTargets.targetAccountsResearchedPerDay,
      contactsPreppedPerDay: effectiveTargets.targetContactsPreppedPerDay,
    };
    // calculations complete
  } catch (err) {
    console.error('[Dashboard] calculation crash:', err);
    today = new Date();
    todayStr = format(today, 'yyyy-MM-dd');
    defaultTemplate = getTemplateById('balanced-pd');
    weeklyExpectations = calculateWeeklyExpectations(defaultTemplate, 5);
  }

  const isWidgetVisible = (id: string) => widgets.find(w => w.id === id)?.visible !== false;

  // Render widgets in order
  const renderWidget = (widgetId: string) => {
    switch (widgetId) {
      case 'commission-pacing':
        return (
          <div key={widgetId} className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}>
              <CommissionPacingTile 
                projectedQuarterCommission={commissionPacing?.projectedQuarterCommission || 0}
                weeklyPaceTrend={commissionPacing?.weeklyPaceTrend || 0}
                projectedAttainment={commissionPacing?.projectedAttainment || 0}
                status={commissionPacing?.status || 'stable'}
                isLoading={pacingLoading}
                onClick={() => setShowCommissionDetail(true)}
                compact
              />
            </motion.div>
            {isWidgetVisible('progress-tabs') && (
              <div className="lg:col-span-2">
                <Tabs defaultValue="today" className="w-full">
                  <TabsList className="w-full grid grid-cols-2">
                    <TabsTrigger value="today">Today</TabsTrigger>
                    <TabsTrigger value="wtd">Week-to-Date</TabsTrigger>
                  </TabsList>
                  <TabsContent value="today" className="mt-2">
                    <ExpectedVsActualCard
                      title="Today's Progress"
                      subtitle={todayCheckedIn ? "Checked in" : "Not yet checked in"}
                        metrics={todayJournalEntry ? [
                        {
                          metric: 'Points', expected: 8, actual: todayJournalEntry.dailyScore || 0,
                          gap: 8 - (todayJournalEntry.dailyScore || 0),
                          percentComplete: (todayJournalEntry.dailyScore || 0) / 8,
                          status: (todayJournalEntry.dailyScore || 0) >= 8 ? 'ahead' : (todayJournalEntry.dailyScore || 0) >= 6 ? 'on-track' : 'behind',
                        },
                        {
                          metric: 'Conversations', expected: defaultTemplate.conversations,
                          actual: todayJournalEntry.activity.conversations,
                          gap: defaultTemplate.conversations - todayJournalEntry.activity.conversations,
                          percentComplete: defaultTemplate.conversations > 0 ? todayJournalEntry.activity.conversations / defaultTemplate.conversations : 0,
                          status: todayJournalEntry.activity.conversations >= defaultTemplate.conversations ? 'ahead' : 'behind',
                        },
                        {
                          metric: 'Prospects Added', expected: defaultTemplate.prospectsAdded,
                          actual: todayJournalEntry.activity.prospectsAdded,
                          gap: defaultTemplate.prospectsAdded - todayJournalEntry.activity.prospectsAdded,
                          percentComplete: defaultTemplate.prospectsAdded > 0 ? todayJournalEntry.activity.prospectsAdded / defaultTemplate.prospectsAdded : 0,
                          status: todayJournalEntry.activity.prospectsAdded >= defaultTemplate.prospectsAdded ? 'ahead' : 'behind',
                        },
                      ] : []}
                      pointsEarned={todayJournalEntry?.dailyScore || 0}
                      pointsTarget={8}
                      isLoading={journalLoading}
                      compact
                    />
                  </TabsContent>
                  <TabsContent value="wtd" className="mt-2">
                    <ExpectedVsActualCard
                      title="Week-to-Date"
                      subtitle={`${daysElapsedThisWeek} of 5 workdays`}
                      metrics={expectedVsActualMetrics}
                      pointsEarned={wtdMetrics?.pointsEarned || 0}
                      pointsTarget={8 * daysElapsedThisWeek}
                      isLoading={wtdLoading}
                      compact
                    />
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        );
      case 'progress-tabs':
        return null; // Rendered inside commission-pacing
      case 'smart-work-queue':
        return <SmartWorkQueue key={widgetId} />;
      case 'today-agenda':
        return <TodayAgenda key={widgetId} />;
      case 'meeting-prep':
        return <MeetingPrepCard key={widgetId} />;
      case 'daily-digest':
        return <DailyDigest key={widgetId} />;
      case 'calendar-intelligence':
        return <CalendarIntelligence key={widgetId} />;
      case 'daily-time-blocks':
        return <DailyTimeBlocks key={widgetId} />;
      case 'pclub-math':
        return <PClubMathCard key={widgetId} />;
      case 'weekly-battle-plan':
        return <WeeklyBattlePlanCard key={widgetId} />;
      case 'coaching-feed':
        return <CoachingFeed key={widgetId} />;
      default:
        return null;
    }
  };

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
        {/* Header with meeting count */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-1">
              <Calendar className="h-4 w-4" />
              {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="font-display text-2xl md:text-3xl font-bold">Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <StreakChip />
            <WidgetCustomizer
              widgets={widgets}
              onToggle={toggleWidget}
              onMove={moveWidget}
              onReset={resetWidgets}
            />
          </div>
        </div>
        
        {/* Weekly Review Banner — non-blocking prompt */}
        {!weeklyReviewLoading && !currentWeekReview?.completed && (
          <WidgetErrorBoundary widgetId="weekly-review-banner">
            <WeeklyReviewBanner onOpen={() => setShowWeeklyReview(true)} />
          </WidgetErrorBoundary>
        )}
        
        <WidgetErrorBoundary widgetId="journal-dashboard-card">
          <JournalDashboardCard />
        </WidgetErrorBoundary>
        
        <WidgetErrorBoundary widgetId="meeting-prep-prompt">
          <MeetingPrepPrompt />
        </WidgetErrorBoundary>
        
        <WidgetErrorBoundary widgetId="check-in-banner">
          <CheckInBanner
            checkedIn={todayCheckedIn}
            isEligibleDay={isTodayEligible}
            onStartCheckIn={() => setShowDailyCheckIn(true)}
            onEditCheckIn={() => setShowDailyCheckIn(true)}
            confirmed={todayJournalEntry?.confirmed}
          />
        </WidgetErrorBoundary>
        
        {/* Render widgets in user-defined order, skip null-returning ones */}
        {widgets.filter(w => w.visible).map(w => {
          const content = renderWidget(w.id);
          if (!content) return null;
          return (
            <WidgetErrorBoundary key={`eb-${w.id}`} widgetId={w.id}>
              {content}
            </WidgetErrorBoundary>
          );
        })}
      </div>
      
      <CommissionPacingDetailModal
        open={showCommissionDetail}
        onOpenChange={setShowCommissionDetail}
        projectedCommission={commissionPacing?.projectedQuarterCommission || 0}
        currentCommission={commissionPacing?.currentCommission || 0}
        weeklyPaceTrend={commissionPacing?.weeklyPaceTrend || 0}
        projectedAttainment={commissionPacing?.projectedAttainment || 0}
        benchmarks={{ pace30d: commissionPacing?.pace30d || 0, pace6m: commissionPacing?.pace6m || 0, paceRequired: commissionPacing?.paceRequired || 0 }}
        drivers={commissionPacing?.drivers || []}
        actionPlan={commissionPacing?.actionPlan || []}
        sensitivityAnalysis={commissionPacing?.sensitivityAnalysis || []}
      />
      
      <DailyScorecardModal
        open={showDailyCheckIn}
        onOpenChange={setShowDailyCheckIn}
      />
      
      <WidgetErrorBoundary widgetId="weekly-realignment">
        <WeeklyRealignmentModal
          open={showWeeklyReview}
          onOpenChange={setShowWeeklyReview}
          onComplete={() => setShowWeeklyReview(false)}
        />
      </WidgetErrorBoundary>
    </Layout>
  );
}
