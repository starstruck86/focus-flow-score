/**
 * useLearnLoop — Hook for Learn V6 Phase 1–3 data
 *
 * Fetches: mental model, last rep insights, reinforcement queue,
 * skill memory, pressure breakdown, multi-thread miss, decay, transfer signal.
 * All derived from real Dojo data.
 */

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/contexts/AuthContext';
import { useDailyKI } from '@/hooks/useDailyKI';
import { buildSkillMemory, type SkillMemory } from '@/lib/dojo/skillMemory';
import {
  buildMentalModel,
  getLastRepInsights,
  getReinforcementQueue,
  type MentalModel,
  type LastRepInsight,
  type ReinforcementItem,
} from '@/lib/learning/learnEngine';
import {
  getPressureBreakdown,
  getRecentMultiThreadMiss,
  getReinforcementDecay,
  getTransferSignal,
  type PressureBreakdown,
  type MultiThreadMiss,
  type DecayItem,
  type TransferSignal,
} from '@/lib/learning/learnAdaptationEngine';

export interface LearnLoopData {
  mentalModel: MentalModel | null;
  lastRep: LastRepInsight | null;
  reinforcement: ReinforcementItem[];
  topMistake: string | null;
  skillMemory: SkillMemory | null;
  // Phase 3
  pressureBreakdown: PressureBreakdown | null;
  multiThreadMiss: MultiThreadMiss | null;
  decayItems: DecayItem[];
  transferSignal: TransferSignal | null;
}

export function useLearnLoop() {
  const { user } = useAuth();
  const { data: dailyKI } = useDailyKI();

  return useQuery<LearnLoopData>({
    queryKey: ['learn-loop', user?.id, dailyKI?.anchor],
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      if (!user) return {
        mentalModel: null, lastRep: null, reinforcement: [], topMistake: null,
        skillMemory: null, pressureBreakdown: null, multiThreadMiss: null,
        decayItems: [], transferSignal: null,
      };

      const [skillMemory, lastRep, reinforcement, pressureBreakdown, multiThreadMiss, decayItems, transferSignal] = await Promise.all([
        buildSkillMemory(user.id),
        getLastRepInsights(user.id),
        getReinforcementQueue(user.id),
        getPressureBreakdown(user.id),
        getRecentMultiThreadMiss(user.id),
        getReinforcementDecay(user.id),
        getTransferSignal(user.id),
      ]);

      let mentalModel: MentalModel | null = null;
      let topMistake: string | null = null;

      if (dailyKI) {
        mentalModel = buildMentalModel(dailyKI, skillMemory);

        const anchorSkillMap: Record<string, string> = {
          monday: 'objection_handling',
          tuesday: 'discovery',
          wednesday: 'objection_handling',
          thursday: 'deal_control',
          friday: 'executive_response',
        };
        const targetSkill = anchorSkillMap[dailyKI.anchor] ?? 'objection_handling';
        const profile = skillMemory.profiles.find(p => p.skill === targetSkill);
        topMistake = profile?.topMistakes[0]?.mistake ?? null;
      }

      return {
        mentalModel, lastRep, reinforcement, topMistake, skillMemory,
        pressureBreakdown, multiThreadMiss, decayItems, transferSignal,
      };
    },
  });
}
