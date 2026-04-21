// ════════════════════════════════════════════════════════════════
// Strategy V2 — Public API
//
// Single import surface for strategy-chat/index.ts:
//
//   import {
//     buildV2Prompt,
//     validateResponse,
//     auditResponse,
//     assembleRoutingEvidence,
//     isV2Enabled,
//   } from "../_shared/strategy-core/v2/index.ts";
//
// V2 is gated behind a feature flag: env var STRATEGY_V2_REASONING.
// When off, strategy-chat continues using the v1 mode-lock path.
// When on, strategy-chat dispatches via orchestrator above.
// ════════════════════════════════════════════════════════════════

export {
  assembleRoutingEvidence,
  auditResponse,
  buildV2Prompt,
  dispatch,
  validateResponse,
  type V2OrchestratorPrompt,
  type V2RoutingDecisionEvidence,
} from "./orchestrator.ts";

export {
  classifyAskShape,
  parseOverride,
  scoreLibrarySignal,
  type DispatchDecision,
  type DispatchSignals,
  type V2AskShape,
  type V2Mode,
  type V2Override,
} from "./operatorDispatcher.ts";

export {
  type QualityAuditResult,
} from "./qualityAudit.ts";

export {
  type RubricScores,
  type RubricDimension,
} from "./reasoningRubric.ts";

export {
  type WrongQuestionResult,
} from "./wrongQuestionGuard.ts";

/**
 * Feature flag check. Read from env, plus optional per-user/per-thread
 * override the caller can pass in. Default OFF — V1 path remains the
 * default until validation passes.
 */
export function isV2Enabled(args?: {
  userOverride?: boolean;
  threadOverride?: boolean;
}): boolean {
  if (args?.threadOverride === true) return true;
  if (args?.userOverride === true) return true;
  const envFlag = (Deno.env.get("STRATEGY_V2_REASONING") || "").toLowerCase();
  return envFlag === "true" || envFlag === "1" || envFlag === "on";
}
