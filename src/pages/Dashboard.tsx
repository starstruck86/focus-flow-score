// CrossFit-style Dashboard: Walk in → See the WOD → Execute → Score
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, Calendar } from 'lucide-react';
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
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import {
  CommissionPacingTile,
  CommissionPacingDetailModal,
  MeetingPrepPrompt,
  DailyTimeBlocks,
  SmartWorkQueue,
  CoachingFeed,
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
  const { data: todayJournalEntry } = useTodayJournalEntry();
  const { data: commissionPacing, isLoading: pacingLoading } = useCommissionPacing();

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');
  const todayEvent = streakEvents?.find(e => e.date === todayStr);
  const todayCheckedIn = todayEvent?.checkedIn || todayJournalEntry?.checkedIn || false;
  const currentHour = today.getHours();

  return (
    <Layout>
      <div className="p-4 md:p-6 lg:p-8 max-w-7xl mx-auto space-y-4">
        {/* === THE WHITEBOARD: Walk in, see the date and your status === */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 text-muted-foreground text-sm mb-0.5">
              <Calendar className="h-3.5 w-3.5" />
              {today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            </div>
            <h1 className="font-display text-xl md:text-2xl font-bold flex items-center gap-2">
              {getGreeting()}
              <span className="text-muted-foreground font-normal text-base">
                — {getMotivation(todayCheckedIn, currentHour)}
              </span>
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <StreakChip />
            {/* Commission scoreboard - compact */}
            <CommissionPacingTile
              projectedQuarterCommission={commissionPacing?.projectedQuarterCommission || 0}
              weeklyPaceTrend={commissionPacing?.weeklyPaceTrend || 0}
              projectedAttainment={commissionPacing?.projectedAttainment || 0}
              status={commissionPacing?.status || 'stable'}
              isLoading={pacingLoading}
              onClick={() => setShowCommissionDetail(true)}
              compact
            />
          </div>
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
        <WidgetErrorBoundary widgetId="meeting-prep-prompt">
          <MeetingPrepPrompt />
        </WidgetErrorBoundary>

        {/* === SECTION 3: COACH — Alerts, risks, wins === */}
        <WidgetErrorBoundary widgetId="coaching-feed">
          <CoachingFeed />
        </WidgetErrorBoundary>

        {/* === SECTION 4: ACTION LIST — What to work on between meetings === */}
        <WidgetErrorBoundary widgetId="smart-work-queue">
          <SmartWorkQueue />
        </WidgetErrorBoundary>

        {/* === SECTION 5: SCORECARD — Your daily journal === */}
        <WidgetErrorBoundary widgetId="journal-dashboard-card">
          <JournalDashboardCard />
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
