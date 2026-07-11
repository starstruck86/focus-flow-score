// ════════════════════════════════════════════════════════════════
// Strategy V2 — Orchestrator
//
// Shared runtime helpers for the V2 reasoning path. Exposes:
//
//   1. Dispatcher → mode + ask shape + override + signal score
//   2. Wrong-question diagnostic → post-generation shadow telemetry
//   3. Async quality audit → fires after response sent, persists scores
//   4. Routing evidence assembly → persists the V2 decision and outcomes
//
// Returns everything the caller needs to:
//   - validate the response
//   - persist evidence to routing_decision
//
// Critical: this orchestrator does NOT build prompts or call the LLM.
// The caller (strategy-chat/index.ts) owns semantic prompt composition,
// provider selection, streaming, and fallback behavior; this module owns
// dispatch, response validation/audit, and routing evidence assembly.
// ════════════════════════════════════════════════════════════════

import {
  dispatch,
  type DispatchDecision,
  type DispatchSignals,
} from "./operatorDispatcher.ts";
import { auditQuality, type QualityAuditResult } from "./qualityAudit.ts";
import {
  checkWrongQuestion,
  type WrongQuestionResult,
} from "./wrongQuestionGuard.ts";

export interface V2RoutingDecisionEvidence {
  version: "v2";
  mode: string;
  ask_shape: string;
  override: string | null;
  signal_score: number;
  retrieval: {
    strong_resource_hits: number;
    strong_ki_hits: number;
    total_hits: number;
    has_entity_context: boolean;
    mentions_known_entity: boolean;
  };
  reasoning: string;
  // Filled in after generation:
  wrong_question_score?: number;
  wrong_question_passed?: boolean;
  wrong_question_reason?: string;
  extension_flag?: boolean;
  quality_score?: number;
  quality_flags?: string[];
  quality_passed?: boolean;
  provider?: string;
  model?: string;
  regen_count?: number;
  // Phase 3: explicit Claude fallback flag — fires when synthesis_framework+
  // A_strong was routed to Claude but the call fell back to OpenAI. NEVER
  // silent. Treated as a risk in validation reports.
  claude_fallback?: boolean;
  // Phase 3: contract-drift sentinel — assembled prompt was missing one or
  // more of the 6 non-negotiables for strong-signal synthesis. Logged only.
  contract_drift?: { missing: string[] } | null;
}

// ═══ Step 1: Post-generation wrong-question diagnostic (shadow) ═══
export function validateResponse(args: {
  userPrompt: string;
  responseBody: string;
  priorTurnPrompt?: string;
}): WrongQuestionResult {
  return checkWrongQuestion(args);
}

// ═══ Step 2: Async audit (never blocks) ═══
export function auditResponse(args: {
  decision: DispatchDecision;
  body: string;
  hadLibraryHits: boolean;
  resourceTitles?: string[];
  kiIds?: string[];
  kiTitles?: string[];
  cardIds?: string[];
}): QualityAuditResult {
  const audienceMentioned =
    /\b(cfo|ceo|coo|cto|vp|director|champion|economic\s+buyer|technical\s+buyer|healthcare|fintech|retail|saas|manufacturing)\b/i
      .test(args.decision.cleanedUserText);

  return auditQuality({
    body: args.body,
    mode: args.decision.mode,
    askShape: args.decision.askShape,
    hadLibraryHits: args.hadLibraryHits,
    audienceMentioned,
    resourceTitles: args.resourceTitles,
    kiIds: args.kiIds,
    kiTitles: args.kiTitles,
    cardIds: args.cardIds,
  });
}

// ═══ Helper: assemble persisted evidence for routing_decision ═══
export function assembleRoutingEvidence(args: {
  decision: DispatchDecision;
  signals: DispatchSignals;
  wrongQuestion?: WrongQuestionResult;
  audit?: QualityAuditResult;
  provider?: string;
  model?: string;
  regenCount?: number;
  // Phase 3 additions
  intendedProvider?: string;
  fallbackUsed?: boolean;
  contractDrift?: { missing: string[] } | null;
}): V2RoutingDecisionEvidence {
  const { decision, signals } = args;
  const evidence: V2RoutingDecisionEvidence = {
    version: "v2",
    mode: decision.mode,
    ask_shape: decision.askShape,
    override: decision.override,
    signal_score: decision.signalScore,
    retrieval: {
      strong_resource_hits: signals.strongResourceHits,
      strong_ki_hits: signals.strongKiHits,
      total_hits: signals.totalHits,
      has_entity_context: signals.hasEntityContext,
      mentions_known_entity: signals.mentionsKnownEntity,
    },
    reasoning: decision.reasoning,
  };

  if (args.wrongQuestion) {
    evidence.wrong_question_passed = args.wrongQuestion.passed;
    evidence.wrong_question_score = args.wrongQuestion.score;
    evidence.wrong_question_reason = args.wrongQuestion.reason;
  }

  if (args.audit) {
    evidence.quality_score = args.audit.scores.overall;
    evidence.quality_flags = args.audit.flags;
    evidence.quality_passed = args.audit.passed;
  }

  if (args.provider) evidence.provider = args.provider;
  if (args.model) evidence.model = args.model;
  if (typeof args.regenCount === "number") {
    evidence.regen_count = args.regenCount;
  }

  // Phase 3: explicit Claude fallback flag. Fires when synthesis_framework +
  // A_strong was intended-routed to Claude (anthropic) but the actual provider
  // ended up being something else. NEVER silent — surfaces as a risk in
  // routing_decision.v2.claude_fallback.
  const intendedClaude = args.intendedProvider === "anthropic" &&
    decision.askShape === "synthesis_framework" &&
    decision.mode === "A_strong";
  if (
    intendedClaude &&
    (args.fallbackUsed === true ||
      (args.provider && args.provider !== "anthropic"))
  ) {
    evidence.claude_fallback = true;
  }

  // Phase 3: contract-drift sentinel
  if (args.contractDrift && args.contractDrift.missing.length > 0) {
    evidence.contract_drift = args.contractDrift;
  }

  return evidence;
}

export { dispatch } from "./operatorDispatcher.ts";
