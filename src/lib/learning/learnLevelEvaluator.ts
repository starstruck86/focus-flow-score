/**
 * Skill Level Evaluator — Tier + Micro-Level Model
 *
 * 6 mastery tiers × 5 micro-levels = 30 visible progression levels.
 * Advancement is driven by consistency, pressure score, and first-attempt strength.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { CapabilityProfile } from '@/lib/dojo/v4/capabilityModel';
import { buildCapabilityProfiles } from '@/lib/dojo/v4/capabilityModel';
import {
  getMaxTier,
  getSkillTier,
  MICRO_LEVELS_PER_TIER,
  getOverallLevel,
  type SkillTier,
} from './learnSkillLevels';

// ── Types ──────────────────────────────────────────────────────────

export interface TierThreshold {
  consistency: number;
  firstAttemptStrength: number;
  pressureScore: number | null;
  minReps: number;
}

export interface LevelGap {
  metric: string;
  current: number | null;
  required: number;
  label: string;
}

export interface UserSkillLevel {
  skill: SkillFocus;

  currentTier: number;
  currentTierName: string;

  levelWithinTier: number;
  maxLevelWithinTier: number;

  overallLevel: number;
  progressWithinTier: number;

  nextTier: SkillTier | null;
  gaps: LevelGap[];
  blockers: string[];

  // ── Compat fields (kept for downstream consumers) ──
  /** @deprecated use currentTier */
  currentLevel: number;
  /** @deprecated use currentTierName */
  currentLevelName: string;
  /** @deprecated use nextTier */
  nextLevel: SkillTier | null;
  /** @deprecated use progressWithinTier */
  progressToNext: number;
}

// ── Tier Thresholds ───────────────────────────────────────────────

const TIER_THRESHOLDS: Record<number, TierThreshold> = {
  2: { consistency: 35, firstAttemptStrength: 35, pressureScore: null, minReps: 4 },
  3: { consistency: 48, firstAttemptStrength: 48, pressureScore: 40, minReps: 10 },
  4: { consistency: 62, firstAttemptStrength: 60, pressureScore: 55, minReps: 20 },
  5: { consistency: 75, firstAttemptStrength: 72, pressureScore: 65, minReps: 35 },
  6: { consistency: 85, firstAttemptStrength: 82, pressureScore: 75, minReps: 55 },
};

// ── Core Evaluator ────────────────────────────────────────────────

export function evaluateSkillLevel(
  cap: CapabilityProfile,
  repCount: number,
): UserSkillLevel {
  const skill = cap.skill;
  const maxTier = getMaxTier(skill);
  let achievedTier = 1;

  for (let t = 2; t <= maxTier; t++) {
    const thresh = TIER_THRESHOLDS[t];
    if (!thresh) break;
    if (repCount < thresh.minReps) break;
    if (cap.consistency < thresh.consistency) break;
    if (cap.firstAttemptStrength < thresh.firstAttemptStrength) break;
    if (thresh.pressureScore !== null && (cap.pressureScore ?? 0) < thresh.pressureScore) break;
    achievedTier = t;
  }

  const isMaxTier = achievedTier >= maxTier;
  const nextThresh = TIER_THRESHOLDS[achievedTier + 1];

  // Progress within tier → micro-level
  const progressWithinTier = isMaxTier
    ? 100
    : nextThresh
      ? computeProgress(cap, repCount, nextThresh)
      : 100;

  const levelWithinTier = isMaxTier
    ? MICRO_LEVELS_PER_TIER
    : Math.max(1, Math.min(MICRO_LEVELS_PER_TIER, Math.ceil((progressWithinTier / 100) * MICRO_LEVELS_PER_TIER)));

  const overallLevel = getOverallLevel(achievedTier, levelWithinTier);

  // Gaps
  const gaps: LevelGap[] = [];
  const blockers: string[] = [];
  if (nextThresh) {
    if (cap.consistency < nextThresh.consistency) {
      gaps.push({ metric: 'consistency', current: cap.consistency, required: nextThresh.consistency, label: `Consistency: ${cap.consistency} / ${nextThresh.consistency}` });
      blockers.push('Consistency needs improvement');
    }
    if (cap.firstAttemptStrength < nextThresh.firstAttemptStrength) {
      gaps.push({ metric: 'firstAttemptStrength', current: cap.firstAttemptStrength, required: nextThresh.firstAttemptStrength, label: `First Attempt: ${cap.firstAttemptStrength} / ${nextThresh.firstAttemptStrength}` });
      blockers.push('First-attempt strength too low');
    }
    if (nextThresh.pressureScore !== null && (cap.pressureScore ?? 0) < nextThresh.pressureScore) {
      gaps.push({ metric: 'pressureScore', current: cap.pressureScore, required: nextThresh.pressureScore, label: `Pressure Score: ${cap.pressureScore ?? 0} / ${nextThresh.pressureScore}` });
      blockers.push('Pressure performance needs work');
    }
    if (repCount < nextThresh.minReps) {
      gaps.push({ metric: 'reps', current: repCount, required: nextThresh.minReps, label: `Reps: ${repCount} / ${nextThresh.minReps}` });
      blockers.push('More reps needed');
    }
  }

  const currentTierDef = getSkillTier(skill, achievedTier);
  const nextTierDef = isMaxTier ? null : getSkillTier(skill, achievedTier + 1);

  return {
    skill,
    currentTier: achievedTier,
    currentTierName: currentTierDef?.name ?? `Tier ${achievedTier}`,
    levelWithinTier,
    maxLevelWithinTier: MICRO_LEVELS_PER_TIER,
    overallLevel,
    progressWithinTier,
    nextTier: nextTierDef,
    gaps,
    blockers,
    // Compat
    currentLevel: achievedTier,
    currentLevelName: currentTierDef?.name ?? `Tier ${achievedTier}`,
    nextLevel: nextTierDef,
    progressToNext: progressWithinTier,
  };
}

// ── Batch Evaluator ───────────────────────────────────────────────

export async function evaluateAllSkillLevels(
  userId: string,
): Promise<UserSkillLevel[]> {
  const [caps, repCounts] = await Promise.all([
    buildCapabilityProfiles(userId),
    fetchRepCountsBySkill(userId),
  ]);
  return caps.map(cap => evaluateSkillLevel(cap, repCounts.get(cap.skill) ?? 0));
}

export async function getUserLevel(
  userId: string,
  skill: SkillFocus,
): Promise<UserSkillLevel> {
  const [caps, repCounts] = await Promise.all([
    buildCapabilityProfiles(userId),
    fetchRepCountsBySkill(userId),
  ]);
  const cap = caps.find(c => c.skill === skill);
  if (!cap) {
    return {
      skill,
      currentTier: 1,
      currentTierName: getSkillTier(skill, 1)?.name ?? 'Tier 1',
      levelWithinTier: 1,
      maxLevelWithinTier: MICRO_LEVELS_PER_TIER,
      overallLevel: 1,
      progressWithinTier: 0,
      nextTier: getSkillTier(skill, 2),
      gaps: [],
      blockers: [],
      currentLevel: 1,
      currentLevelName: getSkillTier(skill, 1)?.name ?? 'Tier 1',
      nextLevel: getSkillTier(skill, 2),
      progressToNext: 0,
    };
  }
  return evaluateSkillLevel(cap, repCounts.get(skill) ?? 0);
}

// ── Helpers ───────────────────────────────────────────────────────

function computeProgress(
  cap: CapabilityProfile,
  repCount: number,
  thresh: TierThreshold,
): number {
  const factors: number[] = [];
  factors.push(Math.min(1, cap.consistency / thresh.consistency));
  factors.push(Math.min(1, cap.firstAttemptStrength / thresh.firstAttemptStrength));
  factors.push(Math.min(1, repCount / thresh.minReps));
  if (thresh.pressureScore !== null) {
    factors.push(Math.min(1, (cap.pressureScore ?? 0) / thresh.pressureScore));
  }
  const avg = factors.reduce((a, b) => a + b, 0) / factors.length;
  return Math.round(avg * 100);
}

async function fetchRepCountsBySkill(
  userId: string,
): Promise<Map<SkillFocus, number>> {
  const { supabase } = await import('@/integrations/supabase/client');
  const { data } = await supabase
    .from('dojo_sessions')
    .select('skill_focus')
    .eq('user_id', userId)
    .eq('status', 'completed');

  const counts = new Map<SkillFocus, number>();
  for (const row of data ?? []) {
    const skill = row.skill_focus as SkillFocus;
    counts.set(skill, (counts.get(skill) ?? 0) + 1);
  }
  return counts;
}
