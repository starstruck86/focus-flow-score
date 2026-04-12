/**
 * Hook: useDailyKI
 *
 * Resolves today's DailyAssignment KI IDs into full KnowledgeItem rows.
 * Used by Learn to render the daily KI-backed lesson card.
 *
 * Architecture rule: Learn reads from the same DailyAssignment that Dojo uses.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getOrCreateTodayAssignment } from '@/lib/dojo/v3/assignmentManager';
import type { KnowledgeItem } from './useKnowledgeItems';

export interface DailyKIContext {
  kiIds: string[];
  items: KnowledgeItem[];
  anchor: string;
  focusPattern: string;
  reason: string;
  /** Pass-through for direct Learn → Dojo session handoff */
  assignmentDbId: string | null;
  assignmentScenario: any | null;
  benchmarkTag: boolean;
  scenarioFamilyId: string | null;
}

export function useDailyKI() {
  const { user } = useAuth();

  return useQuery<DailyKIContext | null>({
    queryKey: ['daily-ki', user?.id, new Date().toISOString().split('T')[0]],
    enabled: !!user?.id,
    staleTime: 30 * 60 * 1000,
    queryFn: async () => {
      if (!user) return null;

      const assignment = await getOrCreateTodayAssignment(user.id);
      if (!assignment || !assignment.kis || assignment.kis.length === 0) return null;

      // Resolve KI IDs to full rows
      const { data } = await supabase
        .from('knowledge_items' as any)
        .select('*')
        .in('id', assignment.kis);

      return {
        kiIds: assignment.kis,
        items: (data ?? []) as unknown as KnowledgeItem[],
        anchor: assignment.dayAnchor,
        focusPattern: assignment.focusPattern,
        reason: assignment.reason,
        assignmentDbId: assignment._dbId ?? null,
        assignmentScenario: assignment.scenarios[0]?.scenario ?? null,
        benchmarkTag: assignment.benchmarkTag ?? false,
        scenarioFamilyId: assignment.scenarioFamilyId ?? null,
      };
    },
  });
}
