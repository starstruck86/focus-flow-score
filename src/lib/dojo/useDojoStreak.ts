import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import type { SkillFocus, SkillStat } from './scenarios';

export type { SkillStat };

export interface DojoStats {
  totalSessions: number;
  lastScore: number | null;
  bestScore: number;
  streak: number;
  skillBreakdown: SkillStat[];
}

export function useDojoStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dojo-stats', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<DojoStats> => {
      const [sessionsRes, turnsRes] = await Promise.all([
        supabase
          .from('dojo_sessions')
          .select('id, started_at, best_score, latest_score, status, skill_focus')
          .eq('user_id', user!.id)
          .eq('status', 'completed')
          .order('started_at', { ascending: false })
          .limit(200),
        supabase
          .from('dojo_session_turns')
          .select('session_id, score, turn_index, created_at')
          .eq('user_id', user!.id)
          .eq('turn_index', 0)
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      if (sessionsRes.error) throw sessionsRes.error;
      if (turnsRes.error) throw turnsRes.error;

      const sessions = sessionsRes.data || [];
      const firstAttemptTurns = turnsRes.data || [];

      const totalSessions = sessions.length;
      const lastScore = sessions[0]?.latest_score ?? null;
      const bestScore = sessions.length > 0
        ? Math.max(...sessions.map(s => s.best_score ?? 0))
        : 0;

      // Streak
      let streak = 0;
      if (sessions.length > 0) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const dayMs = 86400000;
        const sessionDays = new Set(
          sessions.map(s => {
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

      // Build skill breakdown with first-attempt data
      const bySkill = new Map<SkillFocus, {
        total: number;
        scoreSum: number;
        firstAttemptScores: number[];
      }>();

      const sessionIdToSkill = new Map<string, SkillFocus>();
      for (const s of sessions) {
        const skill = s.skill_focus as SkillFocus;
        sessionIdToSkill.set(s.id, skill);
        if (!bySkill.has(skill)) {
          bySkill.set(skill, { total: 0, scoreSum: 0, firstAttemptScores: [] });
        }
        const entry = bySkill.get(skill)!;
        entry.total++;
        entry.scoreSum += s.latest_score ?? 0;
      }

      for (const turn of firstAttemptTurns) {
        const skill = sessionIdToSkill.get(turn.session_id);
        if (skill && bySkill.has(skill) && turn.score != null) {
          bySkill.get(skill)!.firstAttemptScores.push(turn.score);
        }
      }

      const skillBreakdown: SkillStat[] = Array.from(bySkill.entries()).map(([skill, data]) => {
        const recentFirst = data.firstAttemptScores.slice(0, 10);
        return {
          skill,
          count: data.total,
          avgScore: Math.round(data.scoreSum / data.total),
          avgFirstAttempt: recentFirst.length > 0
            ? Math.round(recentFirst.reduce((a, b) => a + b, 0) / recentFirst.length)
            : 0,
          recentFirstAttempts: recentFirst,
        };
      });

      return { totalSessions, lastScore, bestScore, streak, skillBreakdown };
    },
  });
}
