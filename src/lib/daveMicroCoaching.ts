/**
 * Dave Micro-Coaching — Targeted spoken feedback based on closed-loop verification.
 *
 * Turns verification results into brief, specific coaching lines.
 * These are designed to be spoken aloud — concise, direct, behavioral.
 *
 * OWNERSHIP: This file owns coaching language generation.
 * It does NOT own scoring, verification logic, or audio delivery.
 */

import type { ClosedLoopVerification, ClosedLoopSession } from '@/lib/daveClosedLoopEngine';
import { DIMENSION_LABELS } from '@/lib/learning/learnScoringSchema';

// ── Types ──────────────────────────────────────────────────────────

export interface MicroCoachingResponse {
  /** Brief spoken coaching message */
  spoken: string;
  /** Optional retry framing if retrying same focus */
  retryFrame?: string;
  /** Encouragement line for strong performance */
  encouragement?: string;
}

// ── Main Generator ─────────────────────────────────────────────────

export function generateMicroCoaching(
  verification: ClosedLoopVerification,
  session: ClosedLoopSession,
): MicroCoachingResponse {
  const concept = session.subSkill || session.taughtConcept;

  switch (verification.outcome) {
    case 'missed':
      return buildMissedCoaching(concept, verification, session);
    case 'partial':
      return buildPartialCoaching(concept, verification, session);
    case 'applied':
      return buildAppliedCoaching(concept, verification);
    case 'strong':
      return buildStrongCoaching(concept, verification);
    default:
      return { spoken: `Let's keep working on ${concept}.` };
  }
}

// ── Missed ─────────────────────────────────────────────────────────

function buildMissedCoaching(
  concept: string,
  v: ClosedLoopVerification,
  session: ClosedLoopSession,
): MicroCoachingResponse {
  const weakLabel = pickWeakLabel(v.weakDimensions);

  // Skill-specific missed coaching
  const lines = getMissedLines(concept, weakLabel, session);

  return {
    spoken: lines.coaching,
    retryFrame: lines.retry,
  };
}

function getMissedLines(
  concept: string,
  weakLabel: string | null,
  session: ClosedLoopSession,
): { coaching: string; retry: string } {
  const skill = session.skill;

  // Discovery-specific
  if (skill === 'discovery') {
    if (concept.includes('Urgency')) {
      return {
        coaching: "You stayed calm, but you never tested urgency. Ask about timelines or what's changed recently.",
        retry: "Same focus. This time, test urgency earlier in the conversation.",
      };
    }
    if (concept.includes('Pain') || concept.includes('Depth')) {
      return {
        coaching: "You touched on the problem, but didn't go deep. Ask why it matters, then ask again.",
        retry: "Try again. Go one level deeper this time — ask why twice.",
      };
    }
    if (concept.includes('Business Impact')) {
      return {
        coaching: "You explored the problem but didn't connect it to business impact. Tie it to revenue, cost, or competitive risk.",
        retry: "Same rep. This time, connect the pain to a business number.",
      };
    }
  }

  // Objection handling
  if (skill === 'objection_handling') {
    if (concept.includes('Containment') || concept.includes('Isolation')) {
      return {
        coaching: "You answered the objection, but didn't isolate the real concern first. Pause and ask what's really behind it.",
        retry: "Try again. Isolate the real concern before you respond.",
      };
    }
    if (concept.includes('Reframing')) {
      return {
        coaching: "You addressed the objection directly, but didn't reframe to business value. Shift the lens.",
        retry: "Same objection. Reframe to what it costs them to do nothing.",
      };
    }
  }

  // Deal control
  if (skill === 'deal_control') {
    return {
      coaching: `You didn't demonstrate ${concept}. Own the next step — name the action, name the date.`,
      retry: "Try again. Lock a specific commitment before you end.",
    };
  }

  // Executive response
  if (skill === 'executive_response') {
    return {
      coaching: "Too much filler. Lead with the number, anchor to their priority, and close with a specific ask.",
      retry: "Same scenario. Three sentences max.",
    };
  }

  // Generic fallback
  return {
    coaching: weakLabel
      ? `You didn't apply ${concept}. Focus on ${weakLabel} specifically.`
      : `${concept} wasn't present in your response. Let's try again with more intention.`,
    retry: `Same focus again. Make ${concept} the first thing you do.`,
  };
}

// ── Partial ────────────────────────────────────────────────────────

function buildPartialCoaching(
  concept: string,
  v: ClosedLoopVerification,
  session: ClosedLoopSession,
): MicroCoachingResponse {
  const improvedLabel = pickLabel(v.improvedDimensions);
  const weakLabel = pickWeakLabel(v.weakDimensions);

  let spoken: string;

  if (improvedLabel && weakLabel) {
    spoken = `Better. You showed ${improvedLabel}, but ${weakLabel} is still weak. Close that gap.`;
  } else if (weakLabel) {
    spoken = `You got closer to ${concept}, but ${weakLabel} needs more work.`;
  } else {
    spoken = `Partial application of ${concept}. You're getting there — push harder on the specifics.`;
  }

  // Skill-specific partial refinements
  if (session.skill === 'discovery' && concept.includes('Depth')) {
    spoken = "You got to pain, but you didn't quantify it. Attach a number next time.";
  }
  if (session.skill === 'objection_handling' && concept.includes('Reframing')) {
    spoken = "Better framing, but still not tied to business impact. Connect the dots.";
  }

  return {
    spoken,
    retryFrame: weakLabel
      ? `One more. Focus specifically on ${weakLabel}.`
      : `One more rep. Push ${concept} harder this time.`,
  };
}

// ── Applied ────────────────────────────────────────────────────────

function buildAppliedCoaching(
  concept: string,
  v: ClosedLoopVerification,
): MicroCoachingResponse {
  const improvedLabel = pickLabel(v.improvedDimensions);

  return {
    spoken: improvedLabel
      ? `Good. You applied ${concept}. ${improvedLabel} was solid.`
      : `Good work on ${concept}. The focus was there.`,
    encouragement: "Ready to level up. Let's move forward.",
  };
}

// ── Strong ─────────────────────────────────────────────────────────

function buildStrongCoaching(
  concept: string,
  v: ClosedLoopVerification,
): MicroCoachingResponse {
  const improvedLabel = pickLabel(v.improvedDimensions);

  const lines = [
    `That was clean. You nailed ${concept}.`,
    `Strong. ${concept} was well-executed.`,
    `Good. You actually applied ${concept} this time.`,
  ];
  const spoken = lines[Math.floor(Math.random() * lines.length)];

  return {
    spoken: improvedLabel
      ? `${spoken} ${improvedLabel} stood out.`
      : spoken,
    encouragement: "Let's push harder. Time to escalate.",
  };
}

// ── Helpers ────────────────────────────────────────────────────────

function pickWeakLabel(dims: string[]): string | null {
  if (dims.length === 0) return null;
  return DIMENSION_LABELS[dims[0]] || dims[0].replace(/([A-Z])/g, ' $1').trim();
}

function pickLabel(dims: string[]): string | null {
  if (dims.length === 0) return null;
  return DIMENSION_LABELS[dims[0]] || dims[0].replace(/([A-Z])/g, ' $1').trim();
}
