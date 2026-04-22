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
