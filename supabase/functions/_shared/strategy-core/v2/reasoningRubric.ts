// ════════════════════════════════════════════════════════════════
// Strategy V2 — Reasoning Rubric (Phase 2: weighted + sharpened)
//
// Phase 2 changes vs Phase 1:
//   - Weighted scoring (operatorPOV + decisionLogic dominate)
//   - Harsher fluff penalty
//   - Library-underuse penalty when hits exist
//   - Reward explicit commercial consequence framing
//   - Reward explicit "what matters / what doesn't" calls
//   - Punish balanced-survey patterns
//
// Used by:
//   - extendedReasoningContract.ts (rubric injected into prompt)
//   - qualityAudit.ts (post-gen scoring)
// ════════════════════════════════════════════════════════════════

import type { V2AskShape, V2Mode } from "./operatorDispatcher.ts";

export type RubricDimension =
  | "correctness"
  | "operatorPOV"
  | "commercialSharpness"
  | "decisionLogic"
  | "libraryLeverage"
  | "audienceFit";

export const RUBRIC_LABELS: Record<RubricDimension, string> = {
  correctness: "Correctness — answers the exact question asked",
  operatorPOV:
    "Operator POV — commits to a position with phrases like 'the dominant move is…' / 'what actually matters is…' / 'I'd weight X over Y because…'. Names what's noise. NOT a balanced survey.",
  commercialSharpness:
    "Commercial sharpness — every load-bearing claim ties to pipeline, velocity, win rate, ACV, churn, payback, cost of inaction, or deal-slip risk. Vague benefits ('builds trust') do NOT count.",
  decisionLogic:
    "Decision logic — concrete IF/THEN, prioritized numbered next moves the rep can run this week. Each move has a why tied to a commercial outcome.",
  libraryLeverage:
    "Library leverage — when library has signal, anchor reasoning in it explicitly ('per your KI on…', 'from your playbook on…'). When extending beyond it, flag once at the end.",
  audienceFit:
    "Audience fit — adapted to the audience, industry, situation, or stakeholder named in the ask.",
};

// ═══ Mode + ask-shape → which dimensions matter ═══
export function rubricDimensionsFor(
  mode: V2Mode,
  askShape: V2AskShape,
): RubricDimension[] {
  if (mode === "C_general") return ["correctness", "operatorPOV"];

  if (askShape === "short_form") {
    return ["correctness", "operatorPOV", "audienceFit"];
  }

  if (askShape === "rewrite_audience") {
    return ["correctness", "operatorPOV", "commercialSharpness", "audienceFit"];
  }

  if (askShape === "evaluation_grading") {
    return [
      "correctness",
      "operatorPOV",
      "decisionLogic",
      "libraryLeverage",
    ];
  }

  // account_brief, ninety_day_plan, synthesis_framework, general (with signal): full bar
  return [
    "correctness",
    "operatorPOV",
    "commercialSharpness",
    "decisionLogic",
    "libraryLeverage",
    "audienceFit",
  ];
}

// ═══ Phase 2: weights (operatorPOV + decisionLogic dominate) ═══
const DIMENSION_WEIGHTS: Record<RubricDimension, number> = {
  correctness: 1.0,
  operatorPOV: 2.5,        // doubled — the core failure mode
  commercialSharpness: 1.8, // up from 1.0
  decisionLogic: 2.0,      // up from 1.0
  libraryLeverage: 1.2,
  audienceFit: 1.0,
};

// ═══ Render rubric for prompt injection ═══
export function renderRubricForPrompt(
  dims: RubricDimension[],
): string {
  if (dims.length === 0) return "";
  const lines = dims.map((d, i) => {
    const w = DIMENSION_WEIGHTS[d];
    const weightTag = w >= 2 ? " [HEAVILY WEIGHTED]" : "";
    return `${i + 1}. ${RUBRIC_LABELS[d]}${weightTag}`;
  });
  return `═══ QUALITY BAR (your output is scored on these) ═══
${lines.join("\n")}

Operator POV and decision logic are weighted heaviest. A balanced survey with no committed position fails. Generic advice with no commercial framing fails. Awareness without executable moves fails.`;
}

// ═══ Post-gen scoring ═══
export interface RubricScores {
  correctness: number;
  operatorPOV: number;
  commercialSharpness: number;
  decisionLogic: number;
  libraryLeverage: number;
  audienceFit: number;
  overall: number; // weighted average across applicable dims
}

const COMMERCIAL_TERMS = [
  "pipeline", "velocity", "win rate", "win-rate", "acv", "arr", "churn",
  "expansion", "payback", "cost of inaction", "deal stalls", "deal slips",
  "deal dies", "deal-slip", "time-to-revenue", "forecast", "conversion rate",
  "quota", "attainment", "renewal risk", "net retention", "no-decision",
  "ramp", "time-to-first-deal", "no decision", "stalls",
];

const POV_PHRASES = [
  "the dominant", "the highest-leverage", "the one thing",
  "the biggest", "what actually matters", "the real driver",
  "the real lever", "the single biggest", "the core lever",
  "the key lever", "matters more than", "matters less than",
  "weighted higher", "weighted lower", "instead of", "not because",
  "deprioritize", "table stakes", "this is noise", "ignore",
  "i'd lead with", "i would lead with", "i'd weight", "i would weight",
  "skip ", "avoid ", "don't ", "don't do",
  "the call is", "my call", "commit to",
];

const DECISION_LOGIC_MARKERS = [
  /\bif\b[^.]{3,80}\bthen\b/i,
  /\bwhen\b[^.]{3,80}\bthen\b/i,
  /\bnext move\b/i,
  /\bdominant move\b/i,
  /\bplaybook:/i,
  /^\s*\d+\.\s+/m, // numbered steps
  /\bstep\s+\d+\b/i,
  /\bthis week\b/i,
  /\bby (?:monday|tuesday|wednesday|thursday|friday|end of week|eow)\b/i,
];

const FLUFF_PHRASES = [
  "ask better questions", "build trust", "build rapport",
  "be authentic", "be curious", "be confident", "observe tone",
  "active listening", "stay curious", "show empathy",
  "mirror their language", "lean in", "really listen",
  "be a trusted advisor", "add value", "bring value",
  "tell a story", "be human",
];

// Phase 2: detect balanced-survey patterns (operatorPOV killer)
const BALANCED_SURVEY_MARKERS = [
  /\bon (?:the )?one hand\b[^.]{0,200}\bon the other hand\b/i,
  /\bboth approaches have merit\b/i,
  /\bdepends on (?:your |the )?context\b/i,
  /\bit depends\b/i,
  /\bthere are (?:several|many|multiple) (?:ways|approaches|options)\b/i,
];

const EXTENSION_FLAG_RE =
  /\b(extended\s+(?:beyond|reasoning)|limited\s+library\s+signal|extended\s+\u2014|extended\s+—|model[\s-]extended)\b/i;

// Phase 2: explicit "what doesn't matter" markers
const WHAT_DOESNT_MATTER_MARKERS = [
  /\bignore\b/i,
  /\btable stakes\b/i,
  /\bdeprioriti[sz]e\b/i,
  /\bskip\b/i,
  /\bnoise\b/i,
  /\bdon't (?:focus|spend|waste)\b/i,
  /\bdoesn't move (?:the |your )?(?:number|deal|needle)\b/i,
  /\bnot worth\b/i,
];

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function scoreRubric(args: {
  body: string;
  mode: V2Mode;
  askShape: V2AskShape;
  hadLibraryHits: boolean;
  audienceMentioned: boolean;
}): RubricScores {
  const text = args.body || "";
  const lower = text.toLowerCase();
  const wc = text.trim().split(/\s+/).filter(Boolean).length;

  // commercialSharpness — Phase 2: stricter, needs 3+ commercial terms for full credit
  let commercialHits = 0;
  for (const term of COMMERCIAL_TERMS) {
    if (lower.includes(term)) commercialHits++;
  }
  const commercialSharpness = clamp01(commercialHits / 4);

  // operatorPOV — Phase 2: harder fluff penalty + balanced-survey penalty
  let povHits = 0;
  for (const p of POV_PHRASES) {
    if (lower.includes(p)) povHits++;
  }
  const fluffHits = FLUFF_PHRASES.filter((p) => lower.includes(p)).length;
  const balancedSurveyHits = BALANCED_SURVEY_MARKERS.filter((re) => re.test(text)).length;
  const whatDoesntMatterHits = WHAT_DOESNT_MATTER_MARKERS.filter((re) => re.test(text)).length;

  const operatorPOV = clamp01(
    (povHits / 3) +
    (whatDoesntMatterHits >= 1 ? 0.25 : 0) -
    (fluffHits * 0.3) -
    (balancedSurveyHits * 0.4),
  );

  // decisionLogic — Phase 2: needs 2+ markers for full credit, numbered list strongly weighted
  let decisionHits = 0;
  for (const re of DECISION_LOGIC_MARKERS) {
    if (re.test(text)) decisionHits++;
  }
  const decisionLogic = clamp01(decisionHits / 3);

  // libraryLeverage — Phase 2: when hits exist, require 2+ explicit references
  let libraryLeverage: number;
  if (args.hadLibraryHits) {
    const cites = (text.match(/\b(KI\[|RESOURCE\[|per your\s+\w+|from your\s+(?:KI|playbook|library|resources?)|your library on|your KI on)\b/gi) || []).length;
    libraryLeverage = clamp01(cites / 3); // harder bar than Phase 1
  } else {
    libraryLeverage = EXTENSION_FLAG_RE.test(text) ? 1 : 0.4;
  }

  // audienceFit
  const audienceFit = args.audienceMentioned
    ? clamp01(
      (lower.match(/\b(cfo|ceo|coo|cto|vp|director|champion|healthcare|fintech|retail|saas|manufacturing)\b/gi)?.length || 0) / 1,
    )
    : 0.7;

  const correctness = 1;

  const dims = rubricDimensionsFor(args.mode, args.askShape);
  const scoreMap: Record<RubricDimension, number> = {
    correctness,
    operatorPOV,
    commercialSharpness,
    decisionLogic,
    libraryLeverage,
    audienceFit,
  };

  // Phase 2: weighted average instead of plain mean
  let weightedSum = 0;
  let weightTotal = 0;
  for (const d of dims) {
    const w = DIMENSION_WEIGHTS[d];
    weightedSum += scoreMap[d] * w;
    weightTotal += w;
  }
  const overall = weightTotal > 0 ? weightedSum / weightTotal : 0;

  // Word-count floor
  if (wc < 60 && args.askShape !== "short_form") {
    return {
      correctness,
      operatorPOV,
      commercialSharpness,
      decisionLogic,
      libraryLeverage,
      audienceFit,
      overall: 0.5,
    };
  }

  return {
    correctness,
    operatorPOV,
    commercialSharpness,
    decisionLogic,
    libraryLeverage,
    audienceFit,
    overall: clamp01(overall),
  };
}
