// @vitest-environment node
/**
 * MEDDICC Guardrail — regression test proving MEDDICC review never
 * depends only on account/opportunity/persona terms.
 *
 * This test FAILS if methodologySeeds are removed from the MEDDICC manifest,
 * ensuring the core MEDDICC domain vocabulary is always present in retrieval.
 */
import { describe, it, expect } from 'vitest';
import { buildPlan } from '../planner';
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

function planMeddicc(manifest: SkillManifest) {
  return buildPlan(
    { manifest, effectiveDepth: manifest.depth, inputs: { account: 'Acme Corp', opportunity: 'Acme Expansion', stage: 'negotiation' } } as any,
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
    // User inputs are at most 3 terms (account, opportunity, stage)
    // With seeds, we must have significantly more
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
    // Without seeds, core MEDDICC concepts MUST be absent
    const hasMeddiccConcepts = REQUIRED_MEDDICC_CONCEPTS.every(c => lower.includes(c.toLowerCase()));
    expect(hasMeddiccConcepts).toBe(false);
  });

  it('"gaps named" is in the rubric mustHave list', () => {
    expect(meddiccReviewManifest.rubric.mustHave).toContain('gaps named');
  });
});
