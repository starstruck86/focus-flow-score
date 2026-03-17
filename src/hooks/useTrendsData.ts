import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, subDays, startOfWeek, endOfWeek, eachDayOfInterval, isWeekend } from 'date-fns';

export type TrendRange = '7d' | '14d' | '30d' | '90d';

export interface DayMetric {
  date: string;
  dayLabel: string;
  dials: number;
  conversations: number;
  prospectsAdded: number;
  meetingsSet: number;
  customerMeetingsHeld: number;
  opportunitiesCreated: number;
  prospectingBlockMinutes: number;
  accountDeepWorkMinutes: number;
  accountsResearched: number;
  contactsPrepped: number;
  dailyScore: number | null;
  goalMet: boolean;
  sentimentScore: number | null;
  sentimentLabel: string | null;
  pipelineMoved: number | null;
  recovery: number | null;
  sleep: number | null;
  strain: number | null;
  focusScore: number | null;
  distractedMinutes: number | null;
  workdayStartTime: string | null;
  firstCallTime: string | null;
}

export interface WeekAggregate {
  weekLabel: string;
  weekStart: string;
  dials: number;
  conversations: number;
  meetingsSet: number;
  meetingsHeld: number;
  oppsCreated: number;
  avgScore: number | null;
  goalMetDays: number;
  totalDays: number;
  avgRecovery: number | null;
  pipelineMoved: number;
}

export function useTrendsData(range: TrendRange) {
  const { user } = useAuth();
  const days = range === '7d' ? 7 : range === '14d' ? 14 : range === '30d' ? 30 : 90;
  const startDate = format(subDays(new Date(), days), 'yyyy-MM-dd');
  const endDate = format(new Date(), 'yyyy-MM-dd');

  return useQuery({
    queryKey: ['trends-data', range, user?.id],
    queryFn: async () => {
      // Fetch journal entries
      const { data: entries, error } = await supabase
        .from('daily_journal_entries')
        .select('date, dials, conversations, prospects_added, meetings_set, customer_meetings_held, opportunities_created, prospecting_block_minutes, account_deep_work_minutes, accounts_researched, contacts_prepped, daily_score, goal_met, sentiment_score, sentiment_label, pipeline_moved, focus_score, distracted_minutes, workday_start_time, first_call_time')
        .gte('date', startDate)
        .lte('date', endDate)
        .eq('checked_in', true)
        .order('date');

      if (error) throw error;

      // Fetch WHOOP data
      const dates = (entries || []).map(e => e.date);
      let whoopMap: Record<string, { recovery: number | null; sleep: number | null; strain: number | null }> = {};
      
      if (dates.length > 0) {
        const { data: whoop } = await supabase
          .from('whoop_daily_metrics')
          .select('date, recovery_score, sleep_score, strain_score')
          .in('date', dates);
        
        (whoop || []).forEach((w: any) => {
          whoopMap[w.date] = {
            recovery: w.recovery_score,
            sleep: w.sleep_score,
            strain: w.strain_score,
          };
        });
      }

      const dailyMetrics: DayMetric[] = (entries || []).map((e: any) => ({
        date: e.date,
        dayLabel: format(new Date(e.date + 'T12:00:00'), 'EEE M/d'),
        dials: e.dials || 0,
        conversations: e.conversations || 0,
        prospectsAdded: e.prospects_added || 0,
        meetingsSet: e.meetings_set || 0,
        customerMeetingsHeld: e.customer_meetings_held || 0,
        opportunitiesCreated: e.opportunities_created || 0,
        prospectingBlockMinutes: e.prospecting_block_minutes || 0,
        accountDeepWorkMinutes: e.account_deep_work_minutes || 0,
        accountsResearched: e.accounts_researched || 0,
        contactsPrepped: e.contacts_prepped || 0,
        dailyScore: e.daily_score,
        goalMet: e.goal_met || false,
        sentimentScore: e.sentiment_score,
        sentimentLabel: e.sentiment_label,
        pipelineMoved: e.pipeline_moved,
        recovery: whoopMap[e.date]?.recovery ?? null,
        sleep: whoopMap[e.date]?.sleep ?? null,
        strain: whoopMap[e.date]?.strain ?? null,
        focusScore: e.focus_score,
        distractedMinutes: e.distracted_minutes,
        workdayStartTime: e.workday_start_time,
        firstCallTime: e.first_call_time,
      }));

      // Aggregate by week
      const weekMap = new Map<string, DayMetric[]>();
      dailyMetrics.forEach(d => {
        const ws = format(startOfWeek(new Date(d.date + 'T12:00:00'), { weekStartsOn: 1 }), 'yyyy-MM-dd');
        if (!weekMap.has(ws)) weekMap.set(ws, []);
        weekMap.get(ws)!.push(d);
      });

      const weeklyAggregates: WeekAggregate[] = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([ws, days]) => {
          const we = format(endOfWeek(new Date(ws + 'T12:00:00'), { weekStartsOn: 1 }), 'M/d');
          const wsLabel = format(new Date(ws + 'T12:00:00'), 'M/d');
          const scores = days.filter(d => d.dailyScore != null).map(d => d.dailyScore!);
          const recoveries = days.filter(d => d.recovery != null).map(d => d.recovery!);
          return {
            weekLabel: `${wsLabel}–${we}`,
            weekStart: ws,
            dials: days.reduce((s, d) => s + d.dials, 0),
            conversations: days.reduce((s, d) => s + d.conversations, 0),
            meetingsSet: days.reduce((s, d) => s + d.meetingsSet, 0),
            meetingsHeld: days.reduce((s, d) => s + d.customerMeetingsHeld, 0),
            oppsCreated: days.reduce((s, d) => s + d.opportunitiesCreated, 0),
            avgScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 10) / 10 : null,
            goalMetDays: days.filter(d => d.goalMet).length,
            totalDays: days.length,
            avgRecovery: recoveries.length ? Math.round(recoveries.reduce((a, b) => a + b, 0) / recoveries.length) : null,
            pipelineMoved: days.reduce((s, d) => s + (d.pipelineMoved || 0), 0),
          };
        });

      // Compute correlations
      const correlations = computeCorrelations(dailyMetrics);

      // Conversion funnel
      const totalDials = dailyMetrics.reduce((s, d) => s + d.dials, 0);
      const totalConvos = dailyMetrics.reduce((s, d) => s + d.conversations, 0);
      const totalMeetings = dailyMetrics.reduce((s, d) => s + d.meetingsSet, 0);
      const totalOpps = dailyMetrics.reduce((s, d) => s + d.opportunitiesCreated, 0);

      const funnel = {
        dials: totalDials,
        conversations: totalConvos,
        meetingsSet: totalMeetings,
        oppsCreated: totalOpps,
        dialToConversation: totalDials > 0 ? Math.round((totalConvos / totalDials) * 1000) / 10 : 0,
        conversationToMeeting: totalConvos > 0 ? Math.round((totalMeetings / totalConvos) * 1000) / 10 : 0,
        meetingToOpp: totalMeetings > 0 ? Math.round((totalOpps / totalMeetings) * 1000) / 10 : 0,
      };

      return { dailyMetrics, weeklyAggregates, correlations, funnel };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

interface Correlation {
  label: string;
  description: string;
  strength: 'strong' | 'moderate' | 'weak';
  direction: 'positive' | 'negative';
  emoji: string;
}

function computeCorrelations(metrics: DayMetric[]): Correlation[] {
  if (metrics.length < 5) return [];
  const results: Correlation[] = [];

  // Prospecting block → conversations
  const withBlock = metrics.filter(m => m.prospectingBlockMinutes >= 30);
  const withoutBlock = metrics.filter(m => m.prospectingBlockMinutes < 30);
  if (withBlock.length >= 3 && withoutBlock.length >= 3) {
    const avgWith = withBlock.reduce((s, m) => s + m.conversations, 0) / withBlock.length;
    const avgWithout = withoutBlock.reduce((s, m) => s + m.conversations, 0) / withoutBlock.length;
    if (avgWith > avgWithout * 1.2) {
      const pct = Math.round(((avgWith - avgWithout) / Math.max(avgWithout, 1)) * 100);
      results.push({
        label: 'Prospecting Block → Conversations',
        description: `Days with 30+ min prospecting blocks average ${pct}% more conversations (${avgWith.toFixed(1)} vs ${avgWithout.toFixed(1)}).`,
        strength: pct > 40 ? 'strong' : pct > 20 ? 'moderate' : 'weak',
        direction: 'positive',
        emoji: '📞',
      });
    }
  }

  // Recovery → goal met
  const highRecovery = metrics.filter(m => m.recovery != null && m.recovery >= 60);
  const lowRecovery = metrics.filter(m => m.recovery != null && m.recovery < 50);
  if (highRecovery.length >= 3 && lowRecovery.length >= 3) {
    const highGoalRate = highRecovery.filter(m => m.goalMet).length / highRecovery.length;
    const lowGoalRate = lowRecovery.filter(m => m.goalMet).length / lowRecovery.length;
    if (highGoalRate > lowGoalRate + 0.15) {
      results.push({
        label: 'Recovery → Goal Achievement',
        description: `High recovery (60%+) days: ${Math.round(highGoalRate * 100)}% goals met vs ${Math.round(lowGoalRate * 100)}% on low recovery days.`,
        strength: highGoalRate - lowGoalRate > 0.3 ? 'strong' : 'moderate',
        direction: 'positive',
        emoji: '💚',
      });
    }
  }

  // Focus score → daily score
  const withFocus = metrics.filter(m => m.focusScore != null && m.focusScore >= 7);
  const lowFocus = metrics.filter(m => m.focusScore != null && m.focusScore < 5);
  if (withFocus.length >= 3 && lowFocus.length >= 3) {
    const avgHighFocus = withFocus.filter(m => m.dailyScore != null).reduce((s, m) => s + m.dailyScore!, 0) / withFocus.length;
    const avgLowFocus = lowFocus.filter(m => m.dailyScore != null).reduce((s, m) => s + m.dailyScore!, 0) / lowFocus.length;
    if (avgHighFocus > avgLowFocus + 1) {
      results.push({
        label: 'Phone Focus → Daily Score',
        description: `High focus days average ${avgHighFocus.toFixed(1)} pts vs ${avgLowFocus.toFixed(1)} pts on distracted days.`,
        strength: avgHighFocus - avgLowFocus > 2 ? 'strong' : 'moderate',
        direction: 'positive',
        emoji: '📱',
      });
    }
  }

  // Day of week analysis
  const dayPerf: Record<number, { goals: number; total: number }> = {};
  metrics.forEach(m => {
    const dow = new Date(m.date + 'T12:00:00').getDay();
    if (!dayPerf[dow]) dayPerf[dow] = { goals: 0, total: 0 };
    dayPerf[dow].total++;
    if (m.goalMet) dayPerf[dow].goals++;
  });
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const ranked = Object.entries(dayPerf)
    .filter(([, v]) => v.total >= 2)
    .sort((a, b) => (b[1].goals / b[1].total) - (a[1].goals / a[1].total));
  if (ranked.length >= 2) {
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];
    const bestRate = Math.round((best[1].goals / best[1].total) * 100);
    const worstRate = Math.round((worst[1].goals / worst[1].total) * 100);
    if (bestRate - worstRate >= 20) {
      results.push({
        label: 'Best vs Worst Day',
        description: `${dayNames[+best[0]]}s are your strongest (${bestRate}% goal rate) vs ${dayNames[+worst[0]]}s (${worstRate}%).`,
        strength: bestRate - worstRate > 40 ? 'strong' : 'moderate',
        direction: 'positive',
        emoji: '📅',
      });
    }
  }

  // Sentiment → performance
  const positive = metrics.filter(m => m.sentimentScore != null && m.sentimentScore > 0.3);
  const negative = metrics.filter(m => m.sentimentScore != null && m.sentimentScore < -0.3);
  if (positive.length >= 2 && negative.length >= 2) {
    const posGoalRate = positive.filter(m => m.goalMet).length / positive.length;
    const negGoalRate = negative.filter(m => m.goalMet).length / negative.length;
    if (posGoalRate > negGoalRate + 0.15) {
      results.push({
        label: 'Mindset → Performance',
        description: `Positive mindset days: ${Math.round(posGoalRate * 100)}% goal-met vs ${Math.round(negGoalRate * 100)}% on negative days.`,
        strength: posGoalRate - negGoalRate > 0.3 ? 'strong' : 'moderate',
        direction: 'positive',
        emoji: '🧠',
      });
    }
  }

  return results;
}
