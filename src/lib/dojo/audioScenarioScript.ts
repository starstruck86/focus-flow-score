/**
 * Audio Scenario Script — Structured verbal flow for audio-first Dojo sessions.
 *
 * Each scenario is decomposed into explicit spoken segments that Dave delivers
 * sequentially. No step is skipped; no step is implied.
 */

import type { DojoScenario } from './scenarios';

export interface AudioScenarioScript {
  /** Warm greeting / scene-setter */
  intro: string;
  /** Business context — who, what company, what situation */
  context: string;
  /** The buyer's objection delivered in-character */
  objection: string;
  /** Explicit verbal cue that recording is about to start */
  instruction: string;
  /** Coaching prompt used before retry */
  retrySetup: string;
}

/**
 * Build a full verbal script from a DojoScenario.
 * Every segment is designed to be spoken aloud — short sentences, clear pacing.
 */
export function buildAudioScript(scenario: DojoScenario): AudioScenarioScript {
  const skillLabel = formatSkillLabel(scenario.skillFocus);

  return {
    intro: `Alright — let's run a ${skillLabel} scenario. ${getDifficultyFlavor(scenario.difficulty)}`,
    context: `Here's the situation. ${scenario.context}`,
    objection: `The buyer says: "${scenario.objection}"`,
    instruction: "How do you respond? Go.",
    retrySetup: "Let's run that again.",
  };
}

/**
 * Build retry script with coaching cue from feedback.
 */
export function buildRetryScript(practiceCue?: string): {
  retryPrompt: string;
  retryInstruction: string;
} {
  const cue = practiceCue ? ` This time, focus on this: ${practiceCue}.` : '';
  return {
    retryPrompt: `Let's run that again.${cue}`,
    retryInstruction: "Go ahead.",
  };
}

/**
 * Build coaching feedback speech segments from a score result.
 * Structured as: summary → what worked → key improvement → improved version.
 */
export function buildFeedbackScript(result: {
  score?: number | null;
  feedback?: string | null;
  topMistake?: string | null;
  improvedVersion?: string | null;
}): string[] {
  const segments: string[] = [];
  const score = result.score ?? 0;

  // 1. Summary line
  if (score >= 8) {
    segments.push("That was strong.");
  } else if (score >= 6) {
    segments.push("Solid effort. Let's sharpen a couple things.");
  } else if (score >= 4) {
    segments.push("There's something to build on here.");
  } else {
    segments.push("Let's work on this together.");
  }

  // 2. What worked (extract from feedback)
  if (result.feedback) {
    const positiveMatch = result.feedback.match(/(?:strength|well|good|strong)[^.]*\./i);
    if (positiveMatch) {
      segments.push(`What worked: ${positiveMatch[0]}`);
    }
  }

  // 3. Key improvement
  if (result.topMistake) {
    segments.push(`Key area to improve: ${result.topMistake}.`);
  }

  // 4. Improved version
  if (result.improvedVersion) {
    segments.push(`Here's how a top rep would say it: ${result.improvedVersion}`);
  }

  return segments;
}

// ── Helpers ────────────────────────────────────────────────────────

function formatSkillLabel(skill: string): string {
  const labels: Record<string, string> = {
    objection_handling: 'objection handling',
    discovery: 'discovery',
    executive_response: 'executive response',
    deal_control: 'deal control',
    qualification: 'qualification',
  };
  return labels[skill] ?? skill.replace(/_/g, ' ');
}

function getDifficultyFlavor(difficulty: string): string {
  switch (difficulty) {
    case 'foundational': return "This one's a warm-up.";
    case 'intermediate': return "This one's got some teeth.";
    case 'advanced': return "This is a tough one. Stay sharp.";
    default: return '';
  }
}
