/**
 * Hook to fetch all skill levels for the current user.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { evaluateAllSkillLevels } from '@/lib/learning/learnLevelEvaluator';

export function useSkillLevels() {
  return useQuery({
    queryKey: ['skill-levels'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return evaluateAllSkillLevels(user.id);
    },
    staleTime: 5 * 60 * 1000,
  });
}
