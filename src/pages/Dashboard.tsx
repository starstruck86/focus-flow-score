// CrossFit-style Dashboard: Walk in → See the WOD → Execute → Score
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, Target, Phone, MessageSquare, Users, TrendingUp } from 'lucide-react';
import { StreakChip } from '@/components/StreakChip';
import { Layout } from '@/components/Layout';
import { DailyScorecardModal, JournalDashboardCard } from '@/components/journal';
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
import { useCommissionPacing } from '@/hooks/useCommissionPacing';
import { useQuotaTargets } from '@/hooks/useSalesAge';
import { useWeekToDateMetrics, calculateExpectedVsActual } from '@/hooks/useGoodDayMetrics';
import { getTemplateById, calculateWeeklyExpectations } from '@/lib/goodDayModel';
import { DEFAULT_QUOTA_TARGETS } from '@/lib/salesAgeCalculations';
import { format, differenceInBusinessDays, startOfWeek } from 'date-fns';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  CommissionPacingTile,
  CommissionPacingDetailModal,
  ExpectedVsActualCard,
  MeetingPrepPrompt,
  DailyTimeBlocks,
  SmartWorkQueue,
  CoachingFeed,
  PClubMathCard,
  WeeklyBattlePlanCard,
} from '@/components/dashboard';
import { WidgetErrorBoundary } from '@/components/dashboard/WidgetErrorBoundary';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getMotivation(checkedIn: boolean, hour: number): string {
  if (hour < 10 && !checkedIn) return "Let's get after it.";
  if (hour < 12) return 'Execution mode.';
  if (hour < 15) return 'Stay in the zone.';
  if (hour < 17) return 'Strong finish ahead.';
  return 'Close it out.';
}

// --- Live Activity Pulse: always-visible "how am I doing right now" ---
function ActivityPulse({ entry }: { entry: any }) {
  const metrics = [
    { label: 'Dials', value: entry?.dials || 0, icon: Phone, target: 25 },
    { label: 'Convos', value: entry?.activity?.conversations || entry?.conversations || 0, icon: MessageSquare, target: 3 },
    { label: 'Meetings', value: entry?.activity?.customerMeetingsHeld || entry?.customerMeetingsHeld || 0, icon: Users, target: 2 },
    { label: 'Opps', value: entry?.activity?.opportunitiesCreated || entry?.opportunitiesCreated || 0, icon: TrendingUp, target: 1 },
  ];

  const score = entry?.dailyScore || 0;
  const goalMet = score >= 8;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      {/* Score chip */}
      <div className={cn(
        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border",
        goalMet 
          ? "bg-status-green/10 text-status-green border-status-green/30" 
          : score >= 5 
            ? "bg-status-yellow/10 text-status-yellow border-status-yellow/30"
            : "bg-muted text-muted-foreground border-border"
      )}>
        <Target className="h-3 w-3" />
        {score}/8 pts
      </div>
      
      {/* Activity chips */}
      {metrics.map(m => {
        const hit = m.value >= m.target;
        const Icon = m.icon;
        return (
          <div
            key={m.label}
            className={cn(
              "flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium",
              hit ? "bg-status-green/10 text-status-green" : "bg-muted/50 text-muted-foreground"
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            <span className="font-mono">{m.value}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function Dashboard() {
  const [showDailyCheckIn, setShowDailyCheckIn] = useState(false);
  const [showCommissionDetail, setShowCommissionDetail] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const { data: currentWeekReview, isLoading: weeklyReviewLoading } = useCurrentWeekReview();
  
  const { data: config } = useWorkScheduleConfig();
  const { data: holidays } = useHolidays();
  const { data: ptoDays } = usePtoDays();
  const { data: overrides } = useWorkdayOverrides();
  const { data: streakEvents } = useStreakEvents();
  const { data: todayJournalEntry, isLoading: journalLoading } = useTodayJournalEntry();
  const { data: commissionPacing, isLoading: pacingLoading } = useCommissionPacing();
  const { data: quotaTargets } = useQuotaTargets();
  const { data: wtdMetrics, isLoading: wtdLoading } = useWeekToDateMetrics();

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const todayEvent = streakEvents?.find(e => e.date === todayStr);
  const todayCheckedIn = todayEvent?.checkedIn || todayJournalEntry?.checkedIn || false;
  const currentHour = today.getHours();

  // Week-to-date calculations
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  const daysElapsedThisWeek = Math.min(5, differenceInBusinessDays(today, weekStart) + 1);
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

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
        {/* === THE WHITEBOARD === */}
        <div className="space-y-2">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2 text-muted-foreground text-sm mb-0.5">
                <Calendar className="h-3.5 w-3.5" />
                {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <h1 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
                {getGreeting()}
                <span className="text-muted-foreground font-normal text-base hidden sm:inline">
                  — {getMotivation(todayCheckedIn, currentHour)}
                </span>
              </h1>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <StreakChip />
            </div>
          </div>
          
          {/* Live Activity Pulse — always know where you stand */}
          <ActivityPulse entry={todayJournalEntry} />
        </div>

        {/* Weekly Review Banner — only when needed */}
        {!weeklyReviewLoading && !currentWeekReview?.completed && (
          <WidgetErrorBoundary widgetId="weekly-review-banner">
            <WeeklyReviewBanner onOpen={() => setShowWeeklyReview(true)} />
          </WidgetErrorBoundary>
        )}

        {/* === SECTION 1: THE WOD — Your Game Plan === */}
        <WidgetErrorBoundary widgetId="daily-time-blocks">
          <DailyTimeBlocks />
        </WidgetErrorBoundary>

        {/* === SECTION 2: WHAT'S NEXT — Imminent meetings needing prep === */}
        <div id="meeting-prep-section">
        <WidgetErrorBoundary widgetId="meeting-prep-prompt">
          <MeetingPrepPrompt />
        </WidgetErrorBoundary>
        </div>

        {/* === SECTION 3: COACH + ACCOUNTABILITY === */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WidgetErrorBoundary widgetId="coaching-feed">
            <CoachingFeed />
          </WidgetErrorBoundary>
          
          <WidgetErrorBoundary widgetId="progress">
            <Tabs defaultValue="today" className="w-full">
              <TabsList className="w-full grid grid-cols-2">
                <TabsTrigger value="today">Today</TabsTrigger>
                <TabsTrigger value="wtd">Week-to-Date</TabsTrigger>
              </TabsList>
              <TabsContent value="today" className="mt-2">
                <ExpectedVsActualCard
                  title="Today's Progress"
                  subtitle={todayCheckedIn ? "Checked in ✓" : "Not yet checked in"}
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
          </WidgetErrorBoundary>
        </div>

        {/* === SECTION 4: ACTION LIST — What to work on === */}
        <WidgetErrorBoundary widgetId="smart-work-queue">
          <SmartWorkQueue />
        </WidgetErrorBoundary>

        {/* === SECTION 5: STRATEGIC CONTEXT — P-Club Math + Battle Plan === */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <WidgetErrorBoundary widgetId="pclub-math">
            <PClubMathCard />
          </WidgetErrorBoundary>
          <WidgetErrorBoundary widgetId="weekly-battle-plan">
            <WeeklyBattlePlanCard />
          </WidgetErrorBoundary>
        </div>

        {/* === SECTION 6: SCORECARD — Daily Journal === */}
        <WidgetErrorBoundary widgetId="journal-dashboard-card">
          <JournalDashboardCard />
        </WidgetErrorBoundary>
        
        {/* === COMMISSION PACING — Compact at bottom === */}
        <WidgetErrorBoundary widgetId="commission-pacing">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
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
        </WidgetErrorBoundary>
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
