// @vitest-environment node
/**
 * MEDDICC Guardrail — regression tests proving MEDDICC review never
 * depends only on account/opportunity/persona terms and that removing
 * methodologySeeds degrades retrieval back to user-only terms.
 */
import { describe, it, expect } from 'vitest';
import { buildPlan } from '../planner';
import { scoreConfidence } from '../planner/confidence';
import { meddiccReviewManifest } from '../manifests/meddiccReview';
import type { SkillManifest } from '../types';
import type { PlannerContext } from '../planner';

const CTX: PlannerContext = {
  thread: {
    threadId: 't-meddicc',
    account: { id: 'acc-1', name: 'Acme Corp', industry: 'saas' },
    opportunity: { id: 'opp-1', name: 'Acme Expansion', stage: 'negotiation' },
  },
};

const REQUIRED_MEDDICC_CONCEPTS = [
  'metrics',
  'economic buyer',
  'decision criteria',
  'decision process',
  'identified pain',
  'champion',
  'competition',
];

const USER_INPUTS = { account: 'Acme Corp', opportunity: 'Acme Expansion', stage: 'negotiation' };

function planMeddicc(manifest: SkillManifest, inputs = USER_INPUTS) {
  return buildPlan(
    { manifest, effectiveDepth: manifest.depth, inputs } as any,
    CTX,
  );
}

describe('MEDDICC Guardrail', () => {
  it('MEDDICC manifest declares methodologySeeds', () => {
    expect(meddiccReviewManifest.retrieval.methodologySeeds).toBeDefined();
    expect(meddiccReviewManifest.retrieval.methodologySeeds!.length).toBeGreaterThanOrEqual(7);
  });

  it('all core MEDDICC concepts appear in retrieval termSeeds', () => {
    const r = planMeddicc(meddiccReviewManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    for (const concept of REQUIRED_MEDDICC_CONCEPTS) {
      expect(lower).toContain(concept.toLowerCase());
    }
  });

  it('retrieval terms include MORE than just account/opportunity/persona', () => {
    const r = planMeddicc(meddiccReviewManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.termSeeds.length).toBeGreaterThan(5);
  });

  it('FAILS if methodologySeeds are removed (guardrail trip-wire)', () => {
    const stripped: SkillManifest = {
      ...meddiccReviewManifest,
      retrieval: {
        ...meddiccReviewManifest.retrieval,
        methodologySeeds: undefined,
      },
    };
    const r = planMeddicc(stripped);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    const hasMeddiccConcepts = REQUIRED_MEDDICC_CONCEPTS.every(c => lower.includes(c.toLowerCase()));
    expect(hasMeddiccConcepts).toBe(false);
  });

  it('"gaps named" is in the rubric mustHave list', () => {
    expect(meddiccReviewManifest.rubric.mustHave).toContain('gaps named');
  });

  // ── New: no user-specific match still includes methodology seeds ──

  it('with unmatched account/opportunity, methodology seeds still present', () => {
    // User inputs that would never match library content — seeds must still be there
    const r = planMeddicc(meddiccReviewManifest, {
      account: 'ZZZ_NONEXISTENT_CORP_999',
      opportunity: 'ZZZ_FAKE_DEAL_999',
      stage: 'ZZZ_UNKNOWN_STAGE',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    for (const concept of REQUIRED_MEDDICC_CONCEPTS) {
      expect(lower).toContain(concept.toLowerCase());
    }
  });

  // ── Removing seeds reduces terms back to user-only ──

  it('removing methodologySeeds reduces retrieval to user-only terms', () => {
    const withSeeds = planMeddicc(meddiccReviewManifest);
    const stripped: SkillManifest = {
      ...meddiccReviewManifest,
      retrieval: { ...meddiccReviewManifest.retrieval, methodologySeeds: undefined },
    };
    const withoutSeeds = planMeddicc(stripped);
    expect(withSeeds.ok && withoutSeeds.ok).toBe(true);
    if (!withSeeds.ok || !withoutSeeds.ok) return;
    // Without seeds, terms should only contain user-provided values
    expect(withoutSeeds.plan.termSeeds.length).toBeLessThan(withSeeds.plan.termSeeds.length);
    // None of the MEDDICC concepts should be in the stripped version
    const strippedLower = withoutSeeds.plan.termSeeds.map(t => t.toLowerCase());
    for (const concept of REQUIRED_MEDDICC_CONCEPTS) {
      expect(strippedLower).not.toContain(concept.toLowerCase());
    }
  });

  // ── Library gate must not silently pass with 0 relevant items ──

  it('zero relevant items after seeded retrieval scores as insufficient', () => {
    // Confidence scorer should return 'insufficient' when counts are all zero
    const confidence = scoreConfidence({
      counts: {},
      entityScoped: true,
      minRelevantItems: meddiccReviewManifest.retrieval.minRelevantItems ?? 3,
    });
    expect(confidence).toBe('insufficient');
  });

  it('zero relevant items with library_required sourceMode does not score high or medium', () => {
    // Even with entity scope, zero hits = insufficient
    const confidence = scoreConfidence({
      counts: { knowledge_items: 0, playbooks: 0, standards: 0 },
      entityScoped: true,
      minRelevantItems: 3,
    });
    expect(confidence).toBe('insufficient');
  });
  // ── 1. Runtime sufficiency: seeds → counts → confidence ≠ insufficient ──

  it('MEDDICC seeds + real retrieval counts → confidence is NOT insufficient', () => {
    // Simulate: seeds drove retrieval that found 3 KIs (entity-scoped)
    const r = planMeddicc(meddiccReviewManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Seeds produced enough terms to drive retrieval
    expect(r.plan.termSeeds.length).toBeGreaterThanOrEqual(7);
    // Now score as if retrieval returned hits matching the seed count
    const confidence = scoreConfidence({
      counts: { knowledge_items: 3, playbooks: 1, standards: 0 },
      entityScoped: true,
      minRelevantItems: meddiccReviewManifest.retrieval.minRelevantItems ?? 3,
    });
    // With real hits, confidence must NOT be insufficient — seeds prevented false 422
    expect(confidence).not.toBe('insufficient');
    expect(['high', 'medium']).toContain(confidence);
  });

  // ── 2. Negative mirror: zero counts still fails regardless of seeds ──

  it('seeds exist but zero retrieval counts still scores insufficient (no gate weakening)', () => {
    // Seeds are present in the plan...
    const r = planMeddicc(meddiccReviewManifest);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.termSeeds.length).toBeGreaterThan(5);
    // ...but retrieval returned nothing — confidence must stay insufficient
    const confidence = scoreConfidence({
      counts: {},
      entityScoped: true,
      minRelevantItems: meddiccReviewManifest.retrieval.minRelevantItems ?? 3,
    });
    expect(confidence).toBe('insufficient');
  });
});

// ── 3. Third manifest (expansion-style) proves universality ──

const expansionManifest: SkillManifest = {
  id: 'expansion-review',
  label: 'Expansion Readiness Review',
  description: 'Assess expansion potential grounded in library methodology.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'deep',
  sourceMode: 'library_required',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.opportunity}'],
    methodologySeeds: [
      'renewal risk', 'expansion trigger', 'executive alignment',
      'whitespace analysis', 'multi-thread engagement', 'usage adoption',
    ],
    minRelevantItems: 2,
  },
  output: { shape: 'structured_artifact' },
  rubric: {
    mustHave: ['expansion signals', 'risks', 'next steps'],
    genericMarkers: ['looks good', 'healthy account'],
    maxGenericMarkers: 0,
  },
  version: '1',
};

describe('Expansion Manifest — universality proof', () => {
  it('expansion seeds appear in termSeeds (same planner path as MEDDICC)', () => {
    const r = buildPlan(
      { manifest: expansionManifest, effectiveDepth: expansionManifest.depth, inputs: { account: 'Acme', opportunity: 'Renewal' } } as any,
      CTX,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lower = r.plan.termSeeds.map(t => t.toLowerCase());
    for (const seed of expansionManifest.retrieval.methodologySeeds!) {
      expect(lower).toContain(seed.toLowerCase());
    }
  });

  it('expansion seeds + real counts → confidence ≠ insufficient', () => {
    const confidence = scoreConfidence({
      counts: { knowledge_items: 2, playbooks: 1 },
      entityScoped: true,
      minRelevantItems: expansionManifest.retrieval.minRelevantItems ?? 2,
    });
    expect(confidence).not.toBe('insufficient');
  });

  it('expansion seeds + zero counts → still insufficient (no bypass)', () => {
    const confidence = scoreConfidence({
      counts: {},
      entityScoped: true,
      minRelevantItems: expansionManifest.retrieval.minRelevantItems ?? 2,
    });
    expect(confidence).toBe('insufficient');
  });
});
