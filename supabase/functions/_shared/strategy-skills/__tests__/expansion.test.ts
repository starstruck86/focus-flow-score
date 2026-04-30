/**
 * Phase 3B — Retrieval Expansion Layer (server, authoritative) tests.
 *
 * Validates the SERVER-SIDE planner's expansion behavior. The server
 * is the source of truth — strategy-chat rebuilds the plan and never
 * trusts client-supplied expanded seeds.
 *
 * Acceptance criteria:
 *   1. "platform consolidation" expands into sales concepts.
 *   2. Deterministic.
 *   3. planHash changes when expansion is on vs off.
 *   4. Client cannot inject expandedSeeds (envelope sanitizer + planner re-derives).
 *   5. Expansion does NOT satisfy unresolvedBindings.
 *   6. library_required still refuses on zero hits even with expansion on.
 */
import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildPlan, scoreConfidence } from "../planner.ts";
import { expandSeeds } from "../expansion.ts";
import { LEXICON_VERSION } from "../salesLexicon.ts";
import { applySourceModeGate } from "../sourceModeGate.ts";
import { commercialInsightManifest } from "../manifests.ts";
import { resolveAuthority } from "../authority.ts";

const ctx = { thread: { threadId: "t-srv-1" } };

Deno.test("3B-1. expands business language into sales vocabulary", () => {
  const r = expandSeeds(["guest experience platform consolidation"], ctx, { enabled: true });
  assert(r.expansionEnabled);
  assert(r.expandedSeeds.length > 0);
  const lower = r.expandedSeeds.map((s) => s.toLowerCase());
  assert(lower.includes("change management"));
  assert(lower.includes("business case"));
  assert(lower.includes("discovery"));
  for (const e of r.expansionTrace) {
    assertEquals(e.lexiconVersion, LEXICON_VERSION);
  }
});

Deno.test("3B-2. expansion is deterministic", () => {
  const a = expandSeeds(["platform consolidation"], ctx, { enabled: true });
  const b = expandSeeds(["platform consolidation"], ctx, { enabled: true });
  assertEquals(a.expandedSeeds, b.expandedSeeds);
  assertEquals(a.expansionTrace, b.expansionTrace);
});

Deno.test("3B-3. planHash changes when expansion engages", () => {
  const inputs = { topic: "platform consolidation", industry: "hospitality", persona: "General Manager" };
  const off = buildPlan(commercialInsightManifest, "standard", inputs, ctx, { enabled: false });
  const on  = buildPlan(commercialInsightManifest, "standard", inputs, ctx, { enabled: true  });
  assert(off.ok && on.ok);
  if (!off.ok || !on.ok) return;
  assert(on.plan.expandedSeeds.length > 0);
  assertEquals(off.plan.expandedSeeds.length, 0);
  assertNotEquals(on.plan.planHash, off.plan.planHash);
  assertNotEquals(on.plan.contextHash, off.plan.contextHash);
});

Deno.test("3B-4. client cannot inject expandedSeeds — envelope sanitizer drops + planner re-derives", () => {
  // The sanitizer drops unknown keys at the envelope boundary. Even if a
  // caller embeds extras in `inputs`, the planner only consults raw
  // termSeeds + ctx anchors when computing expansion.
  const auth = resolveAuthority({
    id: "commercial-insight",
    inputs: {
      topic: "platform consolidation",
      industry: "hospitality",
      persona: "General Manager",
      // Attempted injections — must NOT propagate as expanded seeds.
      expandedSeeds: ["INJECTED_BAD_SEED"],
      expansionTrace: [{ term: "INJECTED_BAD_SEED", source: "lexicon", rule: "x", lexiconVersion: "fake" }],
    },
    // Forbidden top-level keys (sourceMode, manifest, retrieval) handled by sanitizer.
  } as unknown as Parameters<typeof resolveAuthority>[0]);
  assert(auth.ok);
  if (!auth.ok) return;

  const r = buildPlan(auth.manifest, auth.effectiveDepth, auth.inputs, ctx, { enabled: true });
  assert(r.ok);
  if (!r.ok) return;
  assert(!r.plan.expandedSeeds.includes("INJECTED_BAD_SEED"));
  for (const e of r.plan.expansionTrace) {
    assertEquals(e.lexiconVersion, LEXICON_VERSION);
  }
});

Deno.test("3B-5. expansion does NOT satisfy unresolvedBindings", () => {
  // Omit `topic`; expansion of other seeds must not mark topic as resolved.
  const r = buildPlan(
    commercialInsightManifest,
    "standard",
    { industry: "hospitality" },
    ctx,
    { enabled: true },
  );
  assert(r.ok);
  if (!r.ok) return;
  assert(r.plan.unresolvedBindings.includes("${inputs.topic}"));
});

Deno.test("3B-6. library_required-style refusal still fires on zero hits despite expansion", () => {
  // Build a plan with expansion ON, then simulate the gate seeing zero hits.
  const r = buildPlan(
    commercialInsightManifest,
    "standard",
    { topic: "platform consolidation", industry: "hospitality", persona: "General Manager" },
    ctx,
    { enabled: true },
  );
  assert(r.ok);
  if (!r.ok) return;
  assert(r.plan.expandedSeeds.length > 0);
  // Force library_required to prove the gate is unmoved by expansion width.
  const counts = {};
  const conf = scoreConfidence({ counts, entityScoped: r.plan.entityScoped, minRelevantItems: r.plan.minRelevantItems });
  assertEquals(conf, "insufficient");
  const gate = applySourceModeGate({
    sourceMode: "library_required",
    counts,
    confidence: conf,
    minRelevantItems: r.plan.minRelevantItems,
  });
  assertEquals(gate.decision, "refuse");
});
