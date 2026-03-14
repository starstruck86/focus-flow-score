import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface PersonalRecords {
  // Activity records
  mostDialsInDay: number;
  mostConversationsInDay: number;
  mostMeetingsSetInDay: number;
  mostOppsCreatedInDay: number;
  bestDailyScore: number;
  bestProductivity: number;
  // Streak records (from streak_summary)
  longestCheckinStreak: number;
  longestPerformanceStreak: number;
  // Pipeline records
  biggestDealClosed: number;
  // Meta
  totalDaysTracked: number;
  memberSince: string | null;
  bestWeekAvgScore: number;
}

export function usePerformanceProfile() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['performance-profile', user?.id],
    queryFn: async (): Promise<PersonalRecords> => {
      // Fetch journal entries, streak summary, and biggest deal in parallel
      const [journalRes, streakRes, oppRes] = await Promise.all([
        supabase
          .from('daily_journal_entries')
          .select('date, dials, conversations, meetings_set, opportunities_created, daily_score, sales_productivity, created_at')
          .order('date', { ascending: true }),
        supabase
          .from('streak_summary')
          .select('longest_checkin_streak, longest_performance_streak')
          .limit(1)
          .maybeSingle(),
        supabase
          .from('opportunities')
          .select('arr')
          .eq('status', 'won')
          .order('arr', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const entries = journalRes.data || [];
      const streak = streakRes.data;
      const biggestDeal = oppRes.data;

      let mostDials = 0, mostConvos = 0, mostMeetings = 0, mostOpps = 0;
      let bestScore = 0, bestProd = 0;
      let memberSince: string | null = null;

      // Calculate weekly averages for best week
      const weekScores: Record<string, { total: number; count: number }> = {};

      for (const e of entries) {
        if (!memberSince) memberSince = e.created_at;
        mostDials = Math.max(mostDials, e.dials || 0);
        mostConvos = Math.max(mostConvos, e.conversations || 0);
        mostMeetings = Math.max(mostMeetings, e.meetings_set || 0);
        mostOpps = Math.max(mostOpps, e.opportunities_created || 0);
        bestScore = Math.max(bestScore, e.daily_score || 0);
        bestProd = Math.max(bestProd, e.sales_productivity || 0);

        // Group by ISO week
        const d = new Date(e.date);
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay() + 1);
        const weekKey = weekStart.toISOString().slice(0, 10);
        if (!weekScores[weekKey]) weekScores[weekKey] = { total: 0, count: 0 };
        weekScores[weekKey].total += (e.daily_score || 0);
        weekScores[weekKey].count += 1;
      }

      let bestWeekAvg = 0;
      for (const w of Object.values(weekScores)) {
        if (w.count >= 3) { // At least 3 days to count
          const avg = w.total / w.count;
          bestWeekAvg = Math.max(bestWeekAvg, avg);
        }
      }

      return {
        mostDialsInDay: mostDials,
        mostConversationsInDay: mostConvos,
        mostMeetingsSetInDay: mostMeetings,
        mostOppsCreatedInDay: mostOpps,
        bestDailyScore: bestScore,
        bestProductivity: bestProd,
        longestCheckinStreak: streak?.longest_checkin_streak || 0,
        longestPerformanceStreak: streak?.longest_performance_streak || 0,
        biggestDealClosed: biggestDeal?.arr || 0,
        totalDaysTracked: entries.length,
        memberSince,
        bestWeekAvgScore: Math.round(bestWeekAvg * 10) / 10,
      };
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}
