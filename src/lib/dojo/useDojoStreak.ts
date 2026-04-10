import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useDojoStats() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ['dojo-stats', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data: sessions, error } = await supabase
        .from('dojo_sessions')
        .select('started_at, best_score, latest_score, status')
        .eq('user_id', user!.id)
        .eq('status', 'completed')
        .order('started_at', { ascending: false })
        .limit(100);

      if (error) throw error;

      const totalSessions = sessions?.length || 0;
      const lastScore = sessions?.[0]?.latest_score ?? null;
      const bestScore = Math.max(...(sessions?.map(s => s.best_score ?? 0) || [0]));

      // Calculate streak (consecutive days with at least 1 session)
      let streak = 0;
      if (sessions && sessions.length > 0) {
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
        // If no session today, start from yesterday
        if (!sessionDays.has(checkDay)) {
          checkDay -= dayMs;
        }
        while (sessionDays.has(checkDay)) {
          streak++;
          checkDay -= dayMs;
        }
      }

      return { totalSessions, lastScore, bestScore, streak };
    },
  });
}
