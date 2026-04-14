/**
 * Adaptive Skill Builder
 *
 * Adapts Skill Builder content emphasis based on the user's
 * actual gap: topBlocker, weakest scoring dimension, or current tier.
 */

import type { SkillFocus } from '@/lib/dojo/scenarios';
import type { SkillSession } from './skillSession';
import type { TrainingContent } from './skillBuilderContent';
import { getDimensionLabel } from './skillScenarioSelector';

export interface AdaptiveEmphasis {
  /** Which micro drill variant to emphasize */
  drillVariant: 'default' | 'blocker_specific' | 'dimension_specific';
  /** Custom drill prompt override when blocker is known */
  customDrillPrompt?: string;
  customDrillInstruction?: string;
  /** Which pattern to emphasize in the pattern shift step */
  emphasisNote?: string;
  /** Adaptive reason shown in debug */
  adaptationReason: string;
}

/**
 * Derive adaptive emphasis from session context.
 */
export function deriveAdaptiveEmphasis(
  session: SkillSession,
  content: TrainingContent,
): AdaptiveEmphasis {
  // Priority 1: topBlocker
  if (session.topBlocker) {
    const blockerDrill = getBlockerDrill(session.skillId, session.topBlocker);
    if (blockerDrill) {
      return {
        drillVariant: 'blocker_specific',
        customDrillPrompt: blockerDrill.prompt,
        customDrillInstruction: blockerDrill.instruction,
        emphasisNote: `Adapted: your biggest blocker is "${session.topBlocker}". This drill targets it directly.`,
        adaptationReason: `topBlocker: ${session.topBlocker}`,
      };
    }
  }

  // Priority 2: weakest scoring dimension (from focusPattern as proxy)
  if (session.focusPattern) {
    return {
      drillVariant: 'dimension_specific',
      emphasisNote: `Focused on: ${session.focusPattern.replace(/_/g, ' ')}. This is where your recent scores are weakest.`,
      adaptationReason: `focusPattern: ${session.focusPattern}`,
    };
  }

  // Priority 3: tier-based adaptation
  if (session.currentTier <= 1) {
    return {
      drillVariant: 'default',
      emphasisNote: 'Starting from fundamentals. Master the mental model before practicing under pressure.',
      adaptationReason: `tier: ${session.currentTier} (foundational)`,
    };
  }

  return {
    drillVariant: 'default',
    adaptationReason: 'no specific blocker detected — using default content',
  };
}

// ── Blocker-specific drill overrides ──────────────────────────────

interface DrillOverride {
  prompt: string;
  instruction: string;
}

function getBlockerDrill(skill: SkillFocus, blocker: string): DrillOverride | null {
  const drills: Record<string, Record<string, DrillOverride>> = {
    executive_response: {
      brevity: {
        prompt: 'A CEO asks: "Give me the bottom line on what you do." You have 15 seconds.',
        instruction: 'Respond in exactly 2 sentences. First sentence: the problem you solve. Second sentence: the measurable result. Nothing else.',
      },
      numberLed: {
        prompt: 'A CFO asks: "Why should I fund this over anything else on my desk?"',
        instruction: 'Start your response with a specific dollar amount or percentage. Build your answer around that number.',
      },
      priorityAnchoring: {
        prompt: 'The CMO says her board priority is reducing CAC by 20%. Pitch your value in that frame.',
        instruction: 'Your first words must reference her CAC goal. Do not mention any priority she didn\'t state.',
      },
      executivePresence: {
        prompt: 'A VP interrupts your pitch: "I\'ve heard this before. What\'s actually different?"',
        instruction: 'Respond with zero hedging. No "I think" or "we believe." State your differentiator as fact with one proof point.',
      },
    },
    objection_handling: {
      composure: {
        prompt: 'A buyer snaps: "This is a waste of my time. Your competitor already does this."',
        instruction: 'Respond calmly in 2 sentences. Acknowledge without defending. Ask one diagnostic question.',
      },
      isolation: {
        prompt: 'A Director says: "We\'re not interested right now." What\'s the real objection?',
        instruction: 'Ask ONE question designed to surface whether this is about timing, budget, politics, or genuine disinterest.',
      },
      reframing: {
        prompt: 'A buyer says: "You\'re 40% more expensive than the other option."',
        instruction: 'Reframe from cost to business risk or cost of inaction. Do not discuss pricing.',
      },
      proof: {
        prompt: 'A skeptical VP says: "Everyone claims they can do this."',
        instruction: 'Name one specific customer, their situation, and the measurable outcome. Make it concrete.',
      },
    },
    discovery: {
      painExcavation: {
        prompt: 'A buyer says: "Our email performance is fine, we just want to explore options."',
        instruction: 'Ask ONE question that tests whether "fine" means "good" or "we\'ve stopped looking at the numbers."',
      },
      painQuantification: {
        prompt: 'A buyer says: "We lose some customers after the first purchase."',
        instruction: 'Ask a question that converts "some customers" into a specific dollar amount or percentage.',
      },
    },
    deal_control: {
      nextStepControl: {
        prompt: 'The buyer says: "Let me think about it and get back to you."',
        instruction: 'Propose a specific next step with a date. Include what you\'ll deliver and what they need to do.',
      },
      riskNaming: {
        prompt: 'Your champion has gone silent for 8 days after saying they\'d set up a technical review.',
        instruction: 'Write a message that directly names the deal risk without being accusatory.',
      },
    },
    qualification: {
      painValidation: {
        prompt: 'A marketing manager says: "We definitely need better automation."',
        instruction: 'Ask ONE question that distinguishes genuine business pain from aspirational interest.',
      },
      disqualification: {
        prompt: 'An enthusiastic coordinator wants a demo. She has no budget authority.',
        instruction: 'Respond in a way that tests whether this is a real opportunity worth pursuing.',
      },
    },
  };

  return drills[skill]?.[blocker] ?? null;
}
