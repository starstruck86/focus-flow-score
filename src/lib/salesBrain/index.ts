/**
 * Sales Brain — Public API
 *
 * Central export for the entire Sales Brain system.
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
  getActiveDoctrineCount,
  getInsightCount,
  computeFreshness,
  getFreshnessColor,
  adjustConfidence,
  type DoctrineChapter,
  type DoctrineEntry,
  type SalesBrainInsight,
  type InsightCategory,
  type FreshnessState,
  type DoctrineChangeEvent,
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
  type BrainHealthSummary,
  type PropagationResult,
  type RoleplayDoctrineGround,
  type PlaybookSuggestion,
  type PrepRecommendation,
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
