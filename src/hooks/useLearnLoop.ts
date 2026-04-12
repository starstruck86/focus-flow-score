/**
 * useLearnLoop — Hook for Learn V6 Phase 1–4 data
 *
 * Fetches: mental model, last rep insights, reinforcement queue,
 * skill memory, pressure breakdown, multi-thread miss, decay, transfer signal,
 * weekly coaching plan, friday readiness, block remediation.
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
import {
  getWeeklyCoachingPlan,
  getFridayReadiness,
  getBlockRemediationPlan,
  type WeeklyCoachingPlan,
  type FridayReadiness,
  type BlockRemediation,
} from '@/lib/learning/learnWeeklyEngine';
import {
  getAdaptiveStudyPath,
  type AdaptiveStudyPath,
} from '@/lib/learning/learnPathEngine';
import {
  getPrimaryLearnAction,
  type LearnPrimaryAction,
} from '@/lib/learning/learnActionEngine';

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
  // Phase 4
  weeklyPlan: WeeklyCoachingPlan | null;
  fridayReadiness: FridayReadiness | null;
  blockRemediation: BlockRemediation | null;
  // Phase 5
  adaptiveStudyPath: AdaptiveStudyPath | null;
  // Phase 6
  primaryAction: LearnPrimaryAction | null;
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
        weeklyPlan: null, fridayReadiness: null, blockRemediation: null,
        adaptiveStudyPath: null, primaryAction: null,
      };

      const [
        skillMemory, lastRep, reinforcement,
        pressureBreakdown, multiThreadMiss, decayItems, transferSignal,
        weeklyPlan, fridayReadiness, blockRemediation,
        adaptiveStudyPath, primaryAction,
      ] = await Promise.all([
        buildSkillMemory(user.id),
        getLastRepInsights(user.id),
        getReinforcementQueue(user.id),
        getPressureBreakdown(user.id),
        getRecentMultiThreadMiss(user.id),
        getReinforcementDecay(user.id),
        getTransferSignal(user.id),
        getWeeklyCoachingPlan(user.id),
        getFridayReadiness(user.id),
        getBlockRemediationPlan(user.id),
        getAdaptiveStudyPath(user.id),
        getPrimaryLearnAction(user.id),
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
        weeklyPlan, fridayReadiness, blockRemediation,
        adaptiveStudyPath, primaryAction,
      };
    },
  });
}
