/**
 * Pattern Memory — tracks what the rep repeatedly misses and where they improve.
 * Reads from dojo_session_turns score_json to build aggregate pattern data.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from './scenarios';
import type {
  PatternMemory,
  PatternMemoryEntry,
  CoachingInsights,
  DojoScoreResult,
} from './types';

/** Build pattern memory from recent session turns */
export async function buildPatternMemory(userId: string): Promise<PatternMemory> {
  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('score, turn_index, score_json, retry_of_turn_id, session_id, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(500);

  const { data: sessions } = await supabase
    .from('dojo_sessions')
    .select('id, skill_focus')
    .eq('user_id', userId)
    .limit(500);

  const sessionSkillMap = new Map<string, SkillFocus>();
  for (const s of sessions ?? []) {
    sessionSkillMap.set(s.id, s.skill_focus as SkillFocus);
  }

  const mistakeCounts = new Map<string, { count: number; lastSeen: string }>();
  const focusPatternCounts = new Map<string, { count: number; lastSeen: string }>();
  const patternTagCounts = new Map<string, { count: number; lastSeen: string }>();
  const retrySuccessByFocus: Record<string, { attempts: number; successes: number }> = {};
  const scoresBySkill: Record<string, { firstAttempts: number[]; retryScores: number[] }> = {};

  for (const turn of turns ?? []) {
    const sj = turn.score_json as Record<string, unknown> | null;
    if (!sj) continue;

    const skill = sessionSkillMap.get(turn.session_id) ?? 'objection_handling';
    if (!scoresBySkill[skill]) scoresBySkill[skill] = { firstAttempts: [], retryScores: [] };

    if (turn.turn_index === 0) {
      if (typeof turn.score === 'number') scoresBySkill[skill].firstAttempts.push(turn.score);
    } else {
      if (typeof turn.score === 'number') scoresBySkill[skill].retryScores.push(turn.score);
    }

    // Track mistakes (first attempts only for pattern detection)
    if (turn.turn_index === 0 && typeof sj.topMistake === 'string' && sj.topMistake) {
      const existing = mistakeCounts.get(sj.topMistake);
      if (existing) {
        existing.count++;
        if (turn.created_at > existing.lastSeen) existing.lastSeen = turn.created_at;
      } else {
        mistakeCounts.set(sj.topMistake, { count: 1, lastSeen: turn.created_at });
      }
    }

    // Track focus patterns assigned
    if (typeof sj.focusPattern === 'string' && sj.focusPattern) {
      const existing = focusPatternCounts.get(sj.focusPattern);
      if (existing) {
        existing.count++;
        if (turn.created_at > existing.lastSeen) existing.lastSeen = turn.created_at;
      } else {
        focusPatternCounts.set(sj.focusPattern, { count: 1, lastSeen: turn.created_at });
      }
    }

    // Track pattern tags from world-class answers
    if (Array.isArray(sj.patternTags)) {
      for (const tag of sj.patternTags) {
        if (typeof tag !== 'string') continue;
        const existing = patternTagCounts.get(tag);
        if (existing) {
          existing.count++;
        } else {
          patternTagCounts.set(tag, { count: 1, lastSeen: turn.created_at });
        }
      }
    }

    // Track retry success by focus pattern
    if (turn.turn_index > 0 && typeof sj.focusApplied === 'string' && typeof sj.focusPattern === 'string') {
      const fp = sj.focusPattern as string;
      if (!retrySuccessByFocus[fp]) retrySuccessByFocus[fp] = { attempts: 0, successes: 0 };
      retrySuccessByFocus[fp].attempts++;
      if (sj.focusApplied === 'yes') retrySuccessByFocus[fp].successes++;
    }
  }

  const toSorted = (m: Map<string, { count: number; lastSeen: string }>): PatternMemoryEntry[] =>
    Array.from(m.entries())
      .map(([pattern, { count, lastSeen }]) => ({ pattern, count, lastSeen }))
      .sort((a, b) => b.count - a.count);

  return {
    commonMistakes: toSorted(mistakeCounts),
    commonFocusPatterns: toSorted(focusPatternCounts),
    commonPatternTags: toSorted(patternTagCounts),
    retrySuccessRateByFocus: retrySuccessByFocus,
    scoreImprovementBySkill: scoresBySkill,
  };
}

/** Derive coaching insights from pattern memory */
export function deriveCoachingInsights(memory: PatternMemory): CoachingInsights {
  const topMistake = memory.commonMistakes[0];
  const whatYouMissMost = topMistake
    ? `${topMistake.pattern.replace(/_/g, ' ')} (${topMistake.count} times)`
    : 'Not enough data yet.';

  // Find focus pattern with highest retry success rate
  let bestFocus = '';
  let bestRate = 0;
  for (const [focus, data] of Object.entries(memory.retrySuccessRateByFocus)) {
    if (data.attempts >= 2) {
      const rate = data.successes / data.attempts;
      if (rate > bestRate) { bestRate = rate; bestFocus = focus; }
    }
  }
  const whatYouImproveFastest = bestFocus
    ? `${bestFocus.replace(/_/g, ' ')} (${Math.round(bestRate * 100)}% retry success)`
    : 'Not enough retry data yet.';

  // Find focus pattern with lowest retry success rate
  let worstFocus = '';
  let worstRate = 1;
  for (const [focus, data] of Object.entries(memory.retrySuccessRateByFocus)) {
    if (data.attempts >= 2) {
      const rate = data.successes / data.attempts;
      if (rate < worstRate) { worstRate = rate; worstFocus = focus; }
    }
  }
  const whereRetriesStick = worstFocus
    ? `${worstFocus.replace(/_/g, ' ')} (${Math.round(worstRate * 100)}% success — needs more reps)`
    : 'Not enough retry data yet.';

  // What Dave wants next: most common mistake that has low retry success
  const whatDaveWantsNext = topMistake
    ? `Keep drilling ${topMistake.pattern.replace(/_/g, ' ')} until it becomes instinct.`
    : 'Get more reps in to build a pattern.';

  return { whatYouMissMost, whatYouImproveFastest, whereRetriesStick, whatDaveWantsNext };
}
