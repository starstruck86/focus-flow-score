/**
 * useSubSkillProgress — React hook for sub-skill evaluation.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { evaluateAllSubSkills } from '@/lib/learning/learnSubSkillEvaluator';

export function useSubSkillProgress() {
  return useQuery({
    queryKey: ['sub-skill-progress'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      return evaluateAllSubSkills(user.id);
    },
    staleTime: 5 * 60_000,
  });
}
