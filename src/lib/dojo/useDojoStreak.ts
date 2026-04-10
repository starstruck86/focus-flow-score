import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SkillFocus } from './scenarios';

export interface DojoStats {
  totalSessions: number;
  lastScore: number | null;
  bestScore: number;
  streak: number;
  skillBreakdown: { skill: SkillFocus; count: number; avgScore: number }[];
}

export function useDojoStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dojo-stats', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<DojoStats> => {
      const { data: sessions, error } = await supabase
        .from('dojo_sessions')
        .select('started_at, best_score, latest_score, status, skill_focus')
        .eq('user_id', user!.id)
        .eq('status', 'completed')
        .order('started_at', { ascending: false })
        .limit(200);

      if (error) throw error;

      const completed = sessions || [];
      const totalSessions = completed.length;
      const lastScore = completed[0]?.latest_score ?? null;
      const bestScore = completed.length > 0
        ? Math.max(...completed.map(s => s.best_score ?? 0))
        : 0;

      // Streak: consecutive days with at least 1 session
      let streak = 0;
      if (completed.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayMs = 86400000;
        const sessionDays = new Set(
          completed.map(s => {
            const d = new Date(s.started_at);
            d.setHours(0, 0, 0, 0);
            return d.getTime();
          })
        );
        let checkDay = today.getTime();
        if (!sessionDays.has(checkDay)) checkDay -= dayMs;
        while (sessionDays.has(checkDay)) {
          streak++;
          checkDay -= dayMs;
        }
      }

      // Skill breakdown for autopilot
      const bySkill = new Map<SkillFocus, { total: number; scoreSum: number }>();
      for (const s of completed) {
        const skill = s.skill_focus as SkillFocus;
        const existing = bySkill.get(skill) || { total: 0, scoreSum: 0 };
        existing.total++;
        existing.scoreSum += s.latest_score ?? 0;
        bySkill.set(skill, existing);
      }
      const skillBreakdown = Array.from(bySkill.entries()).map(([skill, data]) => ({
        skill,
        count: data.total,
        avgScore: Math.round(data.scoreSum / data.total),
      }));

      return { totalSessions, lastScore, bestScore, streak, skillBreakdown };
    },
  });
}
