/**
 * Workspace SOP — Contract Types (client-side mirror of W1).
 *
 * The canonical types live in
 * `supabase/functions/_shared/strategy-core/workspaceContractTypes.ts`
 * (Deno runtime). This file is a structurally-identical mirror used by
 * client code (resolver, future composer, dev panel) that cannot import
 * from the edge `_shared` tree under Vite's `include: ['src']` rule.
 *
 * Both files share the same `CONTRACT_VERSION` so drift is detectable
 * — registry-equivalence tests assert version equality.
 *
 * Inviolable Global Strategy SOP rules (no fabrication, no invented
 * metrics, uncertainty labeling, user-intent preservation, useful
 * output) remain active everywhere and are NOT restated in workspace
 * contracts. Contracts only describe what changes by work mode.
 *
 * ─── The Library Doctrine (non-negotiable) ─────────────────────
 *
 * The user's library is Strategy's "degree in sales." It is NOT a
 * nice-to-have retrieval source and NOT just a citation pool. It is
 * the standing definition of what good looks like — the sales
 * education, exemplars, patterns, and standards Strategy has been
 * trained on by *this* user. Every workspace inherits this doctrine.
 *
 * Library items carry TWO simultaneous roles:
 *
 *   1. RESOURCE — factual grounding / citation candidates.
 *      Used when an item is the source of a specific claim. Governed
 *      by W3 retrieval and W5 citation enforcement.
 *
 *   2. STANDARD / EXEMPLAR / PATTERN — the quality bar. "What good
 *      looks like." Used to shape *how* Strategy thinks and writes
 *      BEFORE generation (W6.5 Pass A) and to grade the output AFTER
 *      generation (W6.5 Pass B). Standards are guidance, not facts;
 *      they are NOT cited unless their language is directly borrowed.
 *
 * Both roles run on every request where library coverage exists. The
 * `libraryUse` posture below only controls *how aggressively* the
 * RESOURCE role leads the prompt — it never disables the STANDARD
 * role and never makes the library "optional." If exemplars are
 * insufficient for a given workspace, W6.5 skips cleanly; it never
 * fabricates standards and never falls back to generic guidance.
 *
 * Future phases MUST preserve this two-role architecture: do not
 * collapse STANDARD into citations, do not gate STANDARD on
 * `libraryUse`, and do not treat the library as merely opportunistic
 * retrieval.
 */

/** Canonical workspace identity. Mirrors StrategyWorkspaceSopKey. */
export type WorkspaceKey =
  | 'brainstorm'
  | 'deep_research'
  | 'refine'
  | 'library'
  | 'artifacts'
  | 'projects'
  | 'work';

// ─── Retrieval posture ────────────────────────────────────────────
//
// `libraryUse` is the workspace's posture toward the user's library
// as a RESOURCE source (citation-eligible factual grounding) — NOT
// a switch that disables the library. The library is universal
// Strategy context; every workspace can reach it. The STANDARD /
// EXEMPLAR / PATTERN role (W6.5) runs independently of this posture.
// See edge mirror for full semantics and the library doctrine.

export type LibraryUse = 'background' | 'relevant' | 'primary' | 'required';
export type WebMode = 'off' | 'opportunistic' | 'required_for_current_facts';
export type CitationMode =
  | 'none'
  | 'none_unless_library_used'
  | 'light'
  | 'strict';
export type ContextMode =
  | 'thread_first'
  | 'project_first'
  | 'artifact_first'
  | 'draft_first';

export interface RetrievalRules {
  libraryUse: LibraryUse;
  webMode: WebMode;
  citationMode: CitationMode;
  contextMode: ContextMode;
}

// ─── Quality gates ────────────────────────────────────────────────

export type GateEnforcementType = 'deterministic' | 'heuristic' | 'llm_judge';
export type GateSeverity = 'info' | 'warning' | 'blocking';

export interface QualityGate {
  id: string;
  description: string;
  checkRef: string;
  enforcementType: GateEnforcementType;
  severity: GateSeverity;
  shadow: boolean;
}

// ─── Escalation rules (W7 deferred) ───────────────────────────────

export type EscalationAction =
  | 'recommend_workspace'
  | 'log_promotion_suggestion';

export interface EscalationRule {
  id: string;
  trigger: string;
  action: EscalationAction;
  targetWorkspace: WorkspaceKey;
}

// ─── Output formatting hints ──────────────────────────────────────

export interface OutputFormattingHints {
  summary: string;
  markers: string[];
  sectionHeadings?: string[];
}

// ─── Workspace-specific config blocks ─────────────────────────────

export interface RefineConfig {
  maxVariants: number;
  allowedVariantLabels: ReadonlyArray<
    'Shorter' | 'Sharper' | 'Warmer' | 'More executive' | 'More direct'
  >;
}

export interface WorkMaterialityRule {
  id: string;
  condition: string;
  recommend: WorkspaceKey;
}

export interface WorkConfig {
  materialityRules: ReadonlyArray<WorkMaterialityRule>;
}

export interface ProjectsConfig {
  enforceContinuityGuardrail: boolean;
  futureCapabilityFlags: ReadonlyArray<string>;
}

export interface ArtifactsConfig {
  deferRequiredSectionsToTaskConfig: true;
}

// ─── The contract ─────────────────────────────────────────────────

export interface WorkspaceContract {
  workspace: WorkspaceKey;
  version: string;
  mission: string;
  cognitivePosture: string;
  useCases: string[];
  nonGoals: string[];
  reasoningPath: string[];
  retrievalRules: RetrievalRules;
  qualityGates: QualityGate[];
  failureModes: string[];
  escalationRules: EscalationRule[];
  outputFormattingHints: OutputFormattingHints;

  refineConfig?: RefineConfig;
  workConfig?: WorkConfig;
  projectsConfig?: ProjectsConfig;
  artifactsConfig?: ArtifactsConfig;
}
