/**
 * Skill Level Evaluator
 *
 * Determines user level based on real performance from the capability model.
 * Advancement is driven by consistency, pressure score, and pattern success —
 * NOT by lessons completed.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { CapabilityProfile } from '@/lib/dojo/v4/capabilityModel';
import { buildCapabilityProfiles } from '@/lib/dojo/v4/capabilityModel';
import { getMaxLevel, getSkillLevel, type SkillLevel } from './learnSkillLevels';

// ── Types ──────────────────────────────────────────────────────────

export interface LevelThresholds {
  /** Minimum consistency score (0–100) */
  consistency: number;
  /** Minimum first-attempt strength */
  firstAttemptStrength: number;
  /** Minimum pressure score (null = not required) */
  pressureScore: number | null;
  /** Minimum reps needed before this level is reachable */
  minReps: number;
}

export interface UserSkillLevel {
  skill: SkillFocus;
  currentLevel: number;
  currentLevelName: string;
  nextLevel: SkillLevel | null;
  /** What's blocking advancement to the next level */
  gaps: LevelGap[];
  /** 0–100 progress toward the next level */
  progressToNext: number;
}

export interface LevelGap {
  metric: string;
  current: number | null;
  required: number;
  label: string;
}

// ── Level Thresholds ──────────────────────────────────────────────
//
// Each entry defines what the user MUST achieve to BE at that level.
// Level 1 is the default — no thresholds needed.

const LEVEL_THRESHOLDS: Record<number, LevelThresholds> = {
  2: {
    consistency: 45,
    firstAttemptStrength: 45,
    pressureScore: null,
    minReps: 5,
  },
  3: {
    consistency: 60,
    firstAttemptStrength: 60,
    pressureScore: 50,
    minReps: 12,
  },
  4: {
    consistency: 72,
    firstAttemptStrength: 70,
    pressureScore: 60,
    minReps: 25,
  },
  5: {
    consistency: 82,
    firstAttemptStrength: 78,
    pressureScore: 70,
    minReps: 40,
  },
};

// ── Core Evaluator ────────────────────────────────────────────────

/**
 * Evaluate a user's level for a single skill from a pre-built capability profile.
 */
export function evaluateSkillLevel(
  cap: CapabilityProfile,
  repCount: number,
): UserSkillLevel {
  const skill = cap.skill;
  const maxLevel = getMaxLevel(skill);
  let achievedLevel = 1;

  // Walk up through levels, stopping when thresholds aren't met
  for (let lvl = 2; lvl <= maxLevel; lvl++) {
    const thresh = LEVEL_THRESHOLDS[lvl];
    if (!thresh) break;

    if (repCount < thresh.minReps) break;
    if (cap.consistency < thresh.consistency) break;
    if (cap.firstAttemptStrength < thresh.firstAttemptStrength) break;
    if (thresh.pressureScore !== null && (cap.pressureScore ?? 0) < thresh.pressureScore) break;

    achievedLevel = lvl;
  }

  const currentLevelDef = getSkillLevel(skill, achievedLevel);
  const nextLevelDef = achievedLevel < maxLevel ? getSkillLevel(skill, achievedLevel + 1) : null;

  // Compute gaps to next level
  const gaps: LevelGap[] = [];
  const nextThresh = LEVEL_THRESHOLDS[achievedLevel + 1];

  if (nextThresh) {
    if (cap.consistency < nextThresh.consistency) {
      gaps.push({
        metric: 'consistency',
        current: cap.consistency,
        required: nextThresh.consistency,
        label: `Consistency: ${cap.consistency} / ${nextThresh.consistency}`,
      });
    }
    if (cap.firstAttemptStrength < nextThresh.firstAttemptStrength) {
      gaps.push({
        metric: 'firstAttemptStrength',
        current: cap.firstAttemptStrength,
        required: nextThresh.firstAttemptStrength,
        label: `First Attempt: ${cap.firstAttemptStrength} / ${nextThresh.firstAttemptStrength}`,
      });
    }
    if (nextThresh.pressureScore !== null && (cap.pressureScore ?? 0) < nextThresh.pressureScore) {
      gaps.push({
        metric: 'pressureScore',
        current: cap.pressureScore,
        required: nextThresh.pressureScore,
        label: `Pressure Score: ${cap.pressureScore ?? 0} / ${nextThresh.pressureScore}`,
      });
    }
    if (repCount < nextThresh.minReps) {
      gaps.push({
        metric: 'reps',
        current: repCount,
        required: nextThresh.minReps,
        label: `Reps: ${repCount} / ${nextThresh.minReps}`,
      });
    }
  }

  // Progress to next level (0-100)
  const progressToNext = nextThresh
    ? computeProgress(cap, repCount, nextThresh)
    : 100;

  return {
    skill,
    currentLevel: achievedLevel,
    currentLevelName: currentLevelDef?.name ?? `Level ${achievedLevel}`,
    nextLevel: nextLevelDef,
    gaps,
    progressToNext,
  };
}

// ── Batch Evaluator ───────────────────────────────────────────────

/**
 * Evaluate all skill levels for a user. Fetches capability profiles automatically.
 */
export async function evaluateAllSkillLevels(
  userId: string,
): Promise<UserSkillLevel[]> {
  const [caps, repCounts] = await Promise.all([
    buildCapabilityProfiles(userId),
    fetchRepCountsBySkill(userId),
  ]);

  return caps.map(cap =>
    evaluateSkillLevel(cap, repCounts.get(cap.skill) ?? 0),
  );
}

/**
 * Get a single skill level for a user.
 */
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
      currentLevel: 1,
      currentLevelName: getSkillLevel(skill, 1)?.name ?? 'Level 1',
      nextLevel: getSkillLevel(skill, 2),
      gaps: [],
      progressToNext: 0,
    };
  }

  return evaluateSkillLevel(cap, repCounts.get(skill) ?? 0);
}

// ── Helpers ───────────────────────────────────────────────────────

function computeProgress(
  cap: CapabilityProfile,
  repCount: number,
  thresh: LevelThresholds,
): number {
  const factors: number[] = [];

  // Each factor: how far toward threshold (clamped 0–1)
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
