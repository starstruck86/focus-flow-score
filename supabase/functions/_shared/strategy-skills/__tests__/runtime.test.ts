/**
 * Phase 3 — server-side skill runtime tests (A–O, no artifact execution).
 *
 * Covers:
 *   A. Authority resolution (skill wins; client overrides clamped)
 *   B. Unknown skill / invalid envelope refusal (no silent fallback)
 *   C. Server-rebuilt plan (planner is deterministic, hash-stable)
 *   D. Plan → existing-retrieval adapter shape parity
 *   E. Source-mode gate: library_required refuses with no hits
 *   F. Source-mode gate: library_required refuses w/o standardish hit
 *   G. Source-mode gate: library_first warns under threshold, refuses at zero
 *   H. Source-mode gate: library_relevant warns at zero, never refuses
 *   I. Insufficient context refusal (no terms, no entities)
 *   J. Forbidden static keys are rejected
 *   K. Synthesis addendum cites library + locks behavior intent
 *   L. Skill envelope schema is stable; trace exposes plan hash
 *   M. Show-proof read path returns the structured proof view
 *   N. Override clamping reports without mutating manifest behavior
 *   O. Runtime end-to-end with injected retriever, deterministic clock
 */
import { assert, assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPlan,
  scoreConfidence,
  resolveBindings,
} from "../planner.ts";
import { resolveAuthority } from "../authority.ts";
import { planToRetrievalArgs } from "../adapter.ts";
import { applySourceModeGate } from "../sourceModeGate.ts";
import { buildSynthesisAddendum } from "../synthesisAddendum.ts";
import { buildSkillEnvelope, readProof } from "../trace.ts";
import { runSkill } from "../runtime.ts";
import { SKILL_REGISTRY, conversationPovManifest, discoveryPrepManifest, executiveBriefManifest, accountResearchManifest } from "../manifests.ts";

// ── A ────────────────────────────────────────────────────────────────
Deno.test("A. authority — skill wins; client overrides are clamped", () => {
  const auth = resolveAuthority({
    id: "conversation-pov",
    behaviorIntent: "research_brief", // attempted override
    workspace: "library",              // attempted override
    depth: "deep",
    inputs: { account: "Acme", persona: "CIO" },
  });
  assert(auth.ok);
  if (!auth.ok) return;
  assertEquals(auth.manifest.id, "conversation-pov");
  assertEquals(auth.manifest.behaviorIntent, "conversation_strategy");
  assertEquals(auth.manifest.workspace, "work");
  assertEquals(auth.effectiveDepth, "deep");
  assert(auth.overridesClamped.includes("behaviorIntent"));
  assert(auth.overridesClamped.includes("workspace"));
});

// ── B ────────────────────────────────────────────────────────────────
Deno.test("B. authority — unknown skill / invalid envelope refuse, no silent fallback", () => {
  const a = resolveAuthority({ id: "not-a-skill" });
  assert(!a.ok);
  if (!a.ok) assertEquals(a.reason, "unknown_skill");

  const b = resolveAuthority({ id: "" });
  assert(!b.ok);

  const c = resolveAuthority(null);
  assert(!c.ok);
});

// ── C ────────────────────────────────────────────────────────────────
Deno.test("C. plan — deterministic and hash-stable", () => {
  const ctx = { thread: { threadId: "t1", account: { id: "a1", name: "Acme" } } };
  const p1 = buildPlan(conversationPovManifest, "standard", { account: "Acme", persona: "CIO" }, ctx);
  const p2 = buildPlan(conversationPovManifest, "standard", { account: "Acme", persona: "CIO" }, ctx);
  assert(p1.ok && p2.ok);
  if (!(p1.ok && p2.ok)) return;
  assertEquals(p1.plan.planHash, p2.plan.planHash);
  assertEquals(p1.plan.contextHash, p2.plan.contextHash);
  assert(p1.plan.termSeeds.length >= 2);
  assert(p1.plan.entityScoped);
});

// ── D ────────────────────────────────────────────────────────────────
Deno.test("D. adapter — maps to existing retriever args (no parallel stack)", () => {
  const plan = buildPlan(conversationPovManifest, "standard",
    { account: "Acme", persona: "CIO", topic: "platform consolidation" }, {});
  assert(plan.ok); if (!plan.ok) return;
  const args = planToRetrievalArgs(plan.plan);
  // Shape parity with retrieveLibraryContext's RetrieveOpts:
  assertEquals(typeof args.maxKIs, "number");
  assertEquals(typeof args.maxPlaybooks, "number");
  assert(Array.isArray(args.scopes));
  // Keywords mirror term seeds.
  assert(args.scopes.includes("Acme"));
  assert(args.scopes.includes("CIO"));
  // Caps respect planner budget.
  assertEquals(args.maxKIs, 8);
  assertEquals(args.maxPlaybooks, 3);
});

// ── E ────────────────────────────────────────────────────────────────
Deno.test("E. source-mode — library_required refuses on zero hits", () => {
  const g = applySourceModeGate({
    sourceMode: "library_required", counts: {},
    confidence: "insufficient", minRelevantItems: 3,
  });
  assertEquals(g.decision, "refuse");
});

// ── F ────────────────────────────────────────────────────────────────
Deno.test("F. source-mode — library_required passes with KI-dominant proof (meaningful influence)", () => {
  // KI-dominant with meaningful influence: 5 KIs, 3 supporting → pass
  const g = applySourceModeGate({
    sourceMode: "library_required",
    counts: { knowledge_items: 5 },
    confidence: "medium",
    minRelevantItems: 3,
    influence: { primary: 2, supporting: 3, weak: 0 },
  });
  assertEquals(g.decision, "pass");

  // Without influence data, falls back to count-based check → pass
  const g_noInf = applySourceModeGate({
    sourceMode: "library_required",
    counts: { knowledge_items: 5 },
    confidence: "medium",
    minRelevantItems: 3,
  });
  assertEquals(g_noInf.decision, "pass");

  // Below KI threshold AND no standardish → warn (partial proof)
  const g2 = applySourceModeGate({
    sourceMode: "library_required",
    counts: { knowledge_items: 1 },
    confidence: "low",
    minRelevantItems: 3,
    influence: { primary: 0, supporting: 1, weak: 0 },
  });
  assertEquals(g2.decision, "warn");
});

// ── G ────────────────────────────────────────────────────────────────
Deno.test("G. source-mode — library_first warns at zero and under threshold, never refuses", () => {
  // Zero hits → WARN (not refuse)
  const warn0 = applySourceModeGate({
    sourceMode: "library_first", counts: {},
    confidence: "insufficient", minRelevantItems: 2,
  });
  assertEquals(warn0.decision, "warn");

  const warn = applySourceModeGate({
    sourceMode: "library_first", counts: { knowledge_items: 1 },
    confidence: "low", minRelevantItems: 2,
  });
  assertEquals(warn.decision, "warn");

  const pass = applySourceModeGate({
    sourceMode: "library_first", counts: { knowledge_items: 2, playbooks: 1 },
    confidence: "high", minRelevantItems: 2,
  });
  assertEquals(pass.decision, "pass");
});

// ── H ────────────────────────────────────────────────────────────────
Deno.test("H. source-mode — library_relevant warns at zero, never refuses", () => {
  const warn = applySourceModeGate({
    sourceMode: "library_relevant", counts: {},
    confidence: "insufficient", minRelevantItems: 1,
  });
  assertEquals(warn.decision, "warn");
  const pass = applySourceModeGate({
    sourceMode: "library_relevant", counts: { knowledge_items: 1 },
    confidence: "low", minRelevantItems: 1,
  });
  assertEquals(pass.decision, "pass");
});

// ── I ────────────────────────────────────────────────────────────────
Deno.test("I. plan — refuses on insufficient context (no terms, no entities)", () => {
  const r = buildPlan(conversationPovManifest, "standard", {}, {});
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "insufficient_context");
});

// ── J ────────────────────────────────────────────────────────────────
Deno.test("J. plan — forbidden static keys are rejected", () => {
  const tainted = { ...conversationPovManifest, retrieval: { ...conversationPovManifest.retrieval, resource_ids: "x" as any } } as any;
  const r = buildPlan(tainted, "standard", { account: "Acme" }, {});
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "forbidden_static_key");
});

// ── K ────────────────────────────────────────────────────────────────
Deno.test("K. addendum — cites library and locks behavior intent", () => {
  const txt = buildSynthesisAddendum({
    manifest: conversationPovManifest,
    hits: [
      { kind: "knowledge_item", id: "abcdef0123", title: "Spin selling for CIO", context: "Discovery" },
      { kind: "playbook", id: "11112222", title: "Platform consolidation play" },
    ],
    overridesClamped: ["behaviorIntent"],
  });
  assert(txt.includes("Behavior intent (locked): conversation_strategy"));
  assert(txt.includes("Library hits to ground the answer"));
  assert(txt.includes("Spin selling for CIO"));
  assert(txt.includes("ignored. Manifest is authoritative"));
});

// ── L ────────────────────────────────────────────────────────────────
Deno.test("L. envelope — schema stable, exposes plan hash + counts", () => {
  const plan = buildPlan(conversationPovManifest, "standard", { account: "Acme", persona: "CIO" }, {});
  assert(plan.ok); if (!plan.ok) return;
  const env = buildSkillEnvelope({
    ok: true,
    manifest: { id: "conversation-pov", version: "1", behaviorIntent: "conversation_strategy", workspace: "work" },
    plan: plan.plan,
    counts: { knowledge_items: 3, playbooks: 1 },
    confidence: "high",
    latencyMs: 42,
    hits: [],
    influence: { primary: 0, supporting: 0, weak: 0, total: 0, primary_dominant: false },
    gate: { decision: "pass" },
    overridesClamped: [],
    droppedClientKeys: [],
    genericOutputRisk: "low",
    drift: { changed_skill: false, same_account: false, to: "conversation-pov" },
    chainDepth: 0,
    whyThisSkill: "test",
  });
  assertEquals(env.schema, "skill_envelope.v1");
  assertEquals(env.trace.schema, "skill_trace.v1");
  assertEquals(env.trace.plan.plan_hash, plan.plan.planHash);
  assertEquals(env.trace.retrieval.confidence, "high");
});

// ── M ────────────────────────────────────────────────────────────────
Deno.test("M. show-proof — read path returns structured view", () => {
  const plan = buildPlan(discoveryPrepManifest, "artifact",
    { account: "Acme", persona: "CIO", stage: "discovery", topic: "consolidation" },
    { thread: { threadId: "t1", account: { id: "a1" } } });
  assert(plan.ok); if (!plan.ok) return;
  const env = buildSkillEnvelope({
    ok: true,
    manifest: { id: "discovery-prep", version: "1", behaviorIntent: "discovery_prep", workspace: "artifacts" },
    plan: plan.plan,
    counts: { knowledge_items: 4, playbooks: 2, standards: 1 },
    confidence: "high",
    latencyMs: 100,
    hits: [{ kind: "knowledge_item", id: "k1", title: "Discovery KI" }],
    influence: { primary: 0, supporting: 0, weak: 1, total: 1, primary_dominant: false },
    gate: { decision: "pass" },
    overridesClamped: [],
    droppedClientKeys: [],
    genericOutputRisk: "low",
    drift: { changed_skill: false, same_account: false, to: "discovery-prep" },
    chainDepth: 0,
    whyThisSkill: "test",
  });
  const proof = readProof(env);
  assertExists(proof);
  assertEquals(proof!.skill.id, "discovery-prep");
  assertEquals(proof!.retrieval.hits[0].title, "Discovery KI");
  assertEquals(proof!.gate.decision, "pass");
});

// ── N ────────────────────────────────────────────────────────────────
Deno.test("N. override clamping — reported without mutating manifest", () => {
  const before = conversationPovManifest.behaviorIntent;
  const auth = resolveAuthority({
    id: "conversation-pov", behaviorIntent: "objection_handling", workspace: "library",
    inputs: { account: "Acme" },
  });
  assert(auth.ok); if (!auth.ok) return;
  assertEquals(auth.overridesClamped.length, 2);
  assertEquals(conversationPovManifest.behaviorIntent, before);
});

// ── O ────────────────────────────────────────────────────────────────
Deno.test("O. runtime — end-to-end with injected retriever, deterministic clock", async () => {
  let calls = 0;
  let receivedArgs: any = null;
  const fakeRetrieve = async (
    _supabase: any,
    _userId: string,
    _inputs: any,
    opts: { scopes: string[]; maxKIs?: number; maxPlaybooks?: number },
  ) => {
    calls++;
    receivedArgs = opts;
    return {
      knowledgeItems: [{ id: "k-1", title: "How to run a discovery call", chapter: "Discovery", score: 5 }],
      playbooks: [{ id: "p-1", title: "Mid-market discovery", problem_type: "discovery", score: 4 }],
      contextString: "",
      counts: { kis: 1, playbooks: 1 },
    };
  };
  let t = 1000;
  const clock = () => { t += 7; return t; };

  const result = await runSkill({
    envelope: { id: "conversation-pov", inputs: { account: "Acme", persona: "CIO" } },
    ctx: { thread: { threadId: "t1", account: { id: "a1" } } },
    supabase: {},
    userId: "u1",
  }, { retrieve: fakeRetrieve as any, now: clock });

  assert(result.ok);
  if (!result.ok) return;
  assertEquals(calls, 1);
  assert(Array.isArray(receivedArgs.scopes));
  assertEquals(result.envelope.trace.skill_id, "conversation-pov");
  assertEquals(result.envelope.trace.retrieval.counts.knowledge_items, 1);
  assertEquals(result.envelope.trace.retrieval.counts.playbooks, 1);
  assertEquals(result.envelope.trace.gate.decision, "pass");
  assert(result.synthesisAddendum.includes("Behavior intent (locked): conversation_strategy"));
});

// ── extra: catalog parity ─────────────────────────────────────────
Deno.test("catalog — server registry matches frontend skill ids", () => {
  const expected = [
    "conversation-pov", "discovery-prep", "commercial-insight", "account-research",
    "discovery-questions", "meddicc-review", "demo-strategy", "follow-up-email",
    "objection-strategy", "executive-brief",
  ].sort();
  const actual = Object.keys(SKILL_REGISTRY).sort();
  assertEquals(actual, expected);
});

// ── extra: library_required end-to-end refusal ────────────────────
Deno.test("E2E — library_required skill refuses when retriever returns empty", async () => {
  const fakeRetrieve = async () => ({
    knowledgeItems: [], playbooks: [], contextString: "", counts: { kis: 0, playbooks: 0 },
  });
  const result = await runSkill({
    envelope: {
      id: "executive-brief",
      inputs: { account: "Acme", persona: "CIO", stage: "discovery", topic: "consolidation" },
    },
    ctx: { thread: { threadId: "t1", account: { id: "a1" } } },
    supabase: {},
    userId: "u1",
  }, { retrieve: fakeRetrieve as any });
  assert(!result.ok);
  if (result.ok) return;
  assertEquals(result.code, "source_mode_gate");
});

// ── extra: bindings stop-list & dedupe ────────────────────────────
Deno.test("bindings — stop-list filters generic terms, dedupes case-insensitively", () => {
  const r = resolveBindings(
    ["${inputs.account}", "${inputs.persona}", "${inputs.thing}", "${inputs.account}"],
    { account: "Acme", persona: "CIO", thing: "deal" }, {},
  );
  assertEquals(r.termSeeds.length, 2);
  assert(r.unresolvedBindings.includes("${inputs.thing}"));
});

// ── extra: confidence scorer ─────────────────────────────────────
Deno.test("confidence — high requires entity + threshold + strong proof (standardish OR KI-dominant)", () => {
  assertEquals(scoreConfidence({ counts: {}, entityScoped: false, minRelevantItems: 1 }), "insufficient");
  // KI-only with entity scoping → high (KI-dominant path)
  assertEquals(scoreConfidence({ counts: { knowledge_items: 3 }, entityScoped: true, minRelevantItems: 2 }), "high");
  assertEquals(scoreConfidence({ counts: { knowledge_items: 3, standards: 1 }, entityScoped: true, minRelevantItems: 2 }), "high");
  // KI-only without entity scoping → medium (not high)
  assertEquals(scoreConfidence({ counts: { knowledge_items: 3 }, entityScoped: false, minRelevantItems: 2 }), "medium");
});
