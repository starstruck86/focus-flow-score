/**
 * Dave Closed-Loop Resume — Resume intelligence for coaching loops.
 *
 * Generates concise spoken intros when resuming an unfinished loop.
 * Also provides helpers for the launcher/router to prioritize active loops.
 *
 * OWNERSHIP: This file owns resume narration for closed-loop sessions.
 * It does NOT own persistence, verification, or audio delivery.
 */

import type { ClosedLoopSession, ClosedLoopVerification } from '@/lib/daveClosedLoopEngine';
import { buildProgressSummary, type ClosedLoopProgressSummary } from '@/lib/daveClosedLoopStore';
import type { VoiceSurface } from '@/lib/daveVoiceRuntime';
import { DIMENSION_LABELS } from '@/lib/learning/learnScoringSchema';

// ── Resume Intro Builder ──────────────────────────────────────────

export interface ClosedLoopResumeInfo {
  /** One-sentence summary of the loop state */
  spokenIntro: string;
  /** Where Dave should route next */
  nextSurface: VoiceSurface | null;
  /** Launch state for that surface */
  launchState: Record<string, unknown>;
  /** Whether the loop is still actionable */
  actionable: boolean;
}

export function buildLoopResumeInfo(session: ClosedLoopSession): ClosedLoopResumeInfo {
  const concept = session.subSkill || session.taughtConcept;
  const attemptCount = session.attempts.length;
  const summary = buildProgressSummary(session);

  // Determine the spoken intro based on status
  const spokenIntro = buildResumeSpoken(session, concept, summary);
  const { nextSurface, launchState } = resolveResumeTarget(session);

  return {
    spokenIntro,
    nextSurface,
    launchState,
    actionable: session.status !== 'completed',
  };
}

function buildResumeSpoken(
  session: ClosedLoopSession,
  concept: string,
  summary: ClosedLoopProgressSummary,
): string {
  const { attempts, latestOutcome, improved } = summary;

  switch (session.status) {
    case 'teaching':
      return `We were starting to work on ${concept}. Let me teach it first.`;

    case 'testing':
      if (attempts === 0) {
        return `We covered ${concept}. You haven't practiced it yet. Let's do a rep.`;
      }
      return improved
        ? `We've been working on ${concept}. You improved last time. Let's test again.`
        : `We were working on ${concept}. You ${outcomeVerb(latestOutcome)} on attempt ${attempts}. Time for another rep.`;

    case 'verifying':
      return `We just tested ${concept}. Let me check how you did.`;

    case 'reinforcing': {
      const weak = session.attempts[attempts - 1]?.weakDimensions?.[0];
      const weakLabel = weak ? (DIMENSION_LABELS[weak] || weak.replace(/([A-Z])/g, ' $1').trim()) : null;
      return weakLabel
        ? `We're reinforcing ${concept}. Focus on ${weakLabel} this time.`
        : `We're reinforcing ${concept}. One more focused rep.`;
    }

    case 'needs_review':
      if (session.nextStep === 'route_to_skill_builder') {
        return `${concept} needs more structured work. Let me set up a Skill Builder session.`;
      }
      return `You're still working on ${concept}. Let me reteach the key idea, then we'll try again.`;

    case 'completed':
      return `You've completed ${concept}. Nice work.`;

    default:
      return `Picking up where we left off on ${concept}.`;
  }
}

function outcomeVerb(outcome: string): string {
  switch (outcome) {
    case 'missed': return 'missed the focus';
    case 'partial': return 'partially applied it';
    case 'applied': return 'applied it';
    case 'strong': return 'nailed it';
    default: return 'attempted it';
  }
}

function resolveResumeTarget(session: ClosedLoopSession): {
  nextSurface: VoiceSurface | null;
  launchState: Record<string, unknown>;
} {
  const base = {
    skill: session.skill,
    subSkill: session.subSkill,
    focusPattern: session.focusPattern,
    closedLoopSessionId: session.id,
    isResume: true,
  };

  switch (session.status) {
    case 'teaching':
      return { nextSurface: 'learn', launchState: { ...base, concept: session.taughtConcept } };

    case 'testing':
    case 'reinforcing':
      return {
        nextSurface: 'dojo',
        launchState: {
          ...base,
          isRetry: session.attempts.length > 0,
          attemptNumber: session.attempts.length + 1,
          priorWeakDimensions: session.attempts[session.attempts.length - 1]?.weakDimensions || [],
        },
      };

    case 'needs_review':
      if (session.nextStep === 'route_to_skill_builder') {
        return {
          nextSurface: 'skill_builder',
          launchState: { ...base, fromClosedLoop: true },
        };
      }
      return { nextSurface: 'learn', launchState: { ...base, closedLoopReview: true, concept: session.taughtConcept } };

    case 'completed':
      return { nextSurface: null, launchState: {} };

    default:
      return { nextSurface: 'dojo', launchState: base };
  }
}

// ── History Narration ─────────────────────────────────────────────

/**
 * Generate a brief spoken history of a loop for Dave to reference.
 * Example: "We've been working on pain quantification. You missed it first,
 * then partially applied it. Let's get it this time."
 */
export function buildLoopHistoryNarration(session: ClosedLoopSession): string | null {
  const concept = session.subSkill || session.taughtConcept;
  const summary = buildProgressSummary(session);

  if (summary.attempts <= 1) return null; // Not enough history to narrate

  const parts: string[] = [`We've been working on ${concept}.`];

  if (summary.attempts === 2) {
    parts.push(`You ${outcomeVerb(summary.firstOutcome)} on the first try, then ${outcomeVerb(summary.latestOutcome)}.`);
  } else {
    parts.push(`${summary.attempts} attempts so far. Started with ${summary.firstOutcome}, now at ${summary.latestOutcome}.`);
  }

  if (summary.improved) {
    parts.push("You're improving.");
  } else if (summary.latestOutcome === 'missed' && summary.attempts >= 3) {
    parts.push("This one's tough. Let's slow down and focus.");
  }

  return parts.join(' ');
}

// ── Launcher Priority Check ───────────────────────────────────────

/**
 * Determine whether an active loop should override a generic recommendation.
 * Returns true if the loop is clearly more important than the default.
 */
export function shouldPrioritizeLoop(session: ClosedLoopSession | null): boolean {
  if (!session) return false;
  if (session.status === 'completed') return false;

  // Active testing/reinforcing always takes priority
  if (['testing', 'reinforcing', 'needs_review'].includes(session.status)) return true;

  // Teaching with no attempts yet — worth continuing
  if (session.status === 'teaching' && session.attempts.length === 0) return true;

  return false;
}
