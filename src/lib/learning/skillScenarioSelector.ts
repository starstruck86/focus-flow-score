/**
 * Skill-Shaped Scenario Selector
 *
 * Instead of random filtering by skillFocus label, this selects scenarios
 * based on explicit skill constraints: style, answer expectations, and pressure traits.
 * Also surfaces metadata about why the scenario was chosen.
 */

import type { DojoScenario, SkillFocus } from '@/lib/dojo/scenarios';
import { getRandomScenario } from '@/lib/dojo/scenarios';
import type { SkillSession } from './skillSession';

// ── Skill scenario constraints ────────────────────────────────────

export interface ScenarioConstraints {
  styles: string[];
  answerExpectation: string;
  pressureTraits: string[];
}

export const SKILL_SCENARIO_CONSTRAINTS: Record<SkillFocus, ScenarioConstraints> = {
  executive_response: {
    styles: ['executive update', 'board pressure', 'decision summary', 'ROI justification'],
    answerExpectation: 'Brief, decisive, outcome-first. ≤3 sentences. Lead with a number or business result.',
    pressureTraits: ['interruption', 'impatience', 'low tolerance for setup', 'executive_scrutiny'],
  },
  objection_handling: {
    styles: ['incumbent objection', 'timing objection', 'pricing objection', 'trust objection'],
    answerExpectation: 'Acknowledge → Diagnose → Redirect. Never counter-punch.',
    pressureTraits: ['skepticism', 'resistance', 'defensiveness', 'hostility'],
  },
  discovery: {
    styles: ['vague pain', 'partial answer', 'unclear priority', 'surface-level interest'],
    answerExpectation: 'Layered questioning, quantification, follow-up depth. Single-thread.',
    pressureTraits: ['ambiguity', 'shallow answers', 'deflection', 'impatience'],
  },
  deal_control: {
    styles: ['stalled deal', 'champion gone dark', 'procurement hijack', 'competitor introduced late'],
    answerExpectation: 'Propose specific next step with date, name risk, lock mutual commitment.',
    pressureTraits: ['evasion', 'delay tactics', 'shifting timelines', 'passive resistance'],
  },
  qualification: {
    styles: ['enthusiastic but no authority', 'big company no problem', 'pain exists but no urgency', 'using you as leverage'],
    answerExpectation: 'Test urgency, validate pain, map stakeholders, be willing to disqualify.',
    pressureTraits: ['surface enthusiasm', 'vagueness', 'lack of commitment signals'],
  },
};

// ── Scenario selection metadata ───────────────────────────────────

export interface ScenarioSelection {
  scenario: DojoScenario;
  constraints: ScenarioConstraints;
  selectionReason: string;
  taughtDimensions: string[];
}

/**
 * Select a scenario shaped by the skill session's context.
 * When topBlocker or scenarioType is provided, selection is biased accordingly.
 */
export function selectSkillShapedScenario(
  session: SkillSession,
  availableScenarios?: DojoScenario[],
): ScenarioSelection {
  const constraints = SKILL_SCENARIO_CONSTRAINTS[session.skillId];
  const scenario = getRandomScenario(session.skillId);

  // Determine selection reason based on session context
  let selectionReason = `${constraints.styles[0]} scenario for ${session.skillName}`;

  if (session.topBlocker) {
    selectionReason = `Targeting blocker: ${session.topBlocker}`;
  } else if (session.scenarioType === 'advanced') {
    selectionReason = `Advanced pressure scenario for ${session.skillName}`;
  } else if (session.focusPattern) {
    selectionReason = `Focused on pattern: ${session.focusPattern}`;
  }

  // Import scoring dimensions from the content registry
  const taughtDimensions = getDimensionsForSkill(session.skillId);

  return {
    scenario,
    constraints,
    selectionReason,
    taughtDimensions,
  };
}

// ── Dimension registry (mirrors skillBuilderContent + learnScoringSchema) ──

function getDimensionsForSkill(skill: SkillFocus): string[] {
  const DIMENSIONS: Record<SkillFocus, string[]> = {
    executive_response: ['brevity', 'numberLed', 'priorityAnchoring', 'executivePresence'],
    objection_handling: ['composure', 'isolation', 'reframing', 'proof', 'commitmentControl'],
    discovery: ['questionArchitecture', 'painExcavation', 'painQuantification', 'businessImpact', 'urgencyTesting', 'stakeholderDiscovery'],
    deal_control: ['nextStepControl', 'riskNaming', 'mutualPlan', 'stakeholderAlignment'],
    qualification: ['painValidation', 'stakeholderMapping', 'decisionProcess', 'disqualification'],
  };
  return DIMENSIONS[skill] ?? [];
}

// ── Skill-specific feedback templates ─────────────────────────────

export interface SkillFeedbackTemplate {
  dimensionMissLabel: (dim: string, score: number) => string;
  nextRepCue: (weakestDim: string) => string;
  strongPattern: (dim: string) => string;
}

const DIMENSION_LABELS: Record<string, string> = {
  brevity: 'Brevity',
  numberLed: 'Number-Led Opening',
  priorityAnchoring: 'Priority Anchoring',
  executivePresence: 'Executive Presence',
  composure: 'Composure',
  isolation: 'Objection Isolation',
  reframing: 'Reframing',
  proof: 'Proof Deployment',
  commitmentControl: 'Commitment Control',
  questionArchitecture: 'Question Architecture',
  painExcavation: 'Pain Excavation',
  painQuantification: 'Pain Quantification',
  businessImpact: 'Business Impact',
  urgencyTesting: 'Urgency Testing',
  stakeholderDiscovery: 'Stakeholder Discovery',
  nextStepControl: 'Next Step Control',
  riskNaming: 'Risk Naming',
  mutualPlan: 'Mutual Plan',
  stakeholderAlignment: 'Stakeholder Alignment',
  painValidation: 'Pain Validation',
  stakeholderMapping: 'Stakeholder Mapping',
  decisionProcess: 'Decision Process',
  disqualification: 'Disqualification Discipline',
};

export function getDimensionLabel(dim: string): string {
  return DIMENSION_LABELS[dim] ?? dim.replace(/([A-Z])/g, ' $1').trim();
}

/**
 * Analyze dimension scores and return structured feedback.
 */
export function analyzeDimensionScores(
  dimensions: Record<string, number> | null | undefined,
  skill: SkillFocus,
): {
  weakest: { key: string; label: string; score: number } | null;
  strongest: { key: string; label: string; score: number } | null;
  misses: Array<{ key: string; label: string; score: number }>;
  nextFocus: string;
} {
  if (!dimensions || Object.keys(dimensions).length === 0) {
    return { weakest: null, strongest: null, misses: [], nextFocus: 'Complete a rep to see dimension analysis.' };
  }

  const entries = Object.entries(dimensions)
    .map(([key, score]) => ({ key, label: getDimensionLabel(key), score }))
    .sort((a, b) => a.score - b.score);

  const weakest = entries[0] ?? null;
  const strongest = entries[entries.length - 1] ?? null;
  const misses = entries.filter(e => e.score <= 5);

  const nextFocus = weakest
    ? `Next rep: focus on ${weakest.label}. Score ${weakest.score}/10 — ${getImprovementCue(weakest.key, skill)}`
    : 'All dimensions solid. Push for elite execution.';

  return { weakest, strongest, misses, nextFocus };
}

function getImprovementCue(dim: string, skill: SkillFocus): string {
  const cues: Record<string, string> = {
    brevity: 'cut to 3 sentences max, no setup or filler.',
    numberLed: 'open with a specific metric or dollar amount.',
    priorityAnchoring: "anchor to the exec's stated priority, not your pitch.",
    executivePresence: 'project certainty — no hedging, no qualifiers.',
    composure: 'pause before responding. No defensive reaction.',
    isolation: 'ask one question to surface the real concern.',
    reframing: 'shift from feature/cost to business value or risk.',
    proof: 'name a specific customer, metric, or benchmark.',
    commitmentControl: 'end with a clear, concrete next step.',
    questionArchitecture: 'ask one open question at a time.',
    painExcavation: "go one layer deeper — ask 'what happens if you don't fix this?'",
    painQuantification: 'attach a number, cost, or timeline to the pain.',
    businessImpact: 'connect the problem to revenue, cost, or competitive risk.',
    urgencyTesting: 'test for a trigger event or deadline.',
    stakeholderDiscovery: "ask 'who else would need to weigh in?'",
    nextStepControl: 'propose a specific action with a date.',
    riskNaming: 'name the risk directly — deal drift, missing stakeholder, stalled timeline.',
    mutualPlan: 'define what both sides will do by when.',
    stakeholderAlignment: 'ensure multiple stakeholders are aligned or create urgency.',
    painValidation: 'distinguish real pain from casual interest.',
    stakeholderMapping: 'identify who else decides and their role.',
    decisionProcess: 'test for timeline, criteria, and process.',
    disqualification: "be willing to ask 'is this actually a priority?'",
  };
  return cues[dim] ?? 'tighten execution on this dimension.';
}
