/**
 * Sub-Skill Evaluator
 *
 * Evaluates sub-skill progress from real Dojo performance data.
 * Maps session/turn mistakes and scores to sub-skill signals.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { SubSkillProgress, SkillSubSkillSummary } from './learnSubSkillProgress';
import { getSubSkillsForSkill, type SubSkillDefinition } from './learnSubSkillMap';
import { getSkillTier } from './learnSkillLevels';
import { evaluateAllSkillLevels } from './learnLevelEvaluator';

// ── Pattern → Sub-skill signal extraction ─────────────────────────

interface SessionSignal {
  skill: SkillFocus;
  score: number;
  pressureLevel: string | null;
  topMistakes: string[];
  scoreJson: Record<string, number> | null;
}

async function fetchRecentSignals(
  userId: string,
  skill?: SkillFocus,
): Promise<SessionSignal[]> {
  let query = supabase
    .from('dojo_sessions')
    .select('id, skill_focus, latest_score, pressure_level')
    .eq('user_id', userId)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(100);

  if (skill) query = query.eq('skill_focus', skill);

  const { data: sessions } = await query;
  if (!sessions || sessions.length === 0) return [];

  const sessionIds = sessions.map(s => s.id);

  const { data: turns } = await supabase
    .from('dojo_session_turns')
    .select('session_id, score, top_mistake, score_json, turn_index')
    .eq('user_id', userId)
    .in('session_id', sessionIds)
    .eq('turn_index', 0);

  const turnMap = new Map<string, { topMistake: string | null; scoreJson: unknown }>();
  for (const t of turns ?? []) {
    turnMap.set(t.session_id, { topMistake: t.top_mistake, scoreJson: t.score_json });
  }

  return sessions.map(s => {
    const turn = turnMap.get(s.id);
    const mistakes: string[] = [];
    if (turn?.topMistake) mistakes.push(turn.topMistake);
    return {
      skill: s.skill_focus as SkillFocus,
      score: s.latest_score ?? 0,
      pressureLevel: s.pressure_level,
      topMistakes: mistakes,
      scoreJson: (turn?.scoreJson as Record<string, number>) ?? null,
    };
  });
}

// ── Core evaluation ───────────────────────────────────────────────

/**
 * Heuristic: each sub-skill gets a score based on:
 * - Base = average session score for that skill (as proxy)
 * - Penalty if top_mistake patterns overlap with this sub-skill's patterns
 * - Pressure adjustment if the sub-skill involves pressure patterns
 */
function evaluateSubSkill(
  def: SubSkillDefinition,
  signals: SessionSignal[],
  nextTierPatterns: string[],
): SubSkillProgress {
  const skillSignals = signals.filter(s => s.skill === def.skill);

  if (skillSignals.length === 0) {
    return {
      skill: def.skill,
      subSkill: def.name,
      score: 0,
      consistency: 0,
      pressureScore: null,
      progressBand: 'weak',
      relatedPatterns: def.patterns,
      relatedConcepts: def.concepts,
      blockerForNextTier: nextTierPatterns.some(p => def.patterns.includes(p)),
      blockerReason: nextTierPatterns.some(p => def.patterns.includes(p))
        ? `No data yet for ${def.name}`
        : null,
    };
  }

  // Base score from session scores
  const scores = skillSignals.map(s => s.score);
  const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

  // Mistake penalty: how often this sub-skill's patterns appear as top_mistake
  const mistakePatterns = new Set(def.patterns.map(p => p.toLowerCase()));
  let mistakeHits = 0;
  for (const s of skillSignals) {
    for (const m of s.topMistakes) {
      const normalized = m.toLowerCase().replace(/[\s-]/g, '_');
      if (mistakePatterns.has(normalized) || def.patterns.some(p =>
        normalized.includes(p.replace(/_/g, '')) || p.includes(normalized.replace(/_/g, ''))
      )) {
        mistakeHits++;
      }
    }
  }
  const mistakePenalty = Math.min(25, (mistakeHits / skillSignals.length) * 40);

  // Score JSON bonus: check if sub-skill dimensions appear and are scored
  let dimensionBonus = 0;
  let dimensionCount = 0;
  for (const s of skillSignals) {
    if (s.scoreJson) {
      for (const key of Object.keys(s.scoreJson)) {
        const normalizedKey = key.toLowerCase().replace(/[\s-]/g, '_');
        if (def.patterns.some(p => normalizedKey.includes(p) || p.includes(normalizedKey))) {
          dimensionBonus += (s.scoreJson[key] ?? 0);
          dimensionCount++;
        }
      }
    }
  }
  const dimAvg = dimensionCount > 0 ? (dimensionBonus / dimensionCount) * 10 : 0;

  // Final score
  const rawScore = Math.round(
    Math.min(100, Math.max(0, avgScore - mistakePenalty + dimAvg * 0.3))
  );

  // Consistency = std dev based
  const mean = avgScore;
  const variance = scores.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  const consistency = Math.round(Math.max(0, Math.min(100, 100 - stdDev * 2)));

  // Pressure score
  const pressuredSignals = skillSignals.filter(s =>
    s.pressureLevel && s.pressureLevel !== 'none'
  );
  const pressureScore = pressuredSignals.length >= 2
    ? Math.round(pressuredSignals.reduce((a, b) => a + b.score, 0) / pressuredSignals.length)
    : null;

  // Band
  const effectiveScore = (rawScore * 0.6 + consistency * 0.4);
  const progressBand: SubSkillProgress['progressBand'] =
    effectiveScore >= 65 ? 'strong' : effectiveScore >= 40 ? 'building' : 'weak';

  // Blocker check
  const isBlocker = progressBand !== 'strong' &&
    nextTierPatterns.some(p => def.patterns.includes(p));

  return {
    skill: def.skill,
    subSkill: def.name,
    score: rawScore,
    consistency,
    pressureScore,
    progressBand,
    relatedPatterns: def.patterns,
    relatedConcepts: def.concepts,
    blockerForNextTier: isBlocker,
    blockerReason: isBlocker
      ? `${def.name} is not strong enough for the next tier`
      : null,
  };
}

// ── Public API ────────────────────────────────────────────────────

export async function evaluateSubSkillsForSkill(
  userId: string,
  skill: SkillFocus,
): Promise<SkillSubSkillSummary> {
  const defs = getSubSkillsForSkill(skill);
  const signals = await fetchRecentSignals(userId, skill);

  // Get next tier required patterns
  const levels = await evaluateAllSkillLevels(userId);
  const level = levels.find(l => l.skill === skill);
  const nextTierDef = level ? getSkillTier(skill, level.currentTier + 1) : null;
  const nextTierPatterns = nextTierDef?.requiredPatterns ?? [];

  const subSkills = defs.map(d => evaluateSubSkill(d, signals, nextTierPatterns));

  const sorted = [...subSkills].sort((a, b) => a.score - b.score);
  const weakest = sorted.filter(s => s.progressBand === 'weak').map(s => s.subSkill);
  const strongest = sorted.filter(s => s.progressBand === 'strong').map(s => s.subSkill).reverse();

  return {
    skill,
    subSkills,
    strongestSubSkills: strongest.slice(0, 3),
    weakestSubSkills: weakest.slice(0, 3),
    blockersForNextTier: subSkills.filter(s => s.blockerForNextTier).map(s => s.subSkill),
  };
}

export async function evaluateAllSubSkills(
  userId: string,
): Promise<SkillSubSkillSummary[]> {
  const skills: SkillFocus[] = [
    'discovery', 'objection_handling', 'deal_control', 'executive_response', 'qualification',
  ];
  return Promise.all(skills.map(s => evaluateSubSkillsForSkill(userId, s)));
}
