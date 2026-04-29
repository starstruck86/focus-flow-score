/**
 * Phase 3A — hardening tests.
 *
 * Covers:
 *   P. Strict envelope sanitizer drops `sourceMode` and unknown keys
 *   Q. Forbidden-attempted is reported in trace.dropped_client_keys
 *   R. Version mismatch refuses (no silent drift)
 *   S. Chain depth cap refuses beyond MAX_CHAIN_DEPTH
 *   T. Library hits are classified (primary / supporting / weak)
 *   U. computeLibraryInfluence rolls up correctly
 *   V. Generic-output risk responds to confidence + tolerance
 *   W. Drift signal flags skill change + same-account continuity
 *   X. why_this_skill rationale always present in trace
 *   Y. Planner output is JSON round-trip stable (purity)
 *   Z. Retrieval timeout refuses with code=retrieval_timeout
 *   ZA. Deterministic resolution: same inputs → same envelope (modulo clock)
 *   ZB. End-to-end: trace exposes all 3A fields
 */
import {
  assert,
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  assertPlannerPurity,
  buildWhyThisSkill,
  checkChainDepth,
  classifyHits,
  computeDrift,
  computeGenericOutputRisk,
  computeLibraryInfluence,
  MAX_CHAIN_DEPTH,
  sanitizeClientEnvelope,
} from "../hardening.ts";
import { resolveAuthority } from "../authority.ts";
import { buildPlan } from "../planner.ts";
import { runSkill } from "../runtime.ts";
import {
  conversationPovManifest,
  executiveBriefManifest,
} from "../manifests.ts";

// ── P ────────────────────────────────────────────────────────────────
Deno.test("P. sanitizer — drops `sourceMode` and unknown keys", () => {
  const r = sanitizeClientEnvelope({
    id: "conversation-pov",
    sourceMode: "library_relevant", // forbidden
    overrides: { sourceMode: "library_relevant" }, // forbidden
    inputs: { account: "Acme" },
    foo: "bar", // unknown
  });
  assert(r.forbiddenAttempted);
  assert(r.droppedKeys.includes("forbidden:sourceMode"));
  assert(r.droppedKeys.includes("forbidden:overrides"));
  assert(r.droppedKeys.includes("unknown:foo"));
  assertEquals((r.sanitized as any).sourceMode, undefined);
  assertEquals((r.sanitized as any).id, "conversation-pov");
});

// ── Q ────────────────────────────────────────────────────────────────
Deno.test("Q. authority — reports dropped client keys + forbidden flag", () => {
  const auth = resolveAuthority({
    id: "conversation-pov",
    inputs: { account: "Acme" },
    sourceMode: "library_relevant",
    bogus: 1,
  });
  assert(auth.ok); if (!auth.ok) return;
  assert(auth.forbiddenAttempted);
  assert(auth.droppedClientKeys.includes("forbidden:sourceMode"));
  assert(auth.droppedClientKeys.includes("unknown:bogus"));
  // Manifest's source mode is unchanged.
  assertEquals(auth.manifest.sourceMode, "library_first");
});

// ── R ────────────────────────────────────────────────────────────────
Deno.test("R. authority — version mismatch refuses", () => {
  const auth = resolveAuthority({
    id: "conversation-pov",
    expectedVersion: "99",
    inputs: { account: "Acme" },
  });
  assert(!auth.ok); if (auth.ok) return;
  assertEquals(auth.reason, "version_mismatch");
  assertEquals((auth as any).expected, "99");
  assertEquals((auth as any).actual, "1");
});

// ── S ────────────────────────────────────────────────────────────────
Deno.test("S. chain depth — refuses beyond MAX_CHAIN_DEPTH", async () => {
  const fakeRetrieve = async () => ({
    knowledgeItems: [], playbooks: [], contextString: "", counts: { kis: 0, playbooks: 0 },
  });
  const r = await runSkill({
    envelope: {
      id: "conversation-pov",
      inputs: { account: "Acme", persona: "CIO" },
      chainDepth: MAX_CHAIN_DEPTH + 1,
    },
    ctx: { thread: { threadId: "t1", account: { id: "a1" } } },
    supabase: {}, userId: "u1",
  }, { retrieve: fakeRetrieve as any });
  assert(!r.ok); if (r.ok) return;
  assertEquals(r.code, "chain_depth_exceeded");
  assertEquals(r.envelope.trace.chain_depth, MAX_CHAIN_DEPTH + 1);
});

Deno.test("S2. checkChainDepth — coerces / clamps non-numeric", () => {
  assertEquals(checkChainDepth(undefined).ok, true);
  assertEquals(checkChainDepth("nope" as any).ok, true);
  assertEquals(checkChainDepth(MAX_CHAIN_DEPTH).ok, true);
  assertEquals(checkChainDepth(MAX_CHAIN_DEPTH + 5).ok, false);
});

// ── T ────────────────────────────────────────────────────────────────
Deno.test("T. classifyHits — primary / supporting / weak by token overlap", () => {
  const classified = classifyHits(
    [
      { kind: "knowledge_item", id: "1", title: "Acme platform consolidation playbook" },
      { kind: "knowledge_item", id: "2", title: "CIO discovery questions" },
      { kind: "knowledge_item", id: "3", title: "Random unrelated whitepaper" },
      { kind: "playbook", id: "4", title: "Acme renewal play" },
    ],
    ["Acme", "platform", "CIO"],
  );
  // [1] has 2 matches (acme, platform) → primary
  assertEquals(classified[0].relevance_class, "primary");
  // [2] has 1 match (cio) → supporting
  assertEquals(classified[1].relevance_class, "supporting");
  // [3] has 0 matches → weak
  assertEquals(classified[2].relevance_class, "weak");
  // [4] is a playbook with ≥1 match → primary
  assertEquals(classified[3].relevance_class, "primary");
});

// ── U ────────────────────────────────────────────────────────────────
Deno.test("U. computeLibraryInfluence — rollups + primary_dominant", () => {
  const inf = computeLibraryInfluence([
    { kind: "knowledge_item", id: "1", title: "x", relevance_class: "primary", matched_terms: [] },
    { kind: "knowledge_item", id: "2", title: "x", relevance_class: "primary", matched_terms: [] },
    { kind: "knowledge_item", id: "3", title: "x", relevance_class: "supporting", matched_terms: [] },
    { kind: "knowledge_item", id: "4", title: "x", relevance_class: "weak", matched_terms: [] },
  ]);
  assertEquals(inf.primary, 2);
  assertEquals(inf.supporting, 1);
  assertEquals(inf.weak, 1);
  assertEquals(inf.total, 4);
  assert(inf.primary_dominant);

  const empty = computeLibraryInfluence([]);
  assertEquals(empty.total, 0);
  assertEquals(empty.primary_dominant, false);
});

// ── V ────────────────────────────────────────────────────────────────
Deno.test("V. genericOutputRisk — escalates with low confidence + zero tolerance", () => {
  const inf = { primary: 2, supporting: 0, weak: 0, total: 2, primary_dominant: true };
  // Strict skill (maxGenericMarkers=0): executiveBriefManifest
  assertEquals(
    computeGenericOutputRisk({ manifest: executiveBriefManifest, confidence: "low", influence: inf }),
    "high",
  );
  // Tolerant skill: conversationPovManifest (max=1)
  assertEquals(
    computeGenericOutputRisk({ manifest: conversationPovManifest, confidence: "low", influence: inf }),
    "medium",
  );
  // High confidence + primary-dominant → low risk.
  assertEquals(
    computeGenericOutputRisk({ manifest: conversationPovManifest, confidence: "high", influence: inf }),
    "low",
  );
  // Insufficient confidence is always high.
  assertEquals(
    computeGenericOutputRisk({
      manifest: conversationPovManifest, confidence: "insufficient",
      influence: { ...inf, total: 0, primary: 0, primary_dominant: false },
    }),
    "high",
  );
});

// ── W ────────────────────────────────────────────────────────────────
Deno.test("W. drift — flags skill change + same-account continuity", () => {
  const d = computeDrift({
    currentSkillId: "conversation-pov",
    currentAccountId: "a1",
    prior: { lastSkillId: "discovery-prep", lastAccountId: "a1" },
  });
  assert(d.changed_skill);
  assert(d.same_account);
  assertEquals(d.from, "discovery-prep");
  assertEquals(d.to, "conversation-pov");

  const d2 = computeDrift({
    currentSkillId: "conversation-pov",
    currentAccountId: "a2",
    prior: { lastSkillId: "conversation-pov", lastAccountId: "a1" },
  });
  assert(!d2.changed_skill);
  assert(!d2.same_account);
});

// ── X ────────────────────────────────────────────────────────────────
Deno.test("X. why_this_skill — present and references seeds + gate", () => {
  const plan = buildPlan(conversationPovManifest, "standard",
    { account: "Acme", persona: "CIO" }, {});
  assert(plan.ok); if (!plan.ok) return;
  const why = buildWhyThisSkill({
    manifest: conversationPovManifest,
    plan: plan.plan,
    gate: { decision: "pass" },
    confidence: "high",
    influence: { primary: 2, supporting: 1, weak: 0, total: 3, primary_dominant: true },
  });
  assert(why.includes("Conversation POV"));
  assert(why.includes("intent=conversation_strategy"));
  assert(why.includes("Acme"));
  assert(why.includes("proof burden met"));
});

// ── Y ────────────────────────────────────────────────────────────────
Deno.test("Y. planner purity — plan is JSON round-trip stable", () => {
  const plan = buildPlan(conversationPovManifest, "standard",
    { account: "Acme", persona: "CIO", topic: "consolidation" },
    { thread: { threadId: "t1", account: { id: "a1" } } });
  assert(plan.ok); if (!plan.ok) return;
  // Must not throw.
  assertPlannerPurity(plan.plan);
});

// ── Z ────────────────────────────────────────────────────────────────
Deno.test("Z. retrieval timeout — refuses with retrieval_timeout code", async () => {
  const slowRetrieve = (_s: any, _u: any, _i: any, _o: any) =>
    new Promise(() => { /* never resolves */ });
  const r = await runSkill({
    envelope: { id: "conversation-pov", inputs: { account: "Acme", persona: "CIO" } },
    ctx: { thread: { threadId: "t1", account: { id: "a1" } } },
    supabase: {}, userId: "u1",
  }, { retrieve: slowRetrieve as any, retrievalBudgetMs: 25 });
  assert(!r.ok); if (r.ok) return;
  assertEquals(r.code, "retrieval_timeout");
  assertEquals(r.envelope.trace.gate.decision, "refuse");
});

// ── ZA ───────────────────────────────────────────────────────────────
Deno.test("ZA. determinism — same inputs produce identical envelope (modulo clock)", async () => {
  const fakeRetrieve = async () => ({
    knowledgeItems: [
      { id: "k1", title: "Acme consolidation deep dive", chapter: "Discovery", score: 5 },
    ],
    playbooks: [
      { id: "p1", title: "Platform consolidation play", problem_type: "discovery", score: 4 },
    ],
    contextString: "", counts: { kis: 1, playbooks: 1 },
  });
  let t = 100;
  const fixedClock = () => { t += 5; return t; };

  const callOnce = () => runSkill({
    envelope: { id: "conversation-pov", inputs: { account: "Acme", persona: "CIO", topic: "consolidation" } },
    ctx: { thread: { threadId: "t1", account: { id: "a1" } } },
    supabase: {}, userId: "u1",
  }, { retrieve: fakeRetrieve as any, now: fixedClock });

  const a = await callOnce();
  t = 100;
  const b = await callOnce();
  assert(a.ok && b.ok); if (!(a.ok && b.ok)) return;
  // Plan + context hashes must match across runs.
  assertEquals(a.envelope.trace.plan.plan_hash, b.envelope.trace.plan.plan_hash);
  assertEquals(a.envelope.trace.plan.context_hash, b.envelope.trace.plan.context_hash);
  // Influence + risk + gate decision must match.
  assertEquals(a.envelope.trace.retrieval.influence, b.envelope.trace.retrieval.influence);
  assertEquals(a.envelope.trace.generic_output_risk, b.envelope.trace.generic_output_risk);
  assertEquals(a.envelope.trace.gate.decision, b.envelope.trace.gate.decision);
});

// ── ZB ───────────────────────────────────────────────────────────────
Deno.test("ZB. e2e — trace exposes every 3A field", async () => {
  const fakeRetrieve = async () => ({
    knowledgeItems: [
      { id: "k1", title: "Acme consolidation deep dive", chapter: "Discovery", score: 5 },
      { id: "k2", title: "Platform CIO POV", chapter: "POV", score: 4 },
    ],
    playbooks: [
      { id: "p1", title: "Platform consolidation play", problem_type: "discovery", score: 4 },
    ],
    contextString: "", counts: { kis: 2, playbooks: 1 },
  });
  const r = await runSkill({
    envelope: {
      id: "conversation-pov",
      inputs: { account: "Acme", persona: "CIO", topic: "platform" },
      sourceMode: "library_relevant", // must be dropped
      runId: "run-123",
    },
    ctx: {
      thread: { threadId: "t1", account: { id: "a1" } },
      prior: { lastSkillId: "discovery-prep", lastAccountId: "a1" },
    },
    supabase: {}, userId: "u1",
  }, { retrieve: fakeRetrieve as any });
  assert(r.ok); if (!r.ok) return;
  const t = r.envelope.trace;
  assertExists(t.why_this_skill);
  assertExists(t.drift);
  assertEquals(t.drift.from, "discovery-prep");
  assertEquals(t.drift.same_account, true);
  assertEquals(t.chain_depth, 0);
  assert(t.dropped_client_keys.includes("forbidden:sourceMode"));
  // Source mode came from the SERVER manifest, not the client.
  assertEquals(t.source_mode, "library_first");
  assert(t.retrieval.influence.total >= 1);
  assert(t.retrieval.hits.every((h: any) => "relevance_class" in h));
  assert(["low", "medium", "high"].includes(t.generic_output_risk));
  assertEquals(t.run_id, "run-123");
});
