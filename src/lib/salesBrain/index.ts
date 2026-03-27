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
  supersedeDoctrine,
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
  // Legacy
  queueLegacyDoctrineForReview,
  getLegacyHydratedCount,
  getPropagationBlockReason,
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

// Doctrine usage logging
export {
  logDoctrineUsage,
  logDoctrineUsageBatch,
  loadDoctrineUsage,
  getDoctrineUsageForId,
  getDoctrineUsageSummary,
  getRecentDoctrineUsage,
  getActualUsageCounts,
  type DoctrineUsageTarget,
  type DoctrineUsageEvent,
  type DoctrineUsageSummary,
} from './doctrineUsage';

// Traceability
export {
  getDoctrineTrace,
  getResourceTrace,
  getInsightTrace,
  getDoctrineCountForResource,
  type DoctrineTrace,
  type ResourceTrace,
  type InsightTrace,
} from './traceability';

// Audio pipeline
export {
  isAudioResource,
  detectAudioSubtype,
  getAudioStrategy,
  scoreTranscriptQuality,
  getAudioFailureDescription,
  getAudioStageLabel,
  createAudioJob,
  failAudioJob,
  completeAudioJob,
  getAudioJobForResource,
  loadAudioJobs,
  getAudioPipelineHealth,
  reclassifyAudioFailures,
  retryRetryableAudioJobs,
  moveNonRetryableToManualAssist,
  type AudioSubtype,
  type AudioFailureCode,
  type AudioPipelineStage,
  type TranscriptQuality,
  type TranscriptQualityResult,
  type AudioStrategy,
  type AudioJobState,
  type AudioPipelineHealth,
} from './audioPipeline';

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
