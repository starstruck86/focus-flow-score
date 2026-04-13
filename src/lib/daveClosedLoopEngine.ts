/**
 * Dave Closed-Loop Coaching Engine
 *
 * Manages the teach → test → verify → decide loop.
 * Dave selects a concept/sub-skill, sends the user into a targeted rep,
 * verifies whether the focus was actually applied, and decides next action.
 *
 * OWNERSHIP:
 *   - This engine owns the coaching loop state and decisions.
 *   - It does NOT own audio delivery, scoring, or surface progression.
 *   - It consumes structured dimensions from Dojo scoring.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import { evaluateFocusApplication, type FocusContext } from '@/lib/learning/learnFocusEvaluator';
import { DIMENSION_LABELS, SKILL_DIMENSION_KEYS } from '@/lib/learning/learnScoringSchema';
import { getSubSkillDefinition, getSubSkillsForSkill } from '@/lib/learning/learnSubSkillMap';
import { createLogger } from '@/lib/logger';

const logger = createLogger('ClosedLoopEngine');

// ── Types ──────────────────────────────────────────────────────────

export type ClosedLoopNextStep =
  | 'retry_same_focus'
  | 'reinforce_with_micro_coaching'
  | 'advance_to_harder_variant'
  | 'move_to_next_concept'
  | 'route_to_skill_builder'
  | 'route_to_learn_review';

export interface ClosedLoopAttempt {
  sessionId: string;
  transcript?: string;
  score?: number;
  dimensions?: Record<string, number>;
  focusApplied?: boolean;
  weakDimensions?: string[];
  improvedDimensions?: string[];
  timestamp: string;
}

export interface ClosedLoopSession {
  id: string;
  skill: SkillFocus;
  subSkill?: string;
  focusPattern?: string;

  taughtConcept: string;
  taughtAt: string;

  attempts: ClosedLoopAttempt[];

  status:
    | 'teaching'
    | 'testing'
    | 'verifying'
    | 'reinforcing'
    | 'completed'
    | 'needs_review';

  nextStep: ClosedLoopNextStep | null;
}

export interface ClosedLoopVerification {
  outcome: 'missed' | 'partial' | 'applied' | 'strong';
  summary: string;
  improvedDimensions: string[];
  weakDimensions: string[];
  recommendedNextStep: ClosedLoopNextStep;
}

// ── Session Factory ────────────────────────────────────────────────

let sessionCounter = 0;

export function createClosedLoopSession(
  skill: SkillFocus,
  taughtConcept: string,
  subSkill?: string,
  focusPattern?: string,
): ClosedLoopSession {
  return {
    id: `cl_${Date.now()}_${++sessionCounter}`,
    skill,
    subSkill,
    focusPattern,
    taughtConcept,
    taughtAt: new Date().toISOString(),
    attempts: [],
    status: 'teaching',
    nextStep: null,
  };
}

// ── Record Attempt ─────────────────────────────────────────────────

export function recordAttempt(
  session: ClosedLoopSession,
  attempt: Omit<ClosedLoopAttempt, 'timestamp'>,
): ClosedLoopSession {
  const enriched: ClosedLoopAttempt = {
    ...attempt,
    timestamp: new Date().toISOString(),
  };

  // Run focus verification on dimensions
  if (attempt.dimensions) {
    const focusCtx = buildFocusContext(session);
    const result = evaluateFocusApplication(focusCtx, attempt.dimensions);
    enriched.focusApplied = result.applied;
    enriched.weakDimensions = result.weakDimensions;
    enriched.improvedDimensions = result.improvedDimensions;
  }

  return {
    ...session,
    attempts: [...session.attempts, enriched],
    status: 'verifying',
  };
}

// ── Verification ───────────────────────────────────────────────────

export function verifyAttempt(session: ClosedLoopSession): ClosedLoopVerification {
  const latest = session.attempts[session.attempts.length - 1];
  if (!latest) {
    return {
      outcome: 'missed',
      summary: 'No attempt recorded.',
      improvedDimensions: [],
      weakDimensions: [],
      recommendedNextStep: 'retry_same_focus',
    };
  }

  const dims = latest.dimensions;
  if (!dims) {
    return {
      outcome: 'missed',
      summary: 'No scoring data available.',
      improvedDimensions: [],
      weakDimensions: [],
      recommendedNextStep: 'retry_same_focus',
    };
  }

  const focusCtx = buildFocusContext(session);
  const focusResult = evaluateFocusApplication(focusCtx, dims);

  // Determine outcome based on focus evaluation
  const outcome = classifyOutcome(focusResult.strength, focusResult.applied, latest.score);
  const summary = buildVerificationSummary(outcome, session, focusResult);
  const nextStep = decideNextStep(outcome, session);

  return {
    outcome,
    summary,
    improvedDimensions: focusResult.improvedDimensions,
    weakDimensions: focusResult.weakDimensions,
    recommendedNextStep: nextStep,
  };
}

/**
 * Apply verification result to session, advancing its state.
 */
export function applyVerification(
  session: ClosedLoopSession,
  verification: ClosedLoopVerification,
): ClosedLoopSession {
  const nextStatus = mapNextStepToStatus(verification.recommendedNextStep);

  return {
    ...session,
    status: nextStatus,
    nextStep: verification.recommendedNextStep,
  };
}

// ── Select Next Concept ────────────────────────────────────────────

/**
 * Given a completed loop, pick the next sub-skill to teach.
 * Prefers adjacent sub-skills within the same skill.
 */
export function selectNextConcept(
  skill: SkillFocus,
  completedSubSkill?: string,
): { subSkill: string; focusPattern: string; concept: string } | null {
  const allSubs = getSubSkillsForSkill(skill);
  if (allSubs.length === 0) return null;

  // Find index of completed sub-skill, pick next one
  const idx = completedSubSkill
    ? allSubs.findIndex(s => s.name === completedSubSkill)
    : -1;

  const nextIdx = (idx + 1) % allSubs.length;
  const next = allSubs[nextIdx];

  return {
    subSkill: next.name,
    focusPattern: next.patterns[0] || '',
    concept: next.concepts[0] || next.name,
  };
}

// ── Build Retry Launch State ───────────────────────────────────────

export function buildRetryLaunchState(session: ClosedLoopSession): Record<string, unknown> {
  return {
    skill: session.skill,
    focusPattern: session.focusPattern,
    subSkill: session.subSkill,
    isRetry: true,
    attemptNumber: session.attempts.length + 1,
    priorWeakDimensions: session.attempts[session.attempts.length - 1]?.weakDimensions || [],
  };
}

// ── Internal Helpers ───────────────────────────────────────────────

function buildFocusContext(session: ClosedLoopSession): FocusContext {
  const def = session.subSkill
    ? getSubSkillDefinition(session.skill, session.subSkill)
    : null;

  return {
    skill: session.skill,
    subSkill: session.subSkill,
    focusPatterns: def?.patterns || (session.focusPattern ? [session.focusPattern] : []),
    concepts: def?.concepts || [],
  };
}

function classifyOutcome(
  strength: number,
  applied: boolean,
  score?: number,
): ClosedLoopVerification['outcome'] {
  // Strong: high focus strength AND decent score
  if (applied && strength >= 70 && (score == null || score >= 70)) return 'strong';

  // Applied: focus was used but room to grow
  if (applied && strength >= 50) return 'applied';

  // Partial: attempted but weak
  if (strength >= 30 || (score != null && score >= 50)) return 'partial';

  // Missed
  return 'missed';
}

function decideNextStep(
  outcome: ClosedLoopVerification['outcome'],
  session: ClosedLoopSession,
): ClosedLoopNextStep {
  const attemptCount = session.attempts.length;

  switch (outcome) {
    case 'strong':
      return 'advance_to_harder_variant';

    case 'applied':
      // Good enough to move on
      return 'move_to_next_concept';

    case 'partial':
      // First or second attempt → retry with coaching
      if (attemptCount <= 2) return 'reinforce_with_micro_coaching';
      // Third+ attempt → route to structured learning
      return 'route_to_skill_builder';

    case 'missed':
      // First attempt → micro-coaching then retry
      if (attemptCount <= 1) return 'reinforce_with_micro_coaching';
      // Repeated misses → deeper review
      if (attemptCount <= 3) return 'route_to_learn_review';
      return 'route_to_skill_builder';

    default:
      return 'retry_same_focus';
  }
}

function mapNextStepToStatus(nextStep: ClosedLoopNextStep): ClosedLoopSession['status'] {
  switch (nextStep) {
    case 'retry_same_focus':
    case 'advance_to_harder_variant':
      return 'testing';
    case 'reinforce_with_micro_coaching':
      return 'reinforcing';
    case 'move_to_next_concept':
      return 'completed';
    case 'route_to_skill_builder':
    case 'route_to_learn_review':
      return 'needs_review';
    default:
      return 'testing';
  }
}

function buildVerificationSummary(
  outcome: ClosedLoopVerification['outcome'],
  session: ClosedLoopSession,
  focusResult: { improvedDimensions: string[]; weakDimensions: string[]; strength: number },
): string {
  const concept = session.subSkill || session.taughtConcept;
  const improved = focusResult.improvedDimensions.map(d => DIMENSION_LABELS[d] || d);
  const weak = focusResult.weakDimensions.map(d => DIMENSION_LABELS[d] || d);

  switch (outcome) {
    case 'strong':
      return `Strong application of ${concept}. ${improved.length ? `Nailed: ${improved.join(', ')}.` : ''}`;
    case 'applied':
      return `Applied ${concept} reasonably. ${weak.length ? `Still developing: ${weak.join(', ')}.` : ''}`;
    case 'partial':
      return `Partially applied ${concept}. ${weak.length ? `Weak on: ${weak.join(', ')}.` : 'Needs more focus.'}`;
    case 'missed':
      return `Didn't apply ${concept}. ${weak.length ? `Missing: ${weak.join(', ')}.` : 'Focus was not present.'}`;
    default:
      return `Verification complete for ${concept}.`;
  }
}
