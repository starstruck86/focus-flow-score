/**
 * Skill runtime (Phase 3).
 *
 * Orchestrates a skill invocation end-to-end:
 *
 *   envelope → resolveAuthority
 *            → buildPlan        (server-rebuilt, never trusts client plan)
 *            → planToRetrievalArgs
 *            → retrieveLibraryContext  (existing retriever — no new stack)
 *            → applySourceModeGate
 *            → buildSynthesisAddendum (consumed by future synthesis branch)
 *            → buildSkillEnvelope     (powers Show proof)
 *
 * The runtime returns a `SkillRuntimeResult` describing what to do next.
 * Phase 3 strategy-chat passthrough returns the envelope directly and
 * does NOT call synthesis. Synthesis wiring lands in Phase 3.5.
 */
import { resolveAuthority, type AuthorityResult, type SkillEnvelope } from "./authority.ts";
import { buildPlan, scoreConfidence, type PlannerContext, type RetrievalCounts } from "./planner.ts";
import { planToRetrievalArgs } from "./adapter.ts";
import { applySourceModeGate, type SourceGateDecision } from "./sourceModeGate.ts";
import { buildSynthesisAddendum, type LibraryHit } from "./synthesisAddendum.ts";
import { buildSkillEnvelope, type SkillReasoningEnvelope } from "./trace.ts";
import { retrieveLibraryContext } from "../strategy-orchestrator/libraryRetrieval.ts";

export type SkillRuntimeResult =
  | {
    ok: true;
    envelope: SkillReasoningEnvelope;
    /** System-prompt fragment for the future synthesis branch. */
    synthesisAddendum: string;
    /** Library hits the addendum already references. */
    hits: ReadonlyArray<LibraryHit>;
  }
  | { ok: false; envelope: SkillReasoningEnvelope; reason: string; code: string };

export interface SkillRuntimeDeps {
  /** Injectable retriever for tests. Defaults to the real one. */
  retrieve?: typeof retrieveLibraryContext;
  /** Injectable clock for deterministic latency in tests. */
  now?: () => number;
}

export interface RunSkillInput {
  envelope: SkillEnvelope | unknown;
  ctx: PlannerContext;
  supabase: unknown;
  userId: string;
}

function asLibraryHits(result: { knowledgeItems: any[]; playbooks: any[] }): LibraryHit[] {
  const hits: LibraryHit[] = [];
  for (const k of result.knowledgeItems ?? []) {
    hits.push({
      kind: "knowledge_item",
      id: String(k.id ?? ""),
      title: String(k.title ?? "(untitled)"),
      context: k.chapter ?? null,
    });
  }
  for (const p of result.playbooks ?? []) {
    hits.push({
      kind: "playbook",
      id: String(p.id ?? ""),
      title: String(p.title ?? "(untitled)"),
      context: p.problem_type ?? null,
    });
  }
  return hits;
}

export async function runSkill(
  input: RunSkillInput,
  deps: SkillRuntimeDeps = {},
): Promise<SkillRuntimeResult> {
  const retrieve = deps.retrieve ?? retrieveLibraryContext;
  const now = deps.now ?? Date.now;

  const auth: AuthorityResult = resolveAuthority(input.envelope);
  if (!auth.ok) {
    // Build a minimal envelope so the client always gets a structured trace.
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason: auth.reason, code: auth.reason },
      manifest: { id: (auth as any).token ?? "unknown", version: "1", behaviorIntent: "unknown", workspace: "unknown" },
      plan: {
        skillId: (auth as any).token ?? "unknown",
        skillVersion: "1",
        depth: "standard",
        sourceMode: "library_first",
        entityScoped: false,
        entityRefs: [],
        termSeeds: [],
        unresolvedBindings: [],
        scopes: [],
        scopeBudgets: {} as any,
        scopeWeights: {} as any,
        filters: {},
        minRelevantItems: 0,
        totalCap: 0,
        planHash: "00000000",
        contextHash: "00000000",
      },
      counts: {},
      confidence: "insufficient",
      latencyMs: 0,
      hits: [],
      gate: { decision: "refuse", reason: auth.reason },
      overridesClamped: [],
    });
    return { ok: false, envelope: stub, reason: auth.reason, code: auth.reason };
  }

  const planResult = buildPlan(auth.manifest, auth.effectiveDepth, auth.inputs, input.ctx);
  if (!planResult.ok) {
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason: planResult.reason, code: planResult.reason },
      manifest: {
        id: auth.manifest.id,
        version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent,
        workspace: auth.manifest.workspace,
      },
      plan: {
        skillId: auth.manifest.id,
        skillVersion: auth.manifest.version,
        depth: auth.effectiveDepth,
        sourceMode: auth.manifest.sourceMode,
        entityScoped: false,
        entityRefs: [],
        termSeeds: [],
        unresolvedBindings: [],
        scopes: [...auth.manifest.retrieval.scopes],
        scopeBudgets: {} as any,
        scopeWeights: {} as any,
        filters: {},
        minRelevantItems: auth.manifest.retrieval.minRelevantItems ?? 0,
        totalCap: 0,
        planHash: "00000000",
        contextHash: "00000000",
      },
      counts: {},
      confidence: "insufficient",
      latencyMs: 0,
      hits: [],
      gate: { decision: "refuse", reason: planResult.reason },
      overridesClamped: auth.overridesClamped,
      runId: auth.runId,
    });
    return { ok: false, envelope: stub, reason: planResult.reason, code: planResult.reason };
  }

  const plan = planResult.plan;
  const retrievalArgs = planToRetrievalArgs(plan);

  const t0 = now();
  let kis: any[] = [];
  let pbs: any[] = [];
  let counts: RetrievalCounts = {};
  let hits: LibraryHit[] = [];
  try {
    const result = await retrieve(input.supabase as any, input.userId, {}, {
      scopes: retrievalArgs.scopes,
      maxKIs: retrievalArgs.maxKIs,
      maxPlaybooks: retrievalArgs.maxPlaybooks,
    });
    kis = result.knowledgeItems ?? [];
    pbs = result.playbooks ?? [];
    counts = { knowledge_items: kis.length, playbooks: pbs.length };
    hits = asLibraryHits({ knowledgeItems: kis, playbooks: pbs });
  } catch (e) {
    const reason = `retrieval_error: ${(e as Error).message}`;
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason, code: "retrieval_error" },
      manifest: {
        id: auth.manifest.id,
        version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent,
        workspace: auth.manifest.workspace,
      },
      plan,
      counts,
      confidence: "insufficient",
      latencyMs: now() - t0,
      hits,
      gate: { decision: "refuse", reason },
      overridesClamped: auth.overridesClamped,
      runId: auth.runId,
    });
    return { ok: false, envelope: stub, reason, code: "retrieval_error" };
  }
  const latencyMs = now() - t0;

  const confidence = scoreConfidence({
    counts,
    entityScoped: plan.entityScoped,
    minRelevantItems: plan.minRelevantItems,
  });
  const gate: SourceGateDecision = applySourceModeGate({
    sourceMode: plan.sourceMode,
    counts,
    confidence,
    minRelevantItems: plan.minRelevantItems,
  });

  if (gate.decision === "refuse") {
    const env = buildSkillEnvelope({
      ok: false,
      refusal: { reason: gate.reason, code: "source_mode_gate" },
      manifest: {
        id: auth.manifest.id,
        version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent,
        workspace: auth.manifest.workspace,
      },
      plan, counts, confidence, latencyMs, hits, gate,
      overridesClamped: auth.overridesClamped,
      runId: auth.runId,
    });
    return { ok: false, envelope: env, reason: gate.reason, code: "source_mode_gate" };
  }

  const synthesisAddendum = buildSynthesisAddendum({
    manifest: auth.manifest,
    hits,
    overridesClamped: auth.overridesClamped,
    sourceModeWarning: gate.decision === "warn" ? gate.reason : undefined,
  });

  const envelope = buildSkillEnvelope({
    ok: true,
    manifest: {
      id: auth.manifest.id,
      version: auth.manifest.version,
      behaviorIntent: auth.manifest.behaviorIntent,
      workspace: auth.manifest.workspace,
    },
    plan, counts, confidence, latencyMs, hits, gate,
    overridesClamped: auth.overridesClamped,
    runId: auth.runId,
  });

  return { ok: true, envelope, synthesisAddendum, hits };
}
