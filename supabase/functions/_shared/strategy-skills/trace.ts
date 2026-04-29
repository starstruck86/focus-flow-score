/**
 * Skill trace summary + envelope (Phase 3, pure).
 *
 * The "Show proof" feature reads from this trace shape. It includes:
 *   • skill identity + version
 *   • effective depth + source mode
 *   • plan hashes (context + plan)
 *   • retrieval counts + confidence
 *   • source-mode gate decision
 *   • overrides that were clamped
 *   • the library hits used (id + title + kind)
 *
 * The trace is what powers `Show proof`: the client reads it from the
 * envelope returned by the early-return branch. No DB writes.
 */
import type {
  RetrievalConfidence,
  RetrievalCounts,
  RetrievalQueryPlan,
} from "./planner.ts";
import type { LibraryHit } from "./synthesisAddendum.ts";
import type { SourceGateDecision } from "./sourceModeGate.ts";

export interface SkillTrace {
  schema: "skill_trace.v1";
  skill_id: string;
  skill_version: string;
  run_id?: string;
  depth: string;
  source_mode: string;
  behavior_intent: string;
  workspace: string;
  plan: {
    context_hash: string;
    plan_hash: string;
    term_seeds: ReadonlyArray<string>;
    unresolved_bindings: ReadonlyArray<string>;
    entity_scoped: boolean;
    scope_budgets: Readonly<Record<string, number>>;
  };
  retrieval: {
    counts: RetrievalCounts;
    confidence: RetrievalConfidence;
    latency_ms: number;
    hits: ReadonlyArray<LibraryHit>;
  };
  gate: SourceGateDecision;
  overrides_clamped: ReadonlyArray<string>;
}

export interface SkillReasoningEnvelope {
  schema: "skill_envelope.v1";
  ok: boolean;
  /** Present when the runtime refused (gate or planner). */
  refusal?: { reason: string; code: string };
  trace: SkillTrace;
}

export interface BuildEnvelopeInput {
  ok: boolean;
  refusal?: { reason: string; code: string };
  manifest: {
    id: string;
    version: string;
    behaviorIntent: string;
    workspace: string;
  };
  plan: RetrievalQueryPlan;
  counts: RetrievalCounts;
  confidence: RetrievalConfidence;
  latencyMs: number;
  hits: ReadonlyArray<LibraryHit>;
  gate: SourceGateDecision;
  overridesClamped: ReadonlyArray<string>;
  runId?: string;
}

export function buildSkillEnvelope(input: BuildEnvelopeInput): SkillReasoningEnvelope {
  const trace: SkillTrace = {
    schema: "skill_trace.v1",
    skill_id: input.manifest.id,
    skill_version: input.manifest.version,
    run_id: input.runId,
    depth: input.plan.depth,
    source_mode: input.plan.sourceMode,
    behavior_intent: input.manifest.behaviorIntent,
    workspace: input.manifest.workspace,
    plan: {
      context_hash: input.plan.contextHash,
      plan_hash: input.plan.planHash,
      term_seeds: input.plan.termSeeds,
      unresolved_bindings: input.plan.unresolvedBindings,
      entity_scoped: input.plan.entityScoped,
      scope_budgets: input.plan.scopeBudgets,
    },
    retrieval: {
      counts: input.counts,
      confidence: input.confidence,
      latency_ms: input.latencyMs,
      hits: input.hits,
    },
    gate: input.gate,
    overrides_clamped: input.overridesClamped,
  };
  return {
    schema: "skill_envelope.v1",
    ok: input.ok,
    refusal: input.refusal,
    trace,
  };
}

/**
 * Show-proof read path. Pure: takes a stored envelope and returns the
 * structured items the UI uses to render the proof drawer. No IO.
 */
export interface ProofView {
  skill: { id: string; version: string; depth: string; sourceMode: string };
  plan: { contextHash: string; planHash: string; termSeeds: ReadonlyArray<string> };
  retrieval: { counts: RetrievalCounts; confidence: string; hits: ReadonlyArray<LibraryHit> };
  gate: SourceGateDecision;
  overridesClamped: ReadonlyArray<string>;
}

export function readProof(envelope: SkillReasoningEnvelope): ProofView | null {
  if (!envelope || envelope.schema !== "skill_envelope.v1") return null;
  const t = envelope.trace;
  return {
    skill: {
      id: t.skill_id,
      version: t.skill_version,
      depth: t.depth,
      sourceMode: t.source_mode,
    },
    plan: {
      contextHash: t.plan.context_hash,
      planHash: t.plan.plan_hash,
      termSeeds: t.plan.term_seeds,
    },
    retrieval: {
      counts: t.retrieval.counts,
      confidence: t.retrieval.confidence,
      hits: t.retrieval.hits,
    },
    gate: t.gate,
    overridesClamped: t.overrides_clamped,
  };
}
