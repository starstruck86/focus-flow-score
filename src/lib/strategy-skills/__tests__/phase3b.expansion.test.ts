// @vitest-environment node
/**
 * Phase 3B — Retrieval Expansion Layer (frontend mirror) tests.
 *
 * Validates the user-required acceptance criteria:
 *  1. Case 2-style input ("platform consolidation") expands into sales concepts.
 *  2. Expansion is deterministic (same inputs ⇒ identical output, repeatedly).
 *  3. planHash CHANGES when expansion produces different seeds.
 *  4. Client cannot inject expandedSeeds (planner ignores any preset; planner
 *     re-derives them from raw seeds + ctx).
 *  5. Expansion does NOT satisfy unresolvedBindings.
 *  6. library_required-style refusal still triggers when zero hits despite
 *     expansion (gate untouched — verified at the planner layer by ensuring
 *     expansion never lowers minRelevantItems and never marks bindings resolved).
 */
import { describe, it, expect } from 'vitest';
import { expandSeeds, EXPANSION_MAX } from '../planner/expandSeeds';
import { LEXICON_VERSION } from '../planner/salesLexicon';
import { buildPlan } from '../planner/buildPlan';
import { resolveSkill } from '../resolver';
import { SKILL_REGISTRY } from '../registry';
import type { PlannerContext } from '../planner';

const ctx: PlannerContext = { thread: { threadId: 't-1' } };

describe('Phase 3B — Retrieval Expansion Layer', () => {
  it('1. expands Case-2 business language into sales-vocabulary terms', () => {
    const r = expandSeeds(
      ['guest experience platform consolidation'],
      ctx,
      { enabled: true },
    );
    expect(r.expansionEnabled).toBe(true);
    expect(r.expandedSeeds.length).toBeGreaterThan(0);
    const lower = r.expandedSeeds.map((s) => s.toLowerCase());
    // Must surface the sales concepts the library is indexed in.
    expect(lower).toEqual(
      expect.arrayContaining(['change management', 'business case', 'discovery']),
    );
    // Trace must be explainable.
    for (const e of r.expansionTrace) {
      expect(e.lexiconVersion).toBe(LEXICON_VERSION);
      expect(['lexicon', 'context_anchor', 'persona_role']).toContain(e.source);
      expect(typeof e.rule).toBe('string');
    }
  });

  it('2. is deterministic — identical inputs produce identical outputs', () => {
    const a = expandSeeds(['platform consolidation', 'general manager'], ctx, { enabled: true });
    const b = expandSeeds(['platform consolidation', 'general manager'], ctx, { enabled: true });
    expect(a.expandedSeeds).toEqual(b.expandedSeeds);
    expect(a.expansionTrace).toEqual(b.expansionTrace);
    expect(a.lexiconVersion).toBe(b.lexiconVersion);
  });

  it('3. planHash changes when expansion produces different seeds', () => {
    const resolved = resolveSkill({ token: 'commercial-insight', inputs: { topic: 'pricing', industry: 'saas', persona: 'CIO' } });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;

    const off = buildPlan(resolved.resolved, ctx, { enabled: false });
    const on = buildPlan(resolved.resolved, ctx, { enabled: true });
    expect(off.ok && on.ok).toBe(true);
    if (!off.ok || !on.ok) return;

    expect(on.plan.expandedSeeds.length).toBeGreaterThan(0);
    expect(off.plan.expandedSeeds.length).toBe(0);
    // Hashes MUST diverge — caches must invalidate when expansion engages.
    expect(on.plan.planHash).not.toBe(off.plan.planHash);
    expect(on.plan.contextHash).not.toBe(off.plan.contextHash);
  });

  it('4. client cannot inject expandedSeeds — planner re-derives them', () => {
    const resolved = resolveSkill({
      token: 'commercial-insight',
      // Attempted client injection in inputs is ignored by the planner;
      // expandedSeeds is not a binding, and the planner only consults raw
      // termSeeds + ctx anchors when computing expansion.
      inputs: {
        topic: 'pricing',
        industry: 'saas',
        persona: 'CIO',
        expandedSeeds: ['INJECTED_BAD_SEED'],
        expansionTrace: [{ term: 'INJECTED_BAD_SEED', source: 'lexicon', rule: 'x', lexiconVersion: 'fake' }],
      },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const r = buildPlan(resolved.resolved, ctx, { enabled: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.expandedSeeds).not.toContain('INJECTED_BAD_SEED');
    for (const e of r.plan.expansionTrace) {
      expect(e.lexiconVersion).toBe(LEXICON_VERSION);
    }
  });

  it('5. expansion does NOT satisfy unresolvedBindings', () => {
    // commercial-insight binds ${inputs.topic} ${inputs.industry} ${inputs.persona}
    // (+ stage/methodology after the minimal patch). Omit topic; expansion
    // must not "resolve" the missing binding.
    const resolved = resolveSkill({
      token: 'commercial-insight',
      inputs: { industry: 'saas' },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const r = buildPlan(resolved.resolved, ctx, { enabled: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Topic binding stays unresolved despite any expansions of other seeds.
    expect(r.plan.unresolvedBindings).toEqual(
      expect.arrayContaining(['${inputs.topic}']),
    );
  });

  it('6. expansion never lowers minRelevantItems (gate untouched)', () => {
    const resolved = resolveSkill({
      token: 'commercial-insight',
      inputs: { topic: 'guest experience platform consolidation', industry: 'hospitality', persona: 'General Manager' },
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    const off = buildPlan(resolved.resolved, ctx, { enabled: false });
    const on = buildPlan(resolved.resolved, ctx, { enabled: true });
    if (!off.ok || !on.ok) throw new Error('plan refused unexpectedly');
    expect(on.plan.minRelevantItems).toBe(off.plan.minRelevantItems);
    // Source mode is still authoritative from the manifest.
    expect(on.plan.sourceMode).toBe(off.plan.sourceMode);
  });

  it('honors EXPANSION_MAX cap', () => {
    // Construct an input that triggers many lexicon entries.
    const r = expandSeeds(
      ['platform consolidation migration renewal expansion problem evaluation'],
      ctx,
      { enabled: true },
    );
    expect(r.expandedSeeds.length).toBeLessThanOrEqual(EXPANSION_MAX);
  });

  it('disabled flag returns empty expansions but reports lexiconVersion', () => {
    const r = expandSeeds(['platform consolidation'], ctx, { enabled: false });
    expect(r.expandedSeeds).toEqual([]);
    expect(r.expansionTrace).toEqual([]);
    expect(r.expansionEnabled).toBe(false);
    expect(r.lexiconVersion).toBe(LEXICON_VERSION);
  });
});
