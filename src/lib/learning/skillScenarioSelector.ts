/**
 * Skill-Shaped Scenario Selector
 *
 * Instead of random filtering by skillFocus label, this selects scenarios
 * based on explicit skill constraints: style, answer expectations, and pressure traits.
 * Scores each scenario against the user's blocker/focusPattern to bias selection.
 */

import type { DojoScenario, SkillFocus } from '@/lib/dojo/scenarios';
import { getRandomScenario, SCENARIOS } from '@/lib/dojo/scenarios';
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

// ── Scenario scoring signals ──────────────────────────────────────

/**
 * Maps blockers/focusPatterns to keywords that, when found in scenario
 * context or objection text, indicate the scenario exercises that weakness.
 */
const BLOCKER_SCENARIO_SIGNALS: Record<string, string[]> = {
  // Executive Response blockers
  brevity: ['30-second', '2 minutes', 'under a minute', 'give me the', 'bottom line', 'concretely'],
  numberLed: ['ROI', 'payback', 'math', '3x', 'cost', 'margin', 'investment', '$', 'revenue'],
  priorityAnchoring: ['board priority', 'CAC', 'LTV', 'retention', 'strategy', 'shifted', 'pivot'],
  executivePresence: ['skeptic', 'heard this before', 'pitch a dozen', 'what\'s actually different', 'category'],
  // Objection Handling blockers
  composure: ['waste of my time', 'competitor already', 'mutiny', 'snaps'],
  isolation: ['not interested', 'just send me', 'think about it', 'circle back'],
  reframing: ['cheaper', 'expensive', 'cost', '40%', 'pricing', 'budget'],
  proof: ['everyone claims', 'heard this before', 'what\'s different', 'prove'],
  // Discovery blockers
  painExcavation: ['fine', 'exploring', 'nice to have', 'not unhappy', 'just exploring'],
  painQuantification: ['some customers', 'engagement rates', 'flat', 'around 18%', 'don\'t track'],
  // Deal Control blockers
  nextStepControl: ['think about it', 'get back to you', 'circle back', 'digest', 'reach out when ready'],
  riskNaming: ['gone dark', 'silent', 'slammed', 'behind on timeline', 'push everything back'],
  // Qualification blockers
  painValidation: ['nice to have', 'exploring options', 'not unhappy', 'market research'],
  disqualification: ['no budget authority', 'love this', 'enthusiastic', 'no commitment pilot'],
  // Focus patterns (common names)
  too_much_setup: ['30-second', '2 minutes', 'bottom line', 'concretely', 'don\'t give me a sales pitch'],
  isolate_before_answering: ['not interested', 'send me a deck', 'think about it'],
};

interface ScoredScenario {
  scenario: DojoScenario;
  score: number;
  matchReason: string;
}

/**
 * Score a scenario against the session's blocker/focusPattern signals.
 */
function scoreScenario(
  scenario: DojoScenario,
  session: SkillSession,
  constraints: ScenarioConstraints,
): ScoredScenario {
  let score = 0;
  let matchReason = 'baseline';
  const text = `${scenario.context} ${scenario.objection}`.toLowerCase();

  // Score by topBlocker keyword matches
  if (session.topBlocker) {
    const signals = BLOCKER_SCENARIO_SIGNALS[session.topBlocker];
    if (signals) {
      const hits = signals.filter(kw => text.includes(kw.toLowerCase()));
      if (hits.length > 0) {
        score += hits.length * 10;
        matchReason = `blocker:${session.topBlocker} (${hits.length} signal hits)`;
      }
    }
  }

  // Score by focusPattern keyword matches
  if (session.focusPattern) {
    const signals = BLOCKER_SCENARIO_SIGNALS[session.focusPattern];
    if (signals) {
      const hits = signals.filter(kw => text.includes(kw.toLowerCase()));
      if (hits.length > 0) {
        score += hits.length * 7;
        if (score > 0 && matchReason === 'baseline') {
          matchReason = `focusPattern:${session.focusPattern} (${hits.length} signal hits)`;
        }
      }
    }
  }

  // Score by pressure trait matches in scenario text
  for (const trait of constraints.pressureTraits) {
    if (text.includes(trait.toLowerCase())) {
      score += 3;
    }
  }

  // Slight difficulty alignment bonus
  if (session.scenarioType && scenario.difficulty === session.scenarioType) {
    score += 2;
  }

  return { scenario, score, matchReason };
}

// ── Scenario selection metadata ───────────────────────────────────

export interface ScenarioSelection {
  scenario: DojoScenario;
  constraints: ScenarioConstraints;
  selectionReason: string;
  taughtDimensions: string[];
}

/**
 * Select a scenario shaped by the skill session's context.
 * Scores all matching scenarios against blocker/focusPattern signals
 * and picks the highest-scoring one (with randomization among ties).
 */
export function selectSkillShapedScenario(
  session: SkillSession,
  availableScenarios?: DojoScenario[],
): ScenarioSelection {
  const constraints = SKILL_SCENARIO_CONSTRAINTS[session.skillId];
  const pool = (availableScenarios ?? SCENARIOS).filter(
    s => s.skillFocus === session.skillId,
  );

  // If no scenarios match the skill, fall back
  if (pool.length === 0) {
    return {
      scenario: getRandomScenario(session.skillId),
      constraints,
      selectionReason: 'fallback: no scenarios in pool',
      taughtDimensions: getDimensionsForSkill(session.skillId),
    };
  }

  // Score every scenario
  const scored = pool.map(s => scoreScenario(s, session, constraints));
  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0].score;

  // If no signal matched (all scores 0), fall back to weighted random
  if (topScore === 0) {
    const pick = pool[Math.floor(Math.random() * pool.length)];
    return {
      scenario: pick,
      constraints,
      selectionReason: `random: no blocker/pattern signals matched`,
      taughtDimensions: getDimensionsForSkill(session.skillId),
    };
  }

  // Pick randomly among top-scoring ties
  const topTier = scored.filter(s => s.score === topScore);
  const winner = topTier[Math.floor(Math.random() * topTier.length)];

  return {
    scenario: winner.scenario,
    constraints,
    selectionReason: `shaped: ${winner.matchReason} (score ${winner.score})`,
    taughtDimensions: getDimensionsForSkill(session.skillId),
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
