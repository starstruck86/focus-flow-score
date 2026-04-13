/**
 * Dave Closed-Loop Orchestrator
 *
 * Bridge between the closed-loop engine and live product surfaces.
 * Takes loop state + verification → returns the exact spoken line,
 * next surface, launch state, and whether the loop stays active.
 *
 * OWNERSHIP: This file owns the "what Dave does next" decision layer.
 * It does NOT own scoring, audio delivery, or surface navigation.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type {
  ClosedLoopSession,
  ClosedLoopVerification,
  ClosedLoopNextStep,
} from '@/lib/daveClosedLoopEngine';
import { buildRetryLaunchState, selectNextConcept } from '@/lib/daveClosedLoopEngine';
import { generateMicroCoaching } from '@/lib/daveMicroCoaching';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';

// ── Types ──────────────────────────────────────────────────────────

export interface ClosedLoopOrchestrationStep {
  spoken: string;
  nextSurface: VoiceSurface | null;
  launchState?: Record<string, unknown>;
  keepLoopActive: boolean;
}

// ── Escalation Rules ───────────────────────────────────────────────

export type EscalationType =
  | 'pressure_variant'
  | 'stronger_resistance'
  | 'multi_thread'
  | 'less_prep_time'
  | 'adjacent_pattern';

interface EscalationRule {
  type: EscalationType;
  label: string;
  difficultyBump: string;
  spokenFrame: string;
}

const ESCALATION_RULES: EscalationRule[] = [
  {
    type: 'pressure_variant',
    label: 'Same concept under pressure',
    difficultyBump: 'hard',
    spokenFrame: "Good. Now same concept, but the buyer is pushing back harder.",
  },
  {
    type: 'stronger_resistance',
    label: 'Stronger buyer resistance',
    difficultyBump: 'hard',
    spokenFrame: "Nice work. Let's try a tougher version — the buyer is more skeptical this time.",
  },
  {
    type: 'multi_thread',
    label: 'Multi-thread complication',
    difficultyBump: 'hard',
    spokenFrame: "Now there's a second stakeholder involved. Handle both perspectives.",
  },
  {
    type: 'less_prep_time',
    label: 'Less preparation time',
    difficultyBump: 'medium',
    spokenFrame: "Same skill, but this time respond faster. No overthinking.",
  },
  {
    type: 'adjacent_pattern',
    label: 'Adjacent pattern combo',
    difficultyBump: 'medium',
    spokenFrame: "You nailed that. Let's combine it with an adjacent skill.",
  },
];

/**
 * Pick the right escalation based on attempt count and skill.
 */
function pickEscalation(session: ClosedLoopSession): EscalationRule {
  const attemptCount = session.attempts.length;

  // First escalation: pressure
  if (attemptCount <= 2) return ESCALATION_RULES[0];
  // Second: stronger resistance
  if (attemptCount <= 3) return ESCALATION_RULES[1];
  // Third+: multi-thread or adjacent
  if (session.skill === 'discovery' || session.skill === 'qualification') {
    return ESCALATION_RULES[2]; // multi-thread
  }
  return ESCALATION_RULES[4]; // adjacent pattern
}

// ── Main Orchestrator ──────────────────────────────────────────────

export function orchestrateNextStep(
  session: ClosedLoopSession,
  verification: ClosedLoopVerification,
): ClosedLoopOrchestrationStep {
  const coaching = generateMicroCoaching(verification, session);
  const nextStep = verification.recommendedNextStep;

  switch (nextStep) {
    case 'retry_same_focus':
      return orchestrateRetry(session, coaching.retryFrame || coaching.spoken);

    case 'reinforce_with_micro_coaching':
      return orchestrateReinforce(session, coaching);

    case 'advance_to_harder_variant':
      return orchestrateEscalation(session, coaching);

    case 'move_to_next_concept':
      return orchestrateAdvance(session, coaching);

    case 'route_to_skill_builder':
      return orchestrateSkillBuilderRoute(session, coaching);

    case 'route_to_learn_review':
      return orchestrateLearnReview(session, coaching);

    default:
      return {
        spoken: coaching.spoken,
        nextSurface: null,
        keepLoopActive: false,
      };
  }
}

// ── Step Handlers ──────────────────────────────────────────────────

function orchestrateRetry(
  session: ClosedLoopSession,
  retryLine: string,
): ClosedLoopOrchestrationStep {
  const launchState = buildRetryLaunchState(session);

  return {
    spoken: retryLine,
    nextSurface: 'dojo',
    launchState: {
      ...launchState,
      closedLoopSessionId: session.id,
    },
    keepLoopActive: true,
  };
}

function orchestrateReinforce(
  session: ClosedLoopSession,
  coaching: { spoken: string; retryFrame?: string },
): ClosedLoopOrchestrationStep {
  const launchState = buildRetryLaunchState(session);

  // Speak coaching line, then retry
  const spoken = coaching.retryFrame
    ? `${coaching.spoken} ${coaching.retryFrame}`
    : coaching.spoken;

  return {
    spoken,
    nextSurface: 'dojo',
    launchState: {
      ...launchState,
      closedLoopSessionId: session.id,
      reinforced: true,
    },
    keepLoopActive: true,
  };
}

function orchestrateEscalation(
  session: ClosedLoopSession,
  coaching: { spoken: string; encouragement?: string },
): ClosedLoopOrchestrationStep {
  const escalation = pickEscalation(session);

  const spoken = coaching.encouragement
    ? `${coaching.spoken} ${escalation.spokenFrame}`
    : escalation.spokenFrame;

  return {
    spoken,
    nextSurface: 'dojo',
    launchState: {
      skill: session.skill,
      focusPattern: session.focusPattern,
      subSkill: session.subSkill,
      closedLoopSessionId: session.id,
      difficulty: escalation.difficultyBump,
      escalationType: escalation.type,
      isEscalation: true,
    },
    keepLoopActive: true,
  };
}

function orchestrateAdvance(
  session: ClosedLoopSession,
  coaching: { spoken: string; encouragement?: string },
): ClosedLoopOrchestrationStep {
  const next = selectNextConcept(session.skill, session.subSkill);

  if (!next) {
    return {
      spoken: `${coaching.spoken} That covers all the sub-skills for this area. Great work.`,
      nextSurface: null,
      keepLoopActive: false,
    };
  }

  return {
    spoken: `${coaching.spoken} Moving on to ${next.subSkill}.`,
    nextSurface: 'learn',
    launchState: {
      skill: session.skill,
      subSkill: next.subSkill,
      focusPattern: next.focusPattern,
      concept: next.concept,
      closedLoopAdvance: true,
    },
    keepLoopActive: true,
  };
}

function orchestrateSkillBuilderRoute(
  session: ClosedLoopSession,
  coaching: { spoken: string },
): ClosedLoopOrchestrationStep {
  return {
    spoken: `${coaching.spoken} You need more structured practice. Let me set up a focused training block.`,
    nextSurface: 'skill_builder',
    launchState: {
      skill: session.skill,
      focusPattern: session.focusPattern,
      subSkill: session.subSkill,
      taughtConcept: session.taughtConcept,
      fromClosedLoop: true,
      closedLoopSessionId: session.id,
      // Carry remediation context so Skill Builder knows what to reinforce
      remediationContext: {
        concept: session.taughtConcept,
        weakDimensions: session.attempts[session.attempts.length - 1]?.weakDimensions || [],
        attemptCount: session.attempts.length,
      },
    },
    keepLoopActive: true, // Loop stays active — SB completion can hand back
  };
}

function orchestrateLearnReview(
  session: ClosedLoopSession,
  coaching: { spoken: string },
): ClosedLoopOrchestrationStep {
  return {
    spoken: `${coaching.spoken} Let me reteach this concept quickly before we try again.`,
    nextSurface: 'learn',
    launchState: {
      skill: session.skill,
      subSkill: session.subSkill,
      focusPattern: session.focusPattern,
      concept: session.taughtConcept,
      closedLoopReview: true,
      closedLoopSessionId: session.id,
    },
    keepLoopActive: true,
  };
}
