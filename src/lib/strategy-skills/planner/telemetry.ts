/**
 * Telemetry shape builders — Phase 2 (inert, pure).
 * No IO. No PII. Counts + hashes + ids only.
 */
import type {
  PlannerScope,
  RetrievalConfidence,
  RetrievalCounts,
  RetrievalQueryPlan,
} from './contextTypes';

export interface PlanBuiltEvent {
  event: 'skill_retrieval_plan_built';
  skill_id: string;
  skill_version: string;
  depth: string;
  source_mode: string;
  binding_count: number;
  unresolved_bindings: ReadonlyArray<string>;
  entity_scoped: boolean;
  scope_budgets: Readonly<Record<PlannerScope, number>>;
  context_hash: string;
  plan_hash: string;
  reused_prior_plan: boolean;
}

export interface PlanCompletedEvent {
  event: 'skill_retrieval_completed';
  skill_id: string;
  plan_hash: string;
  counts: RetrievalCounts;
  confidence: RetrievalConfidence;
  latency_ms: number;
}

export interface PlanRefusedEvent {
  event: 'skill_retrieval_refused';
  skill_id?: string;
  reason: 'insufficient_context' | 'forbidden_static_key' | 'unknown_skill';
}

export function buildPlanBuilt(
  plan: RetrievalQueryPlan,
  reusedPriorPlan: boolean,
): PlanBuiltEvent {
  return {
    event: 'skill_retrieval_plan_built',
    skill_id: plan.skillId,
    skill_version: plan.skillVersion,
    depth: plan.depth,
    source_mode: plan.sourceMode,
    binding_count: plan.termSeeds.length,
    unresolved_bindings: plan.unresolvedBindings,
    entity_scoped: plan.entityScoped,
    scope_budgets: plan.scopeBudgets,
    context_hash: plan.contextHash,
    plan_hash: plan.planHash,
    reused_prior_plan: reusedPriorPlan,
  };
}

export function buildPlanCompleted(args: {
  skillId: string;
  planHash: string;
  counts: RetrievalCounts;
  confidence: RetrievalConfidence;
  latencyMs: number;
}): PlanCompletedEvent {
  return {
    event: 'skill_retrieval_completed',
    skill_id: args.skillId,
    plan_hash: args.planHash,
    counts: args.counts,
    confidence: args.confidence,
    latency_ms: args.latencyMs,
  };
}

export function buildPlanRefused(args: {
  skillId?: string;
  reason: PlanRefusedEvent['reason'];
}): PlanRefusedEvent {
  return { event: 'skill_retrieval_refused', skill_id: args.skillId, reason: args.reason };
}
