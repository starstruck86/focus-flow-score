/**
 * Sales Brain — Public API
 */

// Subtype detection + enrichability
export {
  detectResourceSubtype,
  classifyEnrichability,
  getSubtypeLabel,
  getEnrichabilityLabel,
  getEnrichabilityColor,
  getEnrichModalReason,
  type ResourceSubtype,
  type EnrichabilityState,
  type EnrichabilityResult,
} from './resourceSubtype';

// Doctrine system
export {
  DOCTRINE_CHAPTERS,
  getChapterLabel,
  loadDoctrine,
  loadInsights,
  loadChangelog,
  getDoctrineByChapter,
  getDoctrineForContext,
  getActiveDoctrine,
  getActiveDoctrineCount,
  getInsightCount,
  getPropagationEligibleDoctrine,
  isDoctrineEligibleForPropagation,
  computeFreshness,
  getFreshnessColor,
  getGovernanceColor,
  getGovernanceLabel,
  adjustConfidence,
  defaultGovernance,
  // Governance actions
  approveDoctrine,
  rejectDoctrine,
  archiveDoctrine,
  mergeDoctrine,
  adjustDoctrineConfidence,
  togglePropagation,
  togglePropagationTarget,
  addReviewNote,
  // Detection
  detectDuplicatesAndConflicts,
  // Recovery
  recomputeAllFreshness,
  disableStalePropagation,
  reEnableApprovedPropagation,
  // Review queue
  getDoctrineReviewQueue,
  getDoctrineGovernanceStats,
  PROPAGATION_CONFIDENCE_FLOORS,
  // Types
  type DoctrineChapter,
  type DoctrineEntry,
  type DoctrineGovernance,
  type GovernanceStatus,
  type DuplicateFlag,
  type ConflictFlag,
  type PropagationTargets,
  type SalesBrainInsight,
  type InsightCategory,
  type FreshnessState,
  type DoctrineChangeEvent,
  type ChangeEventType,
  type ReviewQueueItem,
  type DoctrineGovernanceStats,
} from './doctrine';

// Transformation pipeline
export {
  processPromotedResource,
  extractInsightsHeuristic,
  type ExtractionInput,
  type ExtractionResult,
} from './transformationPipeline';

// Propagation
export {
  getDaveDoctrineContext,
  getRoleplayGrounding,
  getPlaybookSuggestions,
  getPrepRecommendations,
  getBrainHealth,
  runPropagation,
  getDoctrineUsageMap,
  type BrainHealthSummary,
  type PropagationResult,
  type RoleplayDoctrineGround,
  type PlaybookSuggestion,
  type PrepRecommendation,
  type DoctrineUsageMap,
} from './propagation';

// Ingestion (existing)
export {
  ingestItem,
  ingestFromSource,
  getIncomingResources,
  updateBrainStatus,
  bulkUpdateBrainStatus,
  manualIngestUrl,
  type BrainStatus,
  type IngestionResult,
  type IngestionItem,
  type IncomingResource,
} from './ingestion';
