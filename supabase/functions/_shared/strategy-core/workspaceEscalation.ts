// ════════════════════════════════════════════════════════════════
// Strategy Core — W7 Escalation Rules (shadow-only)
//
// Evaluates `WorkspaceContract.escalationRules` after W6 gate
// execution and emits structured promotion/escalation suggestions.
//
// MVP boundaries (do NOT relax without a contract change):
//
//   • Advisory only — every suggestion carries `shadow: true`.
//     W7 NEVER routes the user, NEVER mutates output, NEVER blocks,
//     NEVER retries.
//
//   • Pure — no I/O, no model calls. Telemetry emission is the
//     caller's job (use `logEscalationSuggestions`).
//
//   • Non-throwing — evaluators that throw are caught and logged
//     as `error` confidence; the chat turn continues.
//
//   • Trigger-driven — a rule fires only when its specific trigger
//     signal is detected. No suggestion is ever fabricated to "look
//     helpful" — silence is the correct output when triggers are
//     absent.
//
// W8 (enforced gates) and beyond build on top of W7 telemetry.
// ════════════════════════════════════════════════════════════════

import type {
  CitationCheckResult,
} from "./citationEnforcement.ts";
import type {
  CalibrationConfidence as W65CalibrationConfidence,
  CalibrationResult,
  CalibrationVerdict,
} from "./libraryCalibration.ts";
import type {
  RetrievalDecisionLog,
} from "./retrievalEnforcement.ts";
import type {
  EscalationAction,
  EscalationRule,
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";
import type {
  GateRunSummary,
} from "./workspaceGateRunner.ts";

// ─── Types ────────────────────────────────────────────────────────

export type EscalationSurface = "strategy-chat" | "run-task";

export type EscalationConfidence = "low" | "medium" | "high";

export interface EscalationInputs {
  /** Resolved workspace contract (W1). */
  contract: WorkspaceContract;
  /** Final assistant/task output text the user will see. */
  assistantText: string;
  /**
   * The user prompt that triggered this turn. Many escalation
   * triggers are user-intent-driven (e.g. "develop option 2").
   * Optional — when absent, intent-based rules can still fire from
   * output signals alone, but with lower confidence.
   */
  userPrompt?: string;
  /** W6 gate run summary. */
  gateSummary?: GateRunSummary | null;
  /** W5 citation check result. */
  citationCheck?: CitationCheckResult | null;
  /** W3 retrieval decision telemetry. */
  retrievalDecision?: RetrievalDecisionLog | null;
  /** Library hits actually injected into context. */
  libraryHits?: Array<{ id: string; title: string }>;
  /** runTask only — task type / run id (for telemetry correlation). */
  taskType?: string;
  runId?: string;
}

export interface EscalationSuggestion {
  /** Stable id from the contract rule (e.g. `brainstorm.escalate.refine`). */
  id: string;
  sourceWorkspace: WorkspaceKey;
  targetWorkspace: WorkspaceKey;
  action: EscalationAction;
  /** Verbatim trigger text from the contract. */
  trigger: string;
  /** Human-readable reason for emitting this suggestion. */
  reason: string;
  confidence: EscalationConfidence;
  /** Always true in W7. */
  shadow: true;
}

export interface EscalationRunSummary {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: EscalationSurface;
  taskType?: string;
  runId?: string;
  /** All emitted suggestions (may be empty). */
  suggestions: EscalationSuggestion[];
  /** Aggregate counts for fast dashboard reads. */
  totals: {
    rulesEvaluated: number;
    suggestionsEmitted: number;
  };
}

// ─── Tiny helpers ─────────────────────────────────────────────────

const lower = (s: string) => (s ?? "").toLowerCase();

function any(text: string, needles: readonly (string | RegExp)[]): boolean {
  const t = text;
  for (const n of needles) {
    if (typeof n === "string") {
      if (t.includes(n)) return true;
    } else if (n.test(t)) {
      return true;
    }
  }
  return false;
}

function hasFailedGate(
  gateSummary: GateRunSummary | null | undefined,
  checkRefs: readonly string[],
): boolean {
  if (!gateSummary?.results) return false;
  const wanted = new Set(checkRefs);
  return gateSummary.results.some(
    (r) => r.outcome === "fail" && wanted.has(r.checkRef),
  );
}

// ─── Registry ─────────────────────────────────────────────────────
//
// Each evaluator inspects the available signals and either returns
// `null` (rule silent) or a partial suggestion result (reason +
// confidence). The dispatcher fills in the contract-level fields
// (id, source, target, action, trigger, shadow).

type EvalResult = { reason: string; confidence: EscalationConfidence } | null;
type Evaluator = (inp: EscalationInputs) => EvalResult;

/** Detect "develop / expand / refine option N" intent in user prompt. */
function detectDevelopOption(prompt: string): boolean {
  if (!prompt) return false;
  const p = lower(prompt);
  return any(p, [
    /develop\s+(option|angle|idea|#?\d)/,
    /expand\s+(on\s+)?(option|angle|idea|#?\d)/,
    /flesh\s+out/,
    /go\s+deeper\s+on/,
    /pick\s+option/,
    /(let'?s|let us)\s+(go\s+with|run\s+with|use)\s+/,
    /sharpen\s+(this|that|option)/,
    /tighten\s+(this|that)/,
    /rewrite\s+(this|that)/,
  ]);
}

function detectEvidenceAsk(prompt: string): boolean {
  if (!prompt) return false;
  const p = lower(prompt);
  return any(p, [
    "is this true",
    "is that true",
    "find evidence",
    "back this up",
    "back that up",
    "any evidence",
    "any data",
    "any sources",
    "show me sources",
    "cite a source",
    "citation",
    "do we know",
    /verify\s+(this|that)/,
    /prove\s+(this|that|it)/,
  ]);
}

function detectDeliverableAsk(prompt: string, output: string): boolean {
  const p = lower(prompt);
  const o = lower(output);
  const promptHit = any(p, [
    "deliverable",
    "draft me",
    "write me",
    "build me",
    /create\s+(an?|the)\s+(brief|plan|deck|email|doc|document|artifact)/,
    /turn\s+(this|that)\s+into\s+(an?|the)/,
    "make a brief",
    "make a plan",
    "make a deck",
    "send-ready",
    "ready to send",
  ]);
  // Output signal: explicit deliverable scaffolding the model produced.
  const outputHit = any(o, [
    /\bdeliverable\b/,
    /## (executive summary|proposal|plan|brief|recommendation)/,
  ]);
  return promptHit || outputHit;
}

function detectBrainstormAsk(prompt: string): boolean {
  if (!prompt) return false;
  const p = lower(prompt);
  return any(p, [
    "brainstorm",
    "what are some options",
    "give me options",
    "what are the angles",
    "what other angles",
    /alternat(ive|e)\s+(angles?|approaches?|ideas?)/,
    "different angles",
    "ideate",
  ]);
}

function detectOngoingWorkSignal(prompt: string, output: string): boolean {
  const p = lower(prompt);
  const o = lower(output);
  return any(p, [
    "ongoing",
    "track this",
    "keep working on",
    /this\s+(deal|account|project)\s+(is|will\s+be)\s+ongoing/,
    "long-running",
  ]) || any(o, [
    /this\s+(deal|account)\s+is\s+ongoing/,
    /\bmulti[-\s]?week\b/,
    /\bmulti[-\s]?month\b/,
  ]);
}

function detectFactsGapInRefine(
  inp: EscalationInputs,
): boolean {
  // Refine -> Deep Research: triggered when the model couldn't refine
  // because facts are missing. Signals:
  //   1. Output explicitly flags missing facts.
  //   2. The W5 citation check produced unverified-citation issues.
  const o = lower(inp.assistantText);
  const textSignal = any(o, [
    "i don't have the facts",
    "i don't have facts",
    "missing facts",
    "would need more info",
    "can't verify",
    "cannot verify",
    "no source",
    "needs sourcing",
    "needs evidence",
  ]);
  const citationSignal = (inp.citationCheck?.issues ?? []).some(
    (i) => i.code === "unverified_citation",
  );
  return textSignal || citationSignal;
}

const REGISTRY: Record<string, Evaluator> = {
  // ─── Brainstorm ─────────────────────────────────────────────────
  "brainstorm.escalate.refine": ({ userPrompt, assistantText }) => {
    const promptHit = detectDevelopOption(userPrompt ?? "");
    if (promptHit) {
      return {
        reason: "User signaled they want to develop / sharpen a chosen option.",
        confidence: "high",
      };
    }
    // Output-only fallback: the model itself called out a chosen
    // option to develop further (low-confidence advisory).
    const o = lower(assistantText);
    if (any(o, [/recommended option:/, /best bet:/, /go deeper on/])) {
      return {
        reason:
          "Output highlights a single option as the recommendation; refining it is the natural next step.",
        confidence: "low",
      };
    }
    return null;
  },
  "brainstorm.escalate.deep_research": ({ userPrompt }) => {
    return detectEvidenceAsk(userPrompt ?? "")
      ? {
        reason: "User asked whether the options are factually backed.",
        confidence: "high",
      }
      : null;
  },
  "brainstorm.escalate.artifacts": ({ userPrompt, assistantText }) => {
    return detectDeliverableAsk(userPrompt ?? "", assistantText)
      ? {
        reason: "User or output indicates a finished deliverable is the goal.",
        confidence: "medium",
      }
      : null;
  },

  // ─── Deep Research ──────────────────────────────────────────────
  "deep_research.escalate.artifacts": ({ userPrompt, assistantText }) => {
    // Specific to research: findings imply a deliverable is wanted.
    if (detectDeliverableAsk(userPrompt ?? "", assistantText)) {
      return {
        reason: "Findings imply a structured deliverable is the next move.",
        confidence: "high",
      };
    }
    // Output-only signal: the research wraps with an explicit
    // recommendation/next-step block — likely actionable.
    const o = lower(assistantText);
    if (any(o, [/## recommendation/, /## next step/, /\bso what\b/])) {
      return {
        reason:
          "Research output ends with a 'so what' / recommendation; an artifact would crystallize it.",
        confidence: "low",
      };
    }
    return null;
  },
  "deep_research.escalate.brainstorm": ({ userPrompt }) => {
    return detectBrainstormAsk(userPrompt ?? "")
      ? {
        reason: "User asked for angles/options off the back of the findings.",
        confidence: "high",
      }
      : null;
  },
  "deep_research.escalate.projects": ({ userPrompt, assistantText }) => {
    return detectOngoingWorkSignal(userPrompt ?? "", assistantText)
      ? {
        reason: "Findings will drive ongoing work — log a Projects promotion suggestion.",
        confidence: "medium",
      }
      : null;
  },

  // ─── Refine ─────────────────────────────────────────────────────
  "refine.escalate.deep_research": (inp) => {
    return detectFactsGapInRefine(inp)
      ? {
        reason: "Refine surfaced missing/unverified facts; research is required to fill the gap.",
        confidence: "high",
      }
      : null;
  },
  "refine.escalate.brainstorm": ({ userPrompt }) => {
    return detectBrainstormAsk(userPrompt ?? "")
      ? {
        reason: "User asked for alternative angles instead of a tightened variant.",
        confidence: "high",
      }
      : null;
  },

  // ─── Library ────────────────────────────────────────────────────
  "library.escalate.deep_research": ({ libraryHits, retrievalDecision }) => {
    const hits = libraryHits?.length ?? 0;
    const queried = retrievalDecision?.libraryQueried === true;
    if (queried && hits === 0) {
      return {
        reason: "Library returned zero relevant hits; deep research is required.",
        confidence: "high",
      };
    }
    return null;
  },
  "library.escalate.refine": ({ userPrompt }) => {
    if (!userPrompt) return null;
    const p = lower(userPrompt);
    return any(p, ["refine", "tighten", "sharpen", "rewrite", "shorten"])
      ? {
        reason: "User asked to refine the synthesized output.",
        confidence: "high",
      }
      : null;
  },
  "library.escalate.artifacts": ({ userPrompt, assistantText }) => {
    return detectDeliverableAsk(userPrompt ?? "", assistantText)
      ? {
        reason: "User wants the synthesis turned into a deliverable.",
        confidence: "high",
      }
      : null;
  },

  // ─── Artifacts ──────────────────────────────────────────────────
  "artifacts.escalate.deep_research": ({ gateSummary, assistantText }) => {
    // A research gap is signaled by either:
    //   • A failed required-section gate.
    //   • The output explicitly noting a missing input section.
    const sectionGapGate = hasFailedGate(gateSummary, [
      "artifacts.required_sections_present",
    ]);
    const textSignal = any(lower(assistantText), [
      "[gap]",
      "missing input",
      "research needed",
      "needs research",
      "evidence required",
    ]);
    if (sectionGapGate || textSignal) {
      return {
        reason: sectionGapGate
          ? "Required-section gate failed — a research gap is blocking the artifact."
          : "Output flags a research gap blocking a section.",
        confidence: sectionGapGate ? "high" : "medium",
      };
    }
    return null;
  },
  "artifacts.escalate.refine": ({ userPrompt }) => {
    if (!userPrompt) return null;
    const p = lower(userPrompt);
    return any(p, [
      /sharpen\s+(the\s+)?prose/,
      /tighten\s+(the\s+)?(prose|copy|draft)/,
      "make this punchier",
      "make this tighter",
      /rewrite\s+(the\s+)?(intro|exec|summary)/,
    ])
      ? {
        reason: "User asked to sharpen the prose post-generation.",
        confidence: "high",
      }
      : null;
  },
  "artifacts.escalate.projects": ({ userPrompt, assistantText, taskType }) => {
    // Always a `log_promotion_suggestion` — log if the artifact
    // represents ongoing work. Account briefs / 90-day plans default
    // to "ongoing" by their nature.
    const ongoingTaskType = taskType === "account_brief" ||
      taskType === "ninety_day_plan";
    const signal = ongoingTaskType ||
      detectOngoingWorkSignal(userPrompt ?? "", assistantText);
    if (signal) {
      return {
        reason: ongoingTaskType
          ? `Task type '${taskType}' represents ongoing work; logging a Projects promotion suggestion.`
          : "Artifact context implies ongoing work; logging a Projects promotion suggestion.",
        confidence: ongoingTaskType ? "high" : "medium",
      };
    }
    return null;
  },

  // ─── Projects ───────────────────────────────────────────────────
  "projects.escalate.artifacts": ({ userPrompt, assistantText }) => {
    return detectDeliverableAsk(userPrompt ?? "", assistantText)
      ? {
        reason: "User needs a structured deliverable for the project.",
        confidence: "high",
      }
      : null;
  },
  "projects.escalate.deep_research": ({ userPrompt, citationCheck }) => {
    if (detectEvidenceAsk(userPrompt ?? "")) {
      return {
        reason: "Project work needs sourced evidence beyond what the chat can supply.",
        confidence: "high",
      };
    }
    const unverified = (citationCheck?.issues ?? []).some(
      (i) => i.code === "unverified_citation",
    );
    if (unverified) {
      return {
        reason: "Citation check flagged unverified claims; deep research is needed.",
        confidence: "medium",
      };
    }
    return null;
  },

  // ─── Work ───────────────────────────────────────────────────────
  "work.escalate.deep_research": (inp) => {
    // Routing-noise discipline: only fire when sourcing is genuinely
    // needed — either the user asked for evidence, or the output
    // contains unverified citations that the operator can't defend.
    if (detectEvidenceAsk(inp.userPrompt ?? "")) {
      return {
        reason: "Operator-style answer cannot be defended without sourced evidence.",
        confidence: "high",
      };
    }
    const unverified = (inp.citationCheck?.issues ?? []).some(
      (i) => i.code === "unverified_citation",
    );
    if (unverified) {
      return {
        reason: "Output contains unverified citations; research is required to defend it.",
        confidence: "medium",
      };
    }
    return null;
  },
  "work.escalate.brainstorm": ({ userPrompt }) => {
    return detectBrainstormAsk(userPrompt ?? "")
      ? {
        reason: "Request needs broad ideation beyond operator scope.",
        confidence: "high",
      }
      : null;
  },
  "work.escalate.artifacts": ({ userPrompt, assistantText }) => {
    return detectDeliverableAsk(userPrompt ?? "", assistantText)
      ? {
        reason: "Request implies a structured, reusable deliverable.",
        confidence: "high",
      }
      : null;
  },
};

// ─── Public API ───────────────────────────────────────────────────

/** True when an escalation rule has a registered evaluator. */
export function hasEscalationImplementation(ruleId: string): boolean {
  return Object.prototype.hasOwnProperty.call(REGISTRY, ruleId);
}

/**
 * Evaluate every escalation rule defined on the contract. Always
 * returns a summary; never throws. Every emitted suggestion carries
 * `shadow: true` regardless of caller flags — W7 is advisory only.
 */
export function evaluateEscalationRules(args: {
  inputs: EscalationInputs;
  surface: EscalationSurface;
  taskType?: string;
  runId?: string;
}): EscalationRunSummary {
  const { inputs, surface, taskType, runId } = args;
  const { contract } = inputs;
  const suggestions: EscalationSuggestion[] = [];
  const rules: readonly EscalationRule[] = contract.escalationRules ?? [];

  for (const rule of rules) {
    const evaluator = REGISTRY[rule.id];
    if (!evaluator) continue; // No implementation — silently skip.
    let result: EvalResult = null;
    try {
      result = evaluator(inputs);
    } catch (err) {
      // Never throw from W7. Record nothing — silence is fine.
      console.warn(
        `[workspace:escalation] evaluator '${rule.id}' threw (ignored, shadow):`,
        String(err).slice(0, 200),
      );
      continue;
    }
    if (!result) continue;
    suggestions.push({
      id: rule.id,
      sourceWorkspace: contract.workspace,
      targetWorkspace: rule.targetWorkspace,
      action: rule.action,
      trigger: rule.trigger,
      reason: result.reason,
      confidence: result.confidence,
      shadow: true,
    });
  }

  return {
    workspace: contract.workspace,
    contractVersion: contract.version,
    surface,
    taskType,
    runId,
    suggestions,
    totals: {
      rulesEvaluated: rules.length,
      suggestionsEmitted: suggestions.length,
    },
  };
}

// ─── Telemetry ────────────────────────────────────────────────────

export interface EscalationSuggestionLog {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: EscalationSurface;
  taskType?: string;
  runId?: string;
  suggestionId: string;
  sourceWorkspace: WorkspaceKey;
  targetWorkspace: WorkspaceKey;
  action: EscalationAction;
  trigger: string;
  reason: string;
  confidence: EscalationConfidence;
  shadow: true;
}

export function buildEscalationSuggestionLogs(
  summary: EscalationRunSummary,
): EscalationSuggestionLog[] {
  return summary.suggestions.map((s) => ({
    workspace: summary.workspace,
    contractVersion: summary.contractVersion,
    surface: summary.surface,
    taskType: summary.taskType,
    runId: summary.runId,
    suggestionId: s.id,
    sourceWorkspace: s.sourceWorkspace,
    targetWorkspace: s.targetWorkspace,
    action: s.action,
    trigger: s.trigger,
    reason: s.reason,
    confidence: s.confidence,
    shadow: true,
  }));
}

/** Emit one `workspace:escalation_suggestion` log line per suggestion. */
export function logEscalationSuggestions(summary: EscalationRunSummary): void {
  try {
    for (const log of buildEscalationSuggestionLogs(summary)) {
      console.log(`workspace:escalation_suggestion ${JSON.stringify(log)}`);
    }
  } catch {
    /* never throw from telemetry */
  }
}

// ─── Persistence ──────────────────────────────────────────────────

export interface EscalationPersistenceBlock {
  workspace: WorkspaceKey;
  contractVersion: string;
  surface: EscalationSurface;
  totals: EscalationRunSummary["totals"];
  suggestions: Array<
    Pick<
      EscalationSuggestion,
      | "id"
      | "sourceWorkspace"
      | "targetWorkspace"
      | "action"
      | "reason"
      | "confidence"
    >
  >;
}

export function buildEscalationPersistenceBlock(
  summary: EscalationRunSummary,
): EscalationPersistenceBlock {
  return {
    workspace: summary.workspace,
    contractVersion: summary.contractVersion,
    surface: summary.surface,
    totals: summary.totals,
    suggestions: summary.suggestions.map((s) => ({
      id: s.id,
      sourceWorkspace: s.sourceWorkspace,
      targetWorkspace: s.targetWorkspace,
      action: s.action,
      reason: s.reason,
      confidence: s.confidence,
    })),
  };
}
