// ════════════════════════════════════════════════════════════════
// Strategy V2 — Reasoning Rubric
//
// The 5-step operator thinking sequence becomes a RUBRIC injected
// as quality criteria, NOT a forced output template. This is the
// key shift from V1: model writes naturally, rubric scores the
// result. Mode-aware so Mode C (general) doesn't get strangled by
// synthesis-mode framing.
//
// Rubric dimensions (from product brief, constraint #3):
//   1. correctness        — answers the actual question asked
//   2. operatorPOV        — has a point of view, not a survey
//   3. commercialSharpness — tied to pipeline/velocity/win rate/ACV/churn
//   4. decisionLogic      — IF/THEN or playbook the rep can execute
//   5. libraryLeverage    — uses library when available; flags extension when not
//   6. audienceFit        — adapted to audience/industry/situation when relevant
//
// Used by:
//   - extendedReasoningContract.ts (injected into system prompt)
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
  operatorPOV: "Operator POV — commits to a position, names tradeoffs, not a balanced survey",
  commercialSharpness:
    "Commercial sharpness — tied to pipeline, velocity, win rate, ACV, churn, payback, or cost of inaction",
  decisionLogic:
    "Decision logic — concrete IF/THEN, playbook, or numbered next moves the rep can execute",
  libraryLeverage:
    "Library leverage — uses your library when relevant; clearly flags extension when reasoning beyond it",
  audienceFit:
    "Audience fit — adapted to audience, industry, or situation when the ask requires it",
};

// ═══ Mode + ask-shape → which dimensions matter ═══
// Mode C (general) only enforces correctness + operatorPOV.
// Short-form skips synthesis dims that don't fit.
// Account briefs and 90-day plans get the full bar.
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

// ═══ Render rubric for prompt injection ═══
// Critically: phrased as "your output will be evaluated on" — NOT
// "you must produce sections X/Y/Z". This is the key V2 shift.
export function renderRubricForPrompt(
  dims: RubricDimension[],
): string {
  if (dims.length === 0) return "";
  const lines = dims.map((d, i) => `${i + 1}. ${RUBRIC_LABELS[d]}`);
  return `═══ QUALITY BAR (your output will be scored on these — not as required sections, just as the bar) ═══
${lines.join("\n")}

Write naturally and directly. Do not produce a section per dimension. Just hit the bar.`;
}

// ═══ Post-gen scoring ═══
// Heuristic, deterministic. Returns 0-1 per dimension. Used by
// qualityAudit. NEVER blocks generation — just persists evidence.
export interface RubricScores {
  correctness: number; // -1 if wrong-question detector handled separately
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
  "deal dies", "time-to-revenue", "forecast", "conversion rate",
  "quota", "attainment", "renewal risk", "net retention",
];

const POV_PHRASES = [
  "the dominant", "the highest-leverage", "the one thing",
  "the biggest", "what actually matters", "the real driver",
  "the real lever", "the single biggest", "the core", "the key",
  "matters more than", "matters less than", "weighted higher",
  "weighted lower", "instead of", "not because", "deprioritize",
  "table stakes", "this is noise", "ignore",
];

const DECISION_LOGIC_MARKERS = [
  /\bif\b[^.]{3,80}\bthen\b/i,
  /\bwhen\b[^.]{3,80}\bthen\b/i,
  /\bnext move\b/i,
  /\bdominant move\b/i,
  /\bplaybook:/i,
  /^\s*\d+\.\s+/m, // numbered steps
  /\bstep\s+\d+\b/i,
];

const FLUFF_PHRASES = [
  "ask better questions", "build trust", "build rapport",
  "be authentic", "be curious", "be confident", "observe tone",
  "active listening", "stay curious", "show empathy",
  "mirror their language", "lean in", "really listen",
];

const EXTENSION_FLAG_RE =
  /\b(extended\s+(?:beyond|reasoning)|limited\s+library\s+signal|extended\s+\u2014|extended\s+—|model[\s-]extended)\b/i;

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

  // commercialSharpness
  let commercialHits = 0;
  for (const term of COMMERCIAL_TERMS) {
    if (lower.includes(term)) commercialHits++;
  }
  const commercialSharpness = clamp01(commercialHits / 3);

  // operatorPOV
  let povHits = 0;
  for (const p of POV_PHRASES) {
    if (lower.includes(p)) povHits++;
  }
  const fluffHits = FLUFF_PHRASES.filter((p) => lower.includes(p)).length;
  const operatorPOV = clamp01((povHits / 2) - (fluffHits * 0.4));

  // decisionLogic
  let decisionHits = 0;
  for (const re of DECISION_LOGIC_MARKERS) {
    if (re.test(text)) decisionHits++;
  }
  const decisionLogic = clamp01(decisionHits / 2);

  // libraryLeverage
  let libraryLeverage: number;
  if (args.hadLibraryHits) {
    // Should reference library; cite by name or short id pattern
    const cites = (text.match(/\b(KI\[|RESOURCE\[|per your\s+\w+|from your\s+(?:KI|playbook|library|resources?))\b/gi) || []).length;
    libraryLeverage = clamp01(cites / 2);
  } else {
    // Should flag extension
    libraryLeverage = EXTENSION_FLAG_RE.test(text) ? 1 : 0.4;
  }

  // audienceFit (only meaningful when ask requires it)
  const audienceFit = args.audienceMentioned
    ? clamp01(
      (lower.match(/\b(cfo|ceo|coo|cto|vp|director|champion|healthcare|fintech|retail|saas|manufacturing)\b/gi)?.length || 0) / 1,
    )
    : 0.7; // neutral score when not applicable

  // correctness scored separately by wrongQuestionGuard; default to 1 here
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
  const applicable = dims.map((d) => scoreMap[d]);
  const overall = applicable.length
    ? applicable.reduce((a, b) => a + b, 0) / applicable.length
    : 0;

  // Word-count floor: very short outputs auto-pass dims that need length
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
