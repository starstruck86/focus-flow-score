// ════════════════════════════════════════════════════════════════
// Strategy V2 — Orchestrator
//
// Single entry point for the V2 reasoning path. Composes:
//
//   1. Dispatcher → mode + ask shape + override + signal score
//   2. Prompt build → system prompt with mode/shape contracts + rubric
//   3. Provider call → hands off to caller (strategy-chat owns LLM call)
//   4. Wrong-question guard → ONE hard pre-send check, one regen budget
//   5. Async quality audit → fires after response sent, persists scores
//
// Returns everything the caller needs to:
//   - send the prompt to the provider
//   - validate the response
//   - persist evidence to routing_decision
//
// Critical: this orchestrator does NOT call the LLM itself. It builds
// the prompt, then the caller (strategy-chat/index.ts) calls the
// provider, then calls back into validateAndAudit() with the result.
// This keeps streaming, provider selection, fallback logic in the
// caller where it already lives.
// ════════════════════════════════════════════════════════════════

import {
  type DispatchDecision,
  type DispatchSignals,
  dispatch,
} from "./operatorDispatcher.ts";
import { buildV2SystemPrompt } from "./extendedReasoningContract.ts";
import { auditQuality, type QualityAuditResult } from "./qualityAudit.ts";
import { checkWrongQuestion, type WrongQuestionResult } from "./wrongQuestionGuard.ts";

export interface V2OrchestratorPrompt {
  decision: DispatchDecision;
  systemPrompt: string;
  userText: string; // cleaned (override stripped)
}

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
}

// ═══ Step 1: Build prompt ═══
export function buildV2Prompt(args: {
  rawUserText: string;
  signals: DispatchSignals;
  accountContext?: string;
  libraryContext?: string;
  resourceContextBlock?: string;
  workingThesisBlock?: string;
  resourceTitles?: string[];
  kiIds?: string[];
  kiTitles?: string[];
}): V2OrchestratorPrompt {
  const decision = dispatch({
    rawUserText: args.rawUserText,
    signals: args.signals,
  });

  // Audience hint — checked once, used by both prompt and rubric scoring
  const audienceMentioned =
    /\b(cfo|ceo|coo|cto|vp|director|champion|economic\s+buyer|technical\s+buyer|healthcare|fintech|retail|saas|manufacturing)\b/i
      .test(decision.cleanedUserText);

  const systemPrompt = buildV2SystemPrompt({
    decision,
    accountContext: args.accountContext,
    libraryContext: args.libraryContext,
    resourceContextBlock: args.resourceContextBlock,
    workingThesisBlock: args.workingThesisBlock,
    audienceMentioned,
    resourceTitles: args.resourceTitles,
    kiIds: args.kiIds,
    kiTitles: args.kiTitles,
  });

  return {
    decision,
    systemPrompt,
    userText: decision.cleanedUserText,
  };
}

// ═══ Step 2: Validate response (hard wrong-question check) ═══
export function validateResponse(args: {
  userPrompt: string;
  responseBody: string;
  priorTurnPrompt?: string;
}): WrongQuestionResult {
  return checkWrongQuestion(args);
}

// ═══ Step 3: Async audit (never blocks) ═══
export function auditResponse(args: {
  decision: DispatchDecision;
  body: string;
  hadLibraryHits: boolean;
  resourceTitles?: string[];
  kiIds?: string[];
  kiTitles?: string[];
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
    evidence.extension_flag =
      /\b(extended\s+(?:beyond|reasoning)|limited\s+library\s+signal|extended\s+—|extended\s+—)\b/i
        .test(args.audit.scores ? "" : "") ||
      undefined;
  }

  if (args.provider) evidence.provider = args.provider;
  if (args.model) evidence.model = args.model;
  if (typeof args.regenCount === "number") evidence.regen_count = args.regenCount;

  return evidence;
}

export { dispatch } from "./operatorDispatcher.ts";
