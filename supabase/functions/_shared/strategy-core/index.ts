// ════════════════════════════════════════════════════════════════
// Strategy Core — Public API
//
// One brain. Many surfaces.
//
//   • Reasoning primitives  → reasoningCore.ts
//   • Critique primitives   → critique.ts
//   • Library retrieval     → library.ts (re-export)
//   • Context assembly      → contextAssembly.ts
//
// Tasks compose from these. They MUST NOT redefine them.
// ════════════════════════════════════════════════════════════════

export {
  ACCOUNT_SPECIFICITY_RULE,
  ACCOUNT_THESIS_SCHEMA,
  ECONOMIC_FRAMING_RULES,
  FACT_DISCIPLINE_RULES,
  POV_BLOCK_SCHEMA,
  STRATEGY_CORE_THINKING_ORDER,
  VALUE_LEAKAGE_ENTRY_SCHEMA,
} from "./reasoningCore.ts";

export {
  CRITIQUE_IDENTITY_INSTRUCTION,
  libraryGroundingHeader,
} from "./critique.ts";

export {
  retrieveLibraryContext,
  type LibraryRetrievalResult,
  type RetrievedKI,
  type RetrievedPlaybook,
} from "./library.ts";

export {
  assembleStrategyContext,
  type AssembledStrategyContext,
} from "./contextAssembly.ts";

export {
  buildStrategyChatSystemPrompt,
  shouldUseStrategyCorePrompt,
  type BuildStrategyChatPromptArgs,
} from "./chatPrompt.ts";

export {
  getLibraryTotals,
  renderLibraryTotalsBlock,
  type LibraryTotals,
} from "./libraryTotals.ts";

export {
  buildPendingLookupAction,
  detectAffirmative,
  detectLookupIntent,
  detectNegative,
  pendingActionToIntent,
  renderLookupResultText,
  runLibraryLookup,
  type LookupIntent,
  type LookupKind,
  type LookupResult,
  type LookupTarget,
  type PendingLookupAction,
} from "./libraryLookup.ts";

export {
  extractCandidatePhrases,
  inferResourceCategories,
  inferTopicScopes,
  recordResourceUsage,
  renderResourceContextBlock,
  retrieveResourceContext,
  userAskedForPriorUse,
  userAskedForResource,
  userAskedForTopic,
  type ResourceRetrievalResult,
  type RetrievedResource,
} from "./resourceRetrieval.ts";

export {
  auditResourceCitations,
  type CitationAuditHit,
  type CitationAuditOptions,
  type CitationAuditResult,
} from "./citationAudit.ts";

export {
  emptyWorkingThesisState,
  extractThesisPatchFromProse,
  loadWorkingThesisState,
  mergeWorkingThesisState,
  renderWorkingThesisStateBlock,
  saveWorkingThesisState,
  validateWorkingThesisState,
  type KilledHypothesis,
  type ThesisConfidence,
  type ThesisStatePatch,
  type ValidationResult,
  type WorkingThesisState,
} from "./thesisMemory.ts";

// ─── Workspace SOP contracts (Phase W1 — data only) ─────────────
export {
  ALL_WORKSPACE_KEYS,
  getWorkspaceContract,
  normalizeWorkspaceKey,
  WORKSPACE_CONTRACTS,
} from "./workspaceContracts.ts";
export type { NormalizeWorkspaceKeyResult } from "./workspaceContracts.ts";
export type {
  ArtifactsConfig,
  CitationMode,
  ContextMode,
  EscalationAction,
  EscalationRule,
  GateEnforcementType,
  GateSeverity,
  LibraryUse,
  OutputFormattingHints,
  ProjectsConfig,
  QualityGate,
  RefineConfig,
  RetrievalRules,
  WebMode,
  WorkConfig,
  WorkMaterialityRule,
  WorkspaceContract,
  WorkspaceKey,
} from "./workspaceContractTypes.ts";

// ─── Retrieval enforcement (Phase W3) ───────────────────────────
export {
  buildRetrievalDecisionLog,
  decideLibraryQuery,
  decideWebQuery,
  evaluateLibraryCoverage,
  logRetrievalDecision,
  orderContextBlocks,
  resolveServerWorkspaceContract,
} from "./retrievalEnforcement.ts";
export type {
  ContextBlockKind,
  LibraryCoverageInputs,
  LibraryCoverageState,
  LibraryGateDecision,
  LibraryGateInputs,
  LibraryGateRunReason,
  LibraryGateSkipReason,
  OrderableContextBlock,
  ResolvedServerContract,
  RetrievalDecisionLog,
  WebGateDecision,
  WebGateInputs,
  WebGateRunReason,
  WebGateSkipReason,
} from "./retrievalEnforcement.ts";

// ─── Workspace prompt overlay (Phase W4) ─────────────────────────
export {
  ALL_WORKSPACE_PROMPT_BLOCKS,
  buildPromptCompositionLog,
  buildWorkspaceOverlay,
  logPromptComposition,
} from "./workspacePrompt.ts";
export type {
  BuildPromptCompositionLogArgs,
  BuildWorkspaceOverlayArgs,
  WorkspaceOverlayResult,
  WorkspacePromptBlockId,
  WorkspacePromptComposition,
} from "./workspacePrompt.ts";

// ─── Citation behavior enforcement (Phase W5) ────────────────────
export {
  buildCitationCheckLog,
  logCitationCheck,
  runCitationCheck,
} from "./citationEnforcement.ts";
export type {
  CitationCheckInputs,
  CitationCheckLog,
  CitationCheckResult,
  CitationCheckSurface,
  CitationIssue,
  CitationIssueCode,
} from "./citationEnforcement.ts";

// ─── Quality gate runner (Phase W6, shadow-only) ─────────────────
export {
  buildGatePersistenceBlock,
  buildGateResultLogs,
  hasGateImplementation,
  logGateResults,
  runWorkspaceGates,
} from "./workspaceGateRunner.ts";
export type {
  GateCheckInputs,
  GateOutcome,
  GatePersistenceBlock,
  GateResult,
  GateResultLog,
  GateRunSummary,
  GateRunnerSurface,
} from "./workspaceGateRunner.ts";

// ─── Escalation rules (Phase W7, shadow-only) ────────────────────
export {
  buildEscalationPersistenceBlock,
  buildEscalationSuggestionLogs,
  evaluateEscalationRules,
  hasEscalationImplementation,
  logEscalationSuggestions,
} from "./workspaceEscalation.ts";
export type {
  EscalationConfidence,
  EscalationInputs,
  EscalationPersistenceBlock,
  EscalationRunSummary,
  EscalationSuggestion,
  EscalationSuggestionLog,
  EscalationSurface,
} from "./workspaceEscalation.ts";
