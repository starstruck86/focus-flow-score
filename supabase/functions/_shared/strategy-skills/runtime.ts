/**
 * Skill runtime (Phase 3 + 3A hardening).
 *
 * Orchestrates a skill invocation end-to-end:
 *
 *   envelope → sanitize + resolveAuthority   (drops sourceMode etc.)
 *            → version-mismatch check        (refuse if pinned ≠ manifest)
 *            → chain-depth check             (refuse beyond MAX_CHAIN_DEPTH)
 *            → buildPlan                     (server-rebuilt, never trusts client plan)
 *            → planToRetrievalArgs
 *            → retrieveLibraryContext        (existing retriever, with timeout)
 *            → classifyHits + computeLibraryInfluence
 *            → applySourceModeGate
 *            → computeGenericOutputRisk + computeDrift + buildWhyThisSkill
 *            → buildSynthesisAddendum        (consumed by future synthesis branch)
 *            → buildSkillEnvelope            (powers Show proof)
 *
 * Phase 3 strategy-chat passthrough returns the envelope directly and
 * does NOT call synthesis. Synthesis wiring lands in Phase 3.5.
 */
import {
  resolveAuthority,
  type AuthorityResult,
  type SkillEnvelope,
} from "./authority.ts";
import {
  buildPlan,
  scoreConfidence,
  type PlannerContext,
  type RetrievalCounts,
  type RetrievalQueryPlan,
} from "./planner.ts";
import { planToRetrievalArgs } from "./adapter.ts";
import { applySourceModeGate, type SourceGateDecision } from "./sourceModeGate.ts";
import { buildSynthesisAddendum, type LibraryHit } from "./synthesisAddendum.ts";
import { buildSkillEnvelope, type SkillReasoningEnvelope } from "./trace.ts";
import {
  buildWhyThisSkill,
  checkChainDepth,
  classifyHits,
  computeDrift,
  computeGenericOutputRisk,
  computeLibraryInfluence,
  type ClassifiedHit,
  type DriftSignal,
  type LibraryInfluence,
  retrievalBudgetFor,
} from "./hardening.ts";
import { retrieveLibraryContext } from "../strategy-orchestrator/libraryRetrieval.ts";

export type SkillRuntimeResult =
  | {
    ok: true;
    envelope: SkillReasoningEnvelope;
    /** System-prompt fragment for the future synthesis branch. */
    synthesisAddendum: string;
    /** Library hits (classified) the addendum already references. */
    hits: ReadonlyArray<ClassifiedHit>;
  }
  | { ok: false; envelope: SkillReasoningEnvelope; reason: string; code: string };

export interface SkillRuntimeDeps {
  /** Injectable retriever for tests. Defaults to the real one. */
  retrieve?: typeof retrieveLibraryContext;
  /** Injectable clock for deterministic latency in tests. */
  now?: () => number;
  /** Override the per-depth retrieval budget (ms). Tests use this. */
  retrievalBudgetMs?: number;
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

/** Stub plan used when we have to refuse before/around buildPlan. */
function stubPlan(
  manifestId: string,
  manifestVersion: string,
  depth: string,
  sourceMode: string,
  scopes: ReadonlyArray<string>,
  minRelevantItems: number,
): RetrievalQueryPlan {
  return {
    skillId: manifestId,
    skillVersion: manifestVersion,
    depth: depth as any,
    sourceMode: sourceMode as any,
    entityScoped: false,
    entityRefs: [],
    termSeeds: [],
    unresolvedBindings: [],
    scopes: scopes as any,
    scopeBudgets: {} as any,
    scopeWeights: {} as any,
    filters: {},
    minRelevantItems,
    totalCap: 0,
    planHash: "00000000",
    contextHash: "00000000",
  };
}

function emptyInfluence(): LibraryInfluence {
  return { primary: 0, supporting: 0, weak: 0, total: 0, primary_dominant: false };
}

/** Race a promise against a timeout. Resolves either to value or "__timeout__". */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | "__timeout__"> {
  let to: number | undefined;
  try {
    return await Promise.race<T | "__timeout__">([
      p,
      new Promise<"__timeout__">((resolve) => {
        to = setTimeout(() => resolve("__timeout__"), ms) as unknown as number;
      }),
    ]);
  } finally {
    if (to !== undefined) clearTimeout(to);
  }
}

export async function runSkill(
  input: RunSkillInput,
  deps: SkillRuntimeDeps = {},
): Promise<SkillRuntimeResult> {
  const retrieve = deps.retrieve ?? retrieveLibraryContext;
  const now = deps.now ?? Date.now;

  const auth: AuthorityResult = resolveAuthority(input.envelope);
  if (!auth.ok) {
    const code = auth.reason;
    const reason = auth.reason === "version_mismatch"
      ? `version_mismatch: expected=${(auth as any).expected} actual=${(auth as any).actual}`
      : auth.reason;
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason, code },
      manifest: {
        id: (auth as any).token ?? "unknown",
        version: (auth as any).actual ?? "unknown",
        behaviorIntent: "unknown",
        workspace: "unknown",
      },
      plan: stubPlan((auth as any).token ?? "unknown", "unknown", "standard", "library_first", [], 0),
      counts: {},
      confidence: "insufficient",
      latencyMs: 0,
      hits: [],
      influence: emptyInfluence(),
      gate: { decision: "refuse", reason },
      overridesClamped: [],
      droppedClientKeys: [],
      genericOutputRisk: "high",
      drift: { changed_skill: false, same_account: false, to: (auth as any).token ?? "unknown" },
      chainDepth: 0,
      whyThisSkill: `Refused: ${reason}`,
    });
    return { ok: false, envelope: stub, reason, code };
  }

  // Hardening: chain depth cap (refuse early; nothing to retrieve).
  const chainCheck = checkChainDepth(auth.chainDepth);
  if (!chainCheck.ok) {
    const reason = `chain_depth_exceeded: depth=${chainCheck.depth}`;
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason, code: "chain_depth_exceeded" },
      manifest: {
        id: auth.manifest.id,
        version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent,
        workspace: auth.manifest.workspace,
      },
      plan: stubPlan(
        auth.manifest.id, auth.manifest.version, auth.effectiveDepth,
        auth.manifest.sourceMode, auth.manifest.retrieval.scopes,
        auth.manifest.retrieval.minRelevantItems ?? 0,
      ),
      counts: {},
      confidence: "insufficient",
      latencyMs: 0,
      hits: [],
      influence: emptyInfluence(),
      gate: { decision: "refuse", reason },
      overridesClamped: auth.overridesClamped,
      droppedClientKeys: auth.droppedClientKeys,
      genericOutputRisk: "high",
      drift: computeDrift({
        currentSkillId: auth.manifest.id,
        currentAccountId: input.ctx.thread?.account?.id,
        prior: input.ctx.prior,
      }),
      chainDepth: chainCheck.depth,
      whyThisSkill: `Refused: ${reason}`,
      runId: auth.runId,
    });
    return { ok: false, envelope: stub, reason, code: "chain_depth_exceeded" };
  }

  const planResult = buildPlan(
    auth.manifest, auth.effectiveDepth, auth.inputs, input.ctx,
  );
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
      plan: stubPlan(
        auth.manifest.id, auth.manifest.version, auth.effectiveDepth,
        auth.manifest.sourceMode, auth.manifest.retrieval.scopes,
        auth.manifest.retrieval.minRelevantItems ?? 0,
      ),
      counts: {},
      confidence: "insufficient",
      latencyMs: 0,
      hits: [],
      influence: emptyInfluence(),
      gate: { decision: "refuse", reason: planResult.reason },
      overridesClamped: auth.overridesClamped,
      droppedClientKeys: auth.droppedClientKeys,
      genericOutputRisk: "high",
      drift: computeDrift({
        currentSkillId: auth.manifest.id,
        currentAccountId: input.ctx.thread?.account?.id,
        prior: input.ctx.prior,
      }),
      chainDepth: chainCheck.depth,
      whyThisSkill: `Refused at planner: ${planResult.reason}`,
      runId: auth.runId,
    });
    return { ok: false, envelope: stub, reason: planResult.reason, code: planResult.reason };
  }

  const plan = planResult.plan;
  const retrievalArgs = planToRetrievalArgs(plan);

  // Hardening: bound the retriever call. Synthesis budget lives elsewhere.
  const budgetMs = deps.retrievalBudgetMs ?? retrievalBudgetFor(plan.depth);

  const t0 = now();
  let kis: any[] = [];
  let pbs: any[] = [];
  let counts: RetrievalCounts = {};
  let hits: LibraryHit[] = [];
  try {
    const raced = await withTimeout(
      retrieve(input.supabase as any, input.userId, {}, {
        scopes: retrievalArgs.scopes,
        maxKIs: retrievalArgs.maxKIs,
        maxPlaybooks: retrievalArgs.maxPlaybooks,
      }),
      budgetMs,
    );
    if (raced === "__timeout__") {
      const reason = `retrieval_timeout: exceeded ${budgetMs}ms`;
      const stub = buildSkillEnvelope({
        ok: false,
        refusal: { reason, code: "retrieval_timeout" },
        manifest: {
          id: auth.manifest.id, version: auth.manifest.version,
          behaviorIntent: auth.manifest.behaviorIntent, workspace: auth.manifest.workspace,
        },
        plan, counts: {}, confidence: "insufficient",
        latencyMs: now() - t0, hits: [], influence: emptyInfluence(),
        gate: { decision: "refuse", reason },
        overridesClamped: auth.overridesClamped,
        droppedClientKeys: auth.droppedClientKeys,
        genericOutputRisk: "high",
        drift: computeDrift({
          currentSkillId: auth.manifest.id,
          currentAccountId: input.ctx.thread?.account?.id,
          prior: input.ctx.prior,
        }),
        chainDepth: chainCheck.depth,
        whyThisSkill: `Refused: ${reason}`,
        runId: auth.runId,
      });
      return { ok: false, envelope: stub, reason, code: "retrieval_timeout" };
    }
    kis = raced.knowledgeItems ?? [];
    pbs = raced.playbooks ?? [];
    counts = { knowledge_items: kis.length, playbooks: pbs.length };
    hits = asLibraryHits({ knowledgeItems: kis, playbooks: pbs });
  } catch (e) {
    const reason = `retrieval_error: ${(e as Error).message}`;
    const stub = buildSkillEnvelope({
      ok: false,
      refusal: { reason, code: "retrieval_error" },
      manifest: {
        id: auth.manifest.id, version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent, workspace: auth.manifest.workspace,
      },
      plan, counts, confidence: "insufficient",
      latencyMs: now() - t0, hits, influence: emptyInfluence(),
      gate: { decision: "refuse", reason },
      overridesClamped: auth.overridesClamped,
      droppedClientKeys: auth.droppedClientKeys,
      genericOutputRisk: "high",
      drift: computeDrift({
        currentSkillId: auth.manifest.id,
        currentAccountId: input.ctx.thread?.account?.id,
        prior: input.ctx.prior,
      }),
      chainDepth: chainCheck.depth,
      whyThisSkill: `Refused: ${reason}`,
      runId: auth.runId,
    });
    return { ok: false, envelope: stub, reason, code: "retrieval_error" };
  }
  const latencyMs = now() - t0;

  const classified = classifyHits(hits, plan.termSeeds);
  const influence = computeLibraryInfluence(classified);

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

  const drift: DriftSignal = computeDrift({
    currentSkillId: auth.manifest.id,
    currentAccountId: input.ctx.thread?.account?.id,
    prior: input.ctx.prior,
  });
  const genericOutputRisk = computeGenericOutputRisk({
    manifest: auth.manifest, confidence, influence,
  });
  const whyThisSkill = buildWhyThisSkill({
    manifest: auth.manifest, plan, gate, confidence, influence,
  });

  if (gate.decision === "refuse") {
    const env = buildSkillEnvelope({
      ok: false,
      refusal: { reason: gate.reason, code: "source_mode_gate" },
      manifest: {
        id: auth.manifest.id, version: auth.manifest.version,
        behaviorIntent: auth.manifest.behaviorIntent, workspace: auth.manifest.workspace,
      },
      plan, counts, confidence, latencyMs,
      hits: classified, influence, gate,
      overridesClamped: auth.overridesClamped,
      droppedClientKeys: auth.droppedClientKeys,
      genericOutputRisk, drift,
      chainDepth: chainCheck.depth,
      whyThisSkill,
      runId: auth.runId,
    });
    return { ok: false, envelope: env, reason: gate.reason, code: "source_mode_gate" };
  }

  const synthesisAddendum = buildSynthesisAddendum({
    manifest: auth.manifest,
    hits: classified,
    overridesClamped: auth.overridesClamped,
    sourceModeWarning: gate.decision === "warn" ? gate.reason : undefined,
  });

  const envelope = buildSkillEnvelope({
    ok: true,
    manifest: {
      id: auth.manifest.id, version: auth.manifest.version,
      behaviorIntent: auth.manifest.behaviorIntent, workspace: auth.manifest.workspace,
    },
    plan, counts, confidence, latencyMs,
    hits: classified, influence, gate,
    overridesClamped: auth.overridesClamped,
    droppedClientKeys: auth.droppedClientKeys,
    genericOutputRisk, drift,
    chainDepth: chainCheck.depth,
    whyThisSkill,
    runId: auth.runId,
  });

  return { ok: true, envelope, synthesisAddendum, hits: classified };
}
