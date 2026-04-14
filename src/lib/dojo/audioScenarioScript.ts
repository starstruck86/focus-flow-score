/**
 * Audio Scenario Script — Structured verbal flow for audio-first sessions.
 *
 * Supports both Dojo (practice reps) and Learn (lesson teaching).
 * Every field is designed to be spoken aloud.
 */

import type { DojoScenario } from './scenarios';

// ── Dojo Script ────────────────────────────────────────────────────

export interface AudioScenarioScript {
  /** Warm greeting / scene-setter */
  intro: string;
  /** Business context — who, what company, what situation */
  context: string;
  /** The buyer's objection delivered in-character */
  objection: string;
  /** What a strong response should do — spoken before the user answers */
  whatGoodSoundsLike: string;
  /** Evaluation criteria Dave will use — sets expectations */
  evaluationCriteria: string;
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
    whatGoodSoundsLike: buildWhatGoodSoundsLike(scenario),
    evaluationCriteria: buildEvaluationCriteria(scenario),
    instruction: "You've got 60 seconds. Handle this like you're in the deal. Go.",
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

// ── Learn Script ───────────────────────────────────────────────────

export interface AudioLessonScript {
  /** Opening — what we're learning */
  intro: string;
  /** Core concept explanation */
  concept: string;
  /** What a strong execution looks like — model answer */
  whatGoodLooksLike: string;
  /** Why it works — breakdown */
  breakdown: string;
  /** When to use */
  whenToUse: string;
  /** When NOT to use */
  whenToAvoid: string;
  /** What Dave wants from the user before they respond */
  expectedResponseFraming: string;
  /** The actual application prompt */
  applicationPrompt: string;
  /** Example response (for teaching, spoken before asking user) */
  exampleResponse?: string;
}

/**
 * Build a full audio lesson script from lesson content.
 */
export function buildAudioLessonScript(lesson: {
  title: string;
  topic: string;
  lesson_content: {
    concept: string;
    what_good_looks_like: string;
    breakdown: string;
    when_to_use: string;
    when_not_to_use: string;
  };
  quiz_content?: {
    open_ended_prompt?: string;
    rubric?: string;
  } | null;
}): AudioLessonScript {
  const content = lesson.lesson_content;
  const skillLabel = formatSkillLabel(lesson.topic);

  return {
    intro: `Let's work on ${skillLabel}. This lesson is called: ${lesson.title}.`,
    concept: content.concept,
    whatGoodLooksLike: `Here's what good looks like. ${content.what_good_looks_like}`,
    breakdown: `Here's why this works. ${content.breakdown}`,
    whenToUse: `Use this when: ${content.when_to_use}`,
    whenToAvoid: `Avoid this when: ${content.when_not_to_use}`,
    expectedResponseFraming: buildExpectedResponseFraming(lesson),
    applicationPrompt: lesson.quiz_content?.open_ended_prompt
      ?? `Now apply what we just covered about ${skillLabel}. Give me your best response.`,
    exampleResponse: undefined, // Populated by caller if KI example available
  };
}

// ── Internal Helpers ───────────────────────────────────────────────

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

function buildWhatGoodSoundsLike(scenario: DojoScenario): string {
  if (scenario.skillFocus === 'executive_response') {
    return "This is a high-pressure executive scenario. The exec doesn't want context — they want the answer. Lead with a number or outcome in your first sentence. Keep it under three sentences total. No setup, no hedging, no 'we help companies.' If you wouldn't say it to a CEO who's already standing up to leave — don't say it here.";
  }

  const cues: Record<string, string> = {
    objection_handling: "In this one, I want you to acknowledge the concern, reframe it around business value, and keep the conversation moving forward.",
    discovery: "Here, I want you to go deeper than the surface answer. Ask a second-level question that gets to the business impact.",
    deal_control: "You need to maintain control of the process. Set a clear next step and get commitment.",
    qualification: "Focus on qualifying the opportunity. Understand timeline, budget authority, and decision process.",
  };
  return cues[scenario.skillFocus] ?? "I want you to respond naturally, like you're in the real deal.";
}

function buildEvaluationCriteria(scenario: DojoScenario): string {
  if (scenario.skillFocus === 'executive_response') {
    return "I'm grading four things: Did your first sentence contain a number or outcome? Was your total response under 3 sentences? Did you anchor to what the exec actually cares about? Did you project certainty — no hedging, no qualifiers? Miss any one of those and you're below 70.";
  }

  const criteria: Record<string, string> = {
    objection_handling: "I'll be evaluating whether you acknowledged the objection, reanchored on value, and advanced the conversation — not just whether you had a response.",
    discovery: "I'll be looking at whether you uncovered business impact, not just surface symptoms. Did you make the prospect think?",
    deal_control: "I'll check if you maintained process control and secured a specific next step.",
    qualification: "I'm looking at whether you qualified effectively — timeline, authority, budget, and decision criteria.",
  };
  return criteria[scenario.skillFocus] ?? "I'll evaluate your response on structure, relevance, and impact.";
}

function buildExpectedResponseFraming(lesson: {
  topic: string;
  quiz_content?: { rubric?: string } | null;
}): string {
  if (lesson.quiz_content?.rubric) {
    return `Before you respond — here's what I'm looking for: ${lesson.quiz_content.rubric}`;
  }

  const defaults: Record<string, string> = {
    objection_handling: "When you respond, I want to see you acknowledge the concern, reframe around value, and keep momentum.",
    discovery: "I want you to ask a question that uncovers business impact, not just symptoms.",
    executive_response: "Frame your answer for a C-level audience. Quantify where possible.",
    deal_control: "Show me you can maintain process control and propose a clear next step.",
    qualification: "Demonstrate that you're qualifying the opportunity, not just presenting.",
  };

  return defaults[lesson.topic]
    ?? "Apply what we just covered. I'll coach you on what you can sharpen.";
}
