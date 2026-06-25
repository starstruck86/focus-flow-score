import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { getSubLevels } from '@/lib/train/curriculum';
import type {
  SubLevelGroup,
  UserBandGateRow,
  UserCompetencyRow,
} from '@/types/train';

export interface LadderData {
  groups: SubLevelGroup[];
  competency: Record<string, UserCompetencyRow>; // key: sub_level
  gates: Record<number, UserBandGateRow>;        // key: band
}

export function useSubLevelLadder(spoke: string, topic: string) {
  const { user } = useAuth();
  return useQuery<LadderData>({
    queryKey: ['train', 'ladder', spoke, topic, user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const groups = await getSubLevels(spoke, topic);

      const [{ data: compRows }, { data: gateRows }] = await Promise.all([
        (supabase as any)
          .from('user_competency')
          .select('*')
          .eq('user_id', user!.id)
          .eq('spoke', spoke)
          .eq('topic', topic),
        (supabase as any)
          .from('user_band_gate')
          .select('*')
          .eq('user_id', user!.id)
          .eq('spoke', spoke)
          .eq('topic', topic),
      ]);

      const competency: Record<string, UserCompetencyRow> = {};
      for (const r of (compRows as UserCompetencyRow[]) ?? []) {
        competency[r.sub_level] = r;
      }
      const gates: Record<number, UserBandGateRow> = {};
      for (const r of (gateRows as UserBandGateRow[]) ?? []) {
        gates[r.band] = r;
      }
      return { groups, competency, gates };
    },
  });
}
