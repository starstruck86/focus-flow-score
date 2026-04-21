// ════════════════════════════════════════════════════════════════
// Strategy V2 — Single Async Quality Audit
//
// Replaces 4 V1 post-gen guards (operator-reasoning, citation,
// body/appendix consistency, application-layer). NEVER blocks.
// NEVER triggers regen. Persists scores to routing_decision so
// we can debug, surface a quality indicator in the UI, and tune
// the rubric over time.
//
// Run AFTER the response has been streamed/sent to the client.
// ════════════════════════════════════════════════════════════════

import type { V2AskShape, V2Mode } from "./operatorDispatcher.ts";
import { type RubricScores, scoreRubric } from "./reasoningRubric.ts";

export interface QualityAuditResult {
  scores: RubricScores;
  flags: string[]; // human-readable diagnostic flags
  passed: boolean; // overall >= 0.5
}

export function auditQuality(args: {
  body: string;
  mode: V2Mode;
  askShape: V2AskShape;
  hadLibraryHits: boolean;
  audienceMentioned: boolean;
}): QualityAuditResult {
  const scores = scoreRubric(args);
  const flags: string[] = [];

  if (scores.operatorPOV < 0.5) flags.push("low_operator_pov");
  if (scores.decisionLogic < 0.5 && args.askShape !== "short_form" && args.mode !== "C_general") {
    flags.push("missing_decision_logic");
  }
  if (
    scores.commercialSharpness < 0.5 &&
    args.askShape !== "short_form" &&
    args.askShape !== "general" &&
    args.mode !== "C_general"
  ) {
    flags.push("low_commercial_framing");
  }
  if (args.hadLibraryHits && scores.libraryLeverage < 0.5) {
    flags.push("library_underused");
  }
  if (!args.hadLibraryHits && args.mode === "D_thin" && scores.libraryLeverage < 0.5) {
    flags.push("missing_extension_flag");
  }

  return {
    scores,
    flags,
    passed: scores.overall >= 0.6,
  };
}
