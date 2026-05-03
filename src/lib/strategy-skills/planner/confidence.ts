/**
 * Retrieval confidence scorer — Phase 2 (inert, pure).
 * Computed AFTER retrieval; planner exposes the scorer but never blocks.
 */
import type { PlannerScope, RetrievalConfidence, RetrievalCounts } from './contextTypes';

/** Optional influence quality breakdown for confidence scoring. */
export interface InfluenceQuality {
  primary?: number;
  supporting?: number;
  weak?: number;
}

export interface ConfidenceInputs {
  counts: RetrievalCounts;
  entityScoped: boolean;
  minRelevantItems: number;
  /** When provided, quality-aware scoring downgrades all-weak results. */
  influence?: InfluenceQuality;
}

export function scoreConfidence(input: ConfidenceInputs): RetrievalConfidence {
  const totals = sum(input.counts);
  if (totals <= 0) return 'insufficient';

  const standardish =
    (input.counts.standards ?? 0) + (input.counts.playbooks ?? 0);
  const kiHits = input.counts.knowledge_items ?? 0;

  // Quality check: if influence data is present and ALL hits are weak, cap at low
  const inf = input.influence;
  if (inf) {
    const meaningful = (inf.primary ?? 0) + (inf.supporting ?? 0);
    if (meaningful === 0 && totals > 0) {
      return 'low';
    }
  }

  // High: entity-scoped + meets minimum + has strong proof (standardish OR KI-dominant)
  if (input.entityScoped && totals >= input.minRelevantItems && (standardish >= 1 || kiHits >= input.minRelevantItems)) {
    return 'high';
  }
  if (totals >= input.minRelevantItems) return 'medium';
  return 'low';
}

function sum(c: RetrievalCounts): number {
  let n = 0;
  for (const k of Object.keys(c) as PlannerScope[]) n += c[k] ?? 0;
  return n;
}
