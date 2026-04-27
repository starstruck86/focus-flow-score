// ════════════════════════════════════════════════════════════════
// Workspace SOP — Contract Types (Phase W1)
//
// This module defines the typed contract for Workspace SOPs. It is
// intentionally pure: no runtime, no I/O, no model calls. Later phases
// (W2 resolver upgrade, W3 retrieval enforcement, W4 prompt composition,
// W5 citation behavior, W6 gate runner, W6.5 library calibration,
// W7 escalation, W8/W9 workspace-specific post-processing, W10
// telemetry) consume these types but never redefine them.
//
// Inviolable Global Strategy SOP rules (no fabrication, no invented
// metrics, uncertainty labeling, user-intent preservation, useful
// output) remain active everywhere and are NOT restated in workspace
// contracts. Contracts only describe what changes by work mode.
//
// Architecture: Global Strategy SOP → Workspace SOP → Pill Task Config
// → Run Validation/Self-Correct.
//
// ─── The Library Doctrine (non-negotiable) ───────────────────────
//
// The user's library is Strategy's "degree in sales." It is NOT a
// nice-to-have retrieval source and NOT just a citation pool. It is
// the standing definition of what good looks like — the sales
// education, exemplars, patterns, and standards Strategy has been
// trained on by *this* user. Every workspace inherits this doctrine.
//
// Library items carry TWO simultaneous roles:
//
//   1. RESOURCE — factual grounding / citation candidates.
//      Used when an item is the source of a specific claim. Governed
//      by W3 retrieval and W5 citation enforcement.
//
//   2. STANDARD / EXEMPLAR / PATTERN — the quality bar. "What good
//      looks like." Used to shape *how* Strategy thinks and writes
//      BEFORE generation (W6.5 Pass A) and to grade the output AFTER
//      generation (W6.5 Pass B). Standards are guidance, not facts;
//      they are NOT cited unless their language is directly borrowed.
//
// Both roles run on every request where library coverage exists. The
// `libraryUse` posture below only controls *how aggressively* the
// RESOURCE role leads the prompt — it never disables the STANDARD
// role and never makes the library "optional." If exemplars are
// insufficient for a given workspace, W6.5 skips cleanly; it never
// fabricates standards and never falls back to generic guidance.
//
// Future phases MUST preserve this two-role architecture: do not
// collapse STANDARD into citations, do not gate STANDARD on
// `libraryUse`, and do not treat the library as merely opportunistic
// retrieval.
// ════════════════════════════════════════════════════════════════

/** Canonical workspace identity. Mirrors StrategyWorkspaceSopKey. */
export type WorkspaceKey =
  | "brainstorm"
  | "deep_research"
  | "refine"
  | "library"
  | "artifacts"
  | "projects"
  | "work";

// ─── Retrieval posture ────────────────────────────────────────────
//
// `libraryUse` is the workspace's *posture toward the user's library*,
// NOT a switch that disables it. The library is universal Strategy
// context — every workspace can reach it. The posture only controls
// how aggressively it is used.
//
//   • background — available; do not actively inject unless the user
//                  explicitly requests it or relevance is unmistakable
//   • relevant   — retrieve and inject when the request signals likely
//                  relevance (default operator behavior)
//   • primary    — actively retrieve and treat as a major context
//                  source whenever a meaningful query can be formed
//   • required   — library-centered work; missing coverage surfaces a
//                  `required_missing` state to the caller

export type LibraryUse = "background" | "relevant" | "primary" | "required";
export type WebMode = "off" | "opportunistic" | "required_for_current_facts";
export type CitationMode =
  | "none"
  | "none_unless_library_used"
  | "light"
  | "strict";
export type ContextMode =
  | "thread_first"
  | "project_first"
  | "artifact_first"
  | "draft_first";

export interface RetrievalRules {
  libraryUse: LibraryUse;
  webMode: WebMode;
  citationMode: CitationMode;
  contextMode: ContextMode;
}

// ─── Quality gates ────────────────────────────────────────────────

/**
 * Gate enforcement classification.
 *
 *  • deterministic — binary, programmatically verifiable. Eligible for
 *    shadow→enforced promotion after the shadow window.
 *  • heuristic     — fuzzy / linguistic check. Stays warning/shadow
 *    unless manually approved.
 *  • llm_judge     — reserved for future. Not implemented in MVP; the
 *    gate runner registry will reject these.
 */
export type GateEnforcementType = "deterministic" | "heuristic" | "llm_judge";

export type GateSeverity = "info" | "warning" | "blocking";

export interface QualityGate {
  /** Stable id, e.g. "brainstorm.min_options". */
  id: string;
  /** Human-readable description rendered in prompts and dev panel. */
  description: string;
  /** Key into the future GATE_REGISTRY (W6). */
  checkRef: string;
  enforcementType: GateEnforcementType;
  severity: GateSeverity;
  /** True = report only. All gates ship shadow=true in MVP. */
  shadow: boolean;
}

// ─── Escalation rules (W7 deferred) ───────────────────────────────

/**
 * MVP escalation actions. Inline workspace invocation (W7) is
 * intentionally deferred — it is too complex for the first build.
 *
 *  • recommend_workspace      — surface a recommendation to the user
 *  • log_promotion_suggestion — telemetry-only signal (no user surface)
 */
export type EscalationAction =
  | "recommend_workspace"
  | "log_promotion_suggestion";

export interface EscalationRule {
  /** Stable id, e.g. "brainstorm.escalate.refine". */
  id: string;
  /** Human-readable trigger description. */
  trigger: string;
  action: EscalationAction;
  /** Required for both MVP actions. */
  targetWorkspace: WorkspaceKey;
}

// ─── Output formatting hints ──────────────────────────────────────

/**
 * Explicit, parseable output structure per workspace. Gates rely on
 * these markers to run reliably. Hints are rendered into the system
 * prompt verbatim so the model has unambiguous formatting guidance.
 */
export interface OutputFormattingHints {
  /** Short paragraph describing the overall structure. */
  summary: string;
  /** Required marker conventions, listed for the model. */
  markers: string[];
  /** Required section headings, in order, when applicable. */
  sectionHeadings?: string[];
}

// ─── Workspace-specific config blocks ─────────────────────────────

export interface RefineConfig {
  /** Hard cap on labeled variants (default 2). */
  maxVariants: number;
  /** Allowed variant labels (case-sensitive, exact match). */
  allowedVariantLabels: ReadonlyArray<
    "Shorter" | "Sharper" | "Warmer" | "More executive" | "More direct"
  >;
}

export interface WorkMaterialityRule {
  /** Stable id, e.g. "work.materiality.needs_evidence". */
  id: string;
  /** Human-readable condition; mapped to a runtime check in W8. */
  condition: string;
  /** Workspace to recommend when this rule triggers. */
  recommend: WorkspaceKey;
}

export interface WorkConfig {
  /** Routing only when at least one materiality rule fires. */
  materialityRules: ReadonlyArray<WorkMaterialityRule>;
}

export interface ProjectsConfig {
  /** When true, the W8 guardrail flags fabricated continuity. */
  enforceContinuityGuardrail: boolean;
  /** Currently empty — durable project memory is not implemented. */
  futureCapabilityFlags: ReadonlyArray<string>;
}

export interface ArtifactsConfig {
  /** Required sections always come from the pill task config. */
  deferRequiredSectionsToTaskConfig: true;
}

// ─── The contract ─────────────────────────────────────────────────

export interface WorkspaceContract {
  workspace: WorkspaceKey;
  /** Semver. Bump when any field changes; W2 persists this on telemetry. */
  version: string;
  mission: string;
  cognitivePosture: string;
  useCases: string[];
  nonGoals: string[];
  /** Ordered steps; W4 renders them as a numbered "Reasoning Path" block. */
  reasoningPath: string[];
  retrievalRules: RetrievalRules;
  qualityGates: QualityGate[];
  failureModes: string[];
  escalationRules: EscalationRule[];
  outputFormattingHints: OutputFormattingHints;

  // Workspace-specific extensions (optional, narrow per workspace).
  refineConfig?: RefineConfig;
  workConfig?: WorkConfig;
  projectsConfig?: ProjectsConfig;
  artifactsConfig?: ArtifactsConfig;
}
