/**
 * Sub-Skill Evaluator — Dimension-Driven
 *
 * Evaluates sub-skill progress from structured scoring dimensions.
 * Replaces heuristic string matching with direct dimension reads.
 */

import { supabase } from '@/integrations/supabase/client';
import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { SubSkillProgress, SkillSubSkillSummary } from './learnSubSkillProgress';
import { getSubSkillsForSkill, type SubSkillDefinition } from './learnSubSkillMap';
import { getSkillTier } from './learnSkillLevels';
import { evaluateAllSkillLevels } from './learnLevelEvaluator';
import {
  DIMENSION_TO_SUBSKILL,
  SKILL_DIMENSION_KEYS,
  DIMENSION_LABELS,
} from './learnScoringSchema';

// ── Session signal with structured dimensions ─────────────────────

interface SessionSignal {
  skill: SkillFocus;
  score: number;
  pressureLevel: string | null;
  topMistakes: string[];
  dimensions: Record<string, number> | null;
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

    // Extract dimensions from score_json
    let dimensions: Record<string, number> | null = null;
    if (turn?.scoreJson && typeof turn.scoreJson === 'object') {
      const sj = turn.scoreJson as Record<string, unknown>;
      if (sj.dimensions && typeof sj.dimensions === 'object') {
        dimensions = sj.dimensions as Record<string, number>;
      }
    }

    return {
      skill: s.skill_focus as SkillFocus,
      score: s.latest_score ?? 0,
      pressureLevel: s.pressure_level,
      topMistakes: mistakes,
      dimensions,
    };
  });
}

// ── Core evaluation — dimension-driven ────────────────────────────

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

  // Find dimensions that map to this sub-skill
  const relevantDimKeys: string[] = [];
  const allDimKeys = SKILL_DIMENSION_KEYS[def.skill] || [];
  for (const dimKey of allDimKeys) {
    if (DIMENSION_TO_SUBSKILL[dimKey] === def.name) {
      relevantDimKeys.push(dimKey);
    }
  }

  // Collect dimension scores across sessions
  const dimScores: number[] = [];
  const allSessionScores: number[] = [];

  for (const s of skillSignals) {
    allSessionScores.push(s.score);

    if (s.dimensions && relevantDimKeys.length > 0) {
      for (const dk of relevantDimKeys) {
        const val = s.dimensions[dk];
        if (typeof val === 'number') {
          dimScores.push(val * 10); // 0-10 → 0-100
        }
      }
    }
  }

  // Primary scoring: use dimension data if available, fallback to session score heuristic
  let rawScore: number;

  if (dimScores.length >= 3) {
    // Enough dimension data: use direct average
    rawScore = Math.round(dimScores.reduce((a, b) => a + b, 0) / dimScores.length);
  } else if (dimScores.length > 0) {
    // Some dimension data: blend with session average
    const dimAvg = dimScores.reduce((a, b) => a + b, 0) / dimScores.length;
    const sessionAvg = allSessionScores.reduce((a, b) => a + b, 0) / allSessionScores.length;
    rawScore = Math.round(dimAvg * 0.7 + sessionAvg * 0.3);
  } else {
    // No dimension data: fallback to mistake-based heuristic
    const sessionAvg = allSessionScores.reduce((a, b) => a + b, 0) / allSessionScores.length;
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
    rawScore = Math.round(Math.max(0, Math.min(100, sessionAvg - mistakePenalty)));
  }

  // Consistency from dimension scores or session scores
  const scoresForConsistency = dimScores.length >= 3 ? dimScores : allSessionScores;
  const mean = scoresForConsistency.reduce((a, b) => a + b, 0) / scoresForConsistency.length;
  const variance = scoresForConsistency.reduce((sum, s) => sum + (s - mean) ** 2, 0) / scoresForConsistency.length;
  const stdDev = Math.sqrt(variance);
  const consistency = Math.round(Math.max(0, Math.min(100, 100 - stdDev * 2)));

  // Pressure score
  const pressuredSignals = skillSignals.filter(s =>
    s.pressureLevel && s.pressureLevel !== 'none'
  );
  let pressureScore: number | null = null;
  if (pressuredSignals.length >= 2) {
    // Prefer dimension-based pressure scoring
    const pressureDimScores: number[] = [];
    for (const s of pressuredSignals) {
      if (s.dimensions && relevantDimKeys.length > 0) {
        for (const dk of relevantDimKeys) {
          const val = s.dimensions[dk];
          if (typeof val === 'number') pressureDimScores.push(val * 10);
        }
      }
    }
    pressureScore = pressureDimScores.length >= 2
      ? Math.round(pressureDimScores.reduce((a, b) => a + b, 0) / pressureDimScores.length)
      : Math.round(pressuredSignals.reduce((a, b) => a + b.score, 0) / pressuredSignals.length);
  }

  // Band
  const effectiveScore = rawScore * 0.6 + consistency * 0.4;
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

/**
 * Get the latest dimension scores for a user/skill from recent sessions.
 * Used by the feedback card to show dimension-level improvements.
 */
export async function getLatestDimensions(
  userId: string,
  skill: SkillFocus,
  sessionCount = 5,
): Promise<{ dimensions: Record<string, number>; sessionCount: number }> {
  const signals = await fetchRecentSignals(userId, skill);
  const recent = signals.slice(0, sessionCount);

  const dimAccum: Record<string, { total: number; count: number }> = {};

  for (const s of recent) {
    if (!s.dimensions) continue;
    for (const [key, val] of Object.entries(s.dimensions)) {
      if (typeof val !== 'number') continue;
      if (!dimAccum[key]) dimAccum[key] = { total: 0, count: 0 };
      dimAccum[key].total += val;
      dimAccum[key].count++;
    }
  }

  const dimensions: Record<string, number> = {};
  for (const [key, acc] of Object.entries(dimAccum)) {
    dimensions[key] = Math.round((acc.total / acc.count) * 10); // 0-10 → 0-100
  }

  return { dimensions, sessionCount: recent.filter(s => s.dimensions != null).length };
}
