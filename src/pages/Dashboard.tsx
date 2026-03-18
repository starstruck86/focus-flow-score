// CrossFit-style Dashboard: Walk in → See the WOD → Execute → Score
import { useState } from 'react';
import { motion, Reorder } from 'framer-motion';
import { Calendar, Target, Phone, MessageSquare, Users, TrendingUp, GripVertical } from 'lucide-react';
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
  PostMeetingPrompt,
  ResearchChecklist,
  DailyTimeBlocks,
  SmartWorkQueue,
  CoachingFeed,
  PClubMathCard,
  WeeklyBattlePlanCard,
} from '@/components/dashboard';
import { WidgetErrorBoundary } from '@/components/dashboard/WidgetErrorBoundary';
import { WidgetCustomizer } from '@/components/dashboard/WidgetCustomizer';
import { useWidgetLayout, type WidgetConfig } from '@/hooks/useWidgetLayout';

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

// --- DEFAULT WIDGET DEFINITIONS ---
const DASHBOARD_WIDGETS: WidgetConfig[] = [
  { id: 'daily-time-blocks', label: 'Daily Game Plan', visible: true, order: 0 },
  { id: 'post-meeting', label: 'Post-Meeting Log', visible: true, order: 1 },
  { id: 'meeting-prep', label: 'Upcoming Client Meetings', visible: true, order: 2 },
  { id: 'research-checklist', label: 'Research Checklist', visible: true, order: 3 },
  { id: 'coaching-feed', label: 'AI Coach', visible: true, order: 4 },
  { id: 'progress-tabs', label: 'Today / Week-to-Date', visible: true, order: 5 },
  { id: 'smart-work-queue', label: 'Daily Action Plan', visible: true, order: 6 },
  { id: 'pclub-math', label: 'P-Club Math', visible: true, order: 7 },
  { id: 'weekly-battle-plan', label: 'Weekly Battle Plan', visible: true, order: 8 },
  { id: 'journal', label: 'Daily Scorecard', visible: true, order: 9 },
  { id: 'commission-pacing', label: 'Commission Pacing', visible: true, order: 10 },
];


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

  // Widget layout system
  const { widgets, visibleWidgets, toggleWidget, moveWidget, reorderVisible, resetWidgets } = useWidgetLayout('dashboard', DASHBOARD_WIDGETS);

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

  // Widget renderer
  const renderWidget = (widgetId: string) => {
    switch (widgetId) {
      case 'daily-time-blocks':
        return <DailyTimeBlocks />;
      case 'post-meeting':
        return <PostMeetingPrompt />;
      case 'meeting-prep':
        return <MeetingPrepPrompt />;
      case 'research-checklist':
        return <ResearchChecklist />;
      case 'coaching-feed':
        return <CoachingFeed />;
      case 'progress-tabs':
        return (
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
        );
      case 'smart-work-queue':
        return <SmartWorkQueue />;
      case 'pclub-math':
        return <PClubMathCard />;
      case 'weekly-battle-plan':
        return <WeeklyBattlePlanCard />;
      case 'journal':
        return <JournalDashboardCard />;
      case 'commission-pacing':
        return (
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
        );
      default:
        return null;
    }
  };

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
              <WidgetCustomizer
                widgets={widgets}
                onToggle={toggleWidget}
                onMove={moveWidget}
                onReset={resetWidgets}
              />
              <StreakChip />
            </div>
          </div>
          
          {/* Live Activity Pulse */}
          <ActivityPulse entry={todayJournalEntry} />
        </div>

        {/* Weekly Review Banner — only when needed */}
        {!weeklyReviewLoading && !currentWeekReview?.completed && (
          <WidgetErrorBoundary widgetId="weekly-review-banner">
            <WeeklyReviewBanner onOpen={() => setShowWeeklyReview(true)} />
          </WidgetErrorBoundary>
        )}

        {/* === MODULAR WIDGET GRID — Drag to reorder === */}
        <Reorder.Group
          axis="y"
          values={visibleWidgets}
          onReorder={reorderVisible}
          className="space-y-4"
        >
          {visibleWidgets.map((widget) => (
            <Reorder.Item
              key={widget.id}
              value={widget}
              className="relative group"
              whileDrag={{ scale: 1.02, boxShadow: '0 8px 32px rgba(0,0,0,0.12)', zIndex: 50 }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            >
              <div className="absolute -left-3 top-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing">
                <div className="bg-muted/80 backdrop-blur-sm rounded-md p-1">
                  <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
              <WidgetErrorBoundary widgetId={widget.id}>
                {renderWidget(widget.id)}
              </WidgetErrorBoundary>
            </Reorder.Item>
          ))}
        </Reorder.Group>
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
