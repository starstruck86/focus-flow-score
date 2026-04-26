// ════════════════════════════════════════════════════════════════
// Workspace SOP — Contract Types (Phase W1)
//
// This module defines the typed contract for Workspace SOPs. It is
// intentionally pure: no runtime, no I/O, no model calls. Later phases
// (W2 resolver upgrade, W3 retrieval enforcement, W4 prompt composition,
// W5 citation behavior, W6 gate runner, W8/W9 workspace-specific
// post-processing, W10 telemetry) consume these types but never redefine
// them.
//
// Inviolable Global Strategy SOP rules (no fabrication, no invented
// metrics, uncertainty labeling, user-intent preservation, useful
// output) remain active everywhere and are NOT restated in workspace
// contracts. Contracts only describe what changes by work mode.
//
// Architecture: Global Strategy SOP → Workspace SOP → Pill Task Config
// → Run Validation/Self-Correct.
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

export type LibraryMode = "off" | "opportunistic" | "preferred" | "required";
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
  libraryMode: LibraryMode;
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
