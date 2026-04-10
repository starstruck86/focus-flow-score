/**
 * Strict Dojo V2 type definitions.
 * Single source of truth for all scoring, session, and pattern-memory types.
 */

import type { SkillFocus } from './scenarios';

// ── Scoring Result ─────────────────────────────────────────────────

/** Focus application assessment — only present on retry results */
export type FocusAppliedStatus = 'yes' | 'partial' | 'no';

/** Retry outcome classification — derived in UI from score delta + focusApplied */
export type RetryOutcome = 'breakthrough' | 'improved' | 'partial' | 'no_real_change';

/** Session type for Dojo */
export type DojoSessionType = 'drill' | 'roleplay' | 'review';

/** Full scoring result from the dojo-score edge function */
export interface DojoScoreResult {
  // ── Always present ──
  score: number;
  feedback: string;
  topMistake: string;
  improvedVersion: string;

  // ── Teaching layer (always returned, may be empty strings/arrays) ──
  worldClassResponse: string;
  whyItWorks: string[];
  moveSequence: string[];
  patternTags: string[];
  focusPattern: string;
  focusReason: string;
  practiceCue: string;
  teachingNote: string;
  deltaNote: string;

  // ── Retry-only fields (only present when retryCount > 0) ──
  focusApplied?: FocusAppliedStatus;
  focusAppliedReason?: string;
}

// ── Retry Assessment (derived client-side) ─────────────────────────

export interface RetryAssessment {
  retryOutcome: RetryOutcome;
  liveReady: boolean;
  liveReadyReason: string;
  scoreDelta: number;
  whatImprovedMost: string;
  whatStillNeedsWork: string;
}

/**
 * Derive retry assessment from first-attempt and retry results.
 */
export function deriveRetryAssessment(
  first: DojoScoreResult,
  retry: DojoScoreResult
): RetryAssessment {
  const scoreDelta = retry.score - first.score;
  const focusApplied = retry.focusApplied ?? 'no';

  let retryOutcome: RetryOutcome;
  if (scoreDelta >= 15 && focusApplied === 'yes') {
    retryOutcome = 'breakthrough';
  } else if (scoreDelta >= 8 || (scoreDelta >= 5 && focusApplied === 'yes')) {
    retryOutcome = 'improved';
  } else if (scoreDelta > 0 || focusApplied === 'partial') {
    retryOutcome = 'partial';
  } else {
    retryOutcome = 'no_real_change';
  }

  const liveReady = retry.score >= 75 && focusApplied !== 'no';
  let liveReadyReason: string;
  if (liveReady) {
    liveReadyReason = 'This response is strong enough to use in a real conversation.';
  } else if (retry.score >= 70) {
    liveReadyReason = 'Close to usable — tighten the focus area and it\'s ready.';
  } else {
    liveReadyReason = 'Not ready for a real call yet — keep drilling.';
  }

  // Derive what improved / what still needs work from feedback
  const whatImprovedMost = retry.focusAppliedReason && focusApplied !== 'no'
    ? retry.focusAppliedReason
    : scoreDelta > 0 ? 'Score improved but specific gains unclear.' : 'No meaningful improvement detected.';

  const whatStillNeedsWork = retry.topMistake !== first.topMistake
    ? `New issue surfaced: ${retry.topMistake.replace(/_/g, ' ')}.`
    : `Still struggling with: ${retry.topMistake.replace(/_/g, ' ')}.`;

  return {
    retryOutcome,
    liveReady,
    liveReadyReason,
    scoreDelta,
    whatImprovedMost,
    whatStillNeedsWork,
  };
}

// ── Retry Outcome labels ───────────────────────────────────────────

export const RETRY_OUTCOME_LABELS: Record<RetryOutcome, string> = {
  breakthrough: 'Breakthrough',
  improved: 'Improved',
  partial: 'Partial Improvement',
  no_real_change: 'No Real Change',
};

export const RETRY_OUTCOME_COLORS: Record<RetryOutcome, string> = {
  breakthrough: 'text-green-600 dark:text-green-400',
  improved: 'text-blue-600 dark:text-blue-400',
  partial: 'text-amber-600 dark:text-amber-400',
  no_real_change: 'text-red-600 dark:text-red-400',
};

// ── Pattern Memory ─────────────────────────────────────────────────

export interface PatternMemoryEntry {
  pattern: string;
  count: number;
  lastSeen: string;
}

export interface PatternMemory {
  commonMistakes: PatternMemoryEntry[];
  commonFocusPatterns: PatternMemoryEntry[];
  commonPatternTags: PatternMemoryEntry[];
  retrySuccessRateByFocus: Record<string, { attempts: number; successes: number }>;
  scoreImprovementBySkill: Record<string, { firstAttempts: number[]; retryScores: number[] }>;
}

export interface CoachingInsights {
  whatYouMissMost: string;
  whatYouImproveFastest: string;
  whereRetriesStick: string;
  whatDaveWantsNext: string;
}

// ── Safe field access helpers ──────────────────────────────────────

/** Normalize raw edge function response to strict DojoScoreResult */
export function normalizeScoreResult(raw: Record<string, unknown>): DojoScoreResult {
  return {
    score: typeof raw.score === 'number' ? raw.score : 0,
    feedback: typeof raw.feedback === 'string' ? raw.feedback : '',
    topMistake: typeof raw.topMistake === 'string' ? raw.topMistake : '',
    improvedVersion: typeof raw.improvedVersion === 'string' ? raw.improvedVersion : '',
    worldClassResponse: typeof raw.worldClassResponse === 'string' ? raw.worldClassResponse : '',
    whyItWorks: Array.isArray(raw.whyItWorks) ? raw.whyItWorks.filter((x): x is string => typeof x === 'string') : [],
    moveSequence: Array.isArray(raw.moveSequence) ? raw.moveSequence.filter((x): x is string => typeof x === 'string') : [],
    patternTags: Array.isArray(raw.patternTags) ? raw.patternTags.filter((x): x is string => typeof x === 'string') : [],
    focusPattern: typeof raw.focusPattern === 'string' ? raw.focusPattern : '',
    focusReason: typeof raw.focusReason === 'string' ? raw.focusReason : '',
    practiceCue: typeof raw.practiceCue === 'string' ? raw.practiceCue : '',
    teachingNote: typeof raw.teachingNote === 'string' ? raw.teachingNote : '',
    deltaNote: typeof raw.deltaNote === 'string' ? raw.deltaNote : '',
    focusApplied: raw.focusApplied === 'yes' || raw.focusApplied === 'partial' || raw.focusApplied === 'no'
      ? raw.focusApplied : undefined,
    focusAppliedReason: typeof raw.focusAppliedReason === 'string' ? raw.focusAppliedReason : undefined,
  };
}
