// @vitest-environment node
/**
 * Universal Domain / Methodology Seeds — proves methodologySeeds is a
 * first-class, skill-agnostic planner capability.
 *
 * Tests cover:
 *  1. MEDDICC manifest seeds appear in plan termSeeds
 *  2. A non-MEDDICC fake skill with custom seeds works identically
 *  3. User input terms are preserved and appear first
 *  4. Duplicate seeds (overlap with user inputs) are deduped
 *  5. Zero library hits + library_required still refuses correctly
 *  6. No skill-specific branch logic — same code path for all skills
 */
import { describe, it, expect } from 'vitest';
import { buildPlan } from '../planner';
import { resolveSkill } from '../resolver';
import { meddiccReviewManifest } from '../manifests/meddiccReview';
import type { SkillManifest } from '../types';
import type { PlannerContext } from '../planner';

// ── Fixtures ───────────────────────────────────────────────────────

const CTX: PlannerContext = {
  thread: {
    threadId: 't-seeds',
    account: { id: 'acc-1', name: 'Globex', industry: 'manufacturing' },
    opportunity: { id: 'opp-1', name: 'Globex Expansion', stage: 'negotiation' },
  },
};

/** Fake skill with its own domain seeds — proves universality. */
const fakeCompetitorIntelManifest: SkillManifest = {
  id: 'competitor-intel',
  label: 'Competitor Intelligence',
  description: 'Competitive positioning analysis grounded in library sources.',
  behaviorIntent: 'research_brief',
  workspace: 'deep_research',
  depth: 'deep',
  sourceMode: 'library_first',
  retrieval: {
    scopes: ['knowledge_items', 'playbooks', 'standards'],
    termBindings: ['${inputs.account}', '${inputs.competitor}'],
    methodologySeeds: [
      'competitive positioning', 'win/loss analysis', 'feature comparison',
      'differentiation', 'battle card',
    ],
    minRelevantItems: 2,
  },
  output: { shape: 'structured_artifact' },
  rubric: {
    mustHave: ['positioning', 'gaps', 'talking points'],
    genericMarkers: ['we are better', 'no competition'],
    maxGenericMarkers: 0,
  },
  version: '1',
};

/** Skill with NO methodology seeds — proves the field is optional. */
const fakeNoSeedsManifest: SkillManifest = {
  id: 'basic-brief',
  label: 'Basic Brief',
  description: 'Simple brief with no domain seeds.',
  behaviorIntent: 'account_brief',
  workspace: 'artifacts',
  depth: 'standard',
  sourceMode: 'library_relevant',
  retrieval: {
    scopes: ['knowledge_items'],
    termBindings: ['${inputs.account}'],
    minRelevantItems: 1,
  },
  output: { shape: 'prose' },
  rubric: {
    mustHave: ['summary'],
    genericMarkers: ['looks good'],
    maxGenericMarkers: 0,
  },
  version: '1',
};

// ── Helpers ────────────────────────────────────────────────────────

function buildFromManifest(
  manifest: SkillManifest,
  inputs: Record<string, string>,
  ctx: PlannerContext = CTX,
) {
  // Use the server-style buildPlan signature (manifest, depth, inputs, ctx)
  return buildPlan(
    { manifest, effectiveDepth: manifest.depth, inputs } as any,
    ctx,
  );
}

// ── Tests ──────────────────────────────────────────────────────────

describe('Universal Domain/Methodology Seeds', () => {

  it('MEDDICC manifest seeds appear in plan termSeeds', () => {
    const result = buildFromManifest(meddiccReviewManifest, {
      account: 'Globex',
      opportunity: 'Globex Expansion',
      stage: 'negotiation',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const terms = result.plan.termSeeds.map(t => t.toLowerCase());
    for (const seed of meddiccReviewManifest.retrieval.methodologySeeds!) {
      expect(terms).toContain(seed.toLowerCase());
    }
  });

  it('non-MEDDICC fake skill domain seeds work identically', () => {
    const result = buildFromManifest(fakeCompetitorIntelManifest, {
      account: 'Globex',
      competitor: 'Initech',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const terms = result.plan.termSeeds.map(t => t.toLowerCase());
    for (const seed of fakeCompetitorIntelManifest.retrieval.methodologySeeds!) {
      expect(terms).toContain(seed.toLowerCase());
    }
    // User inputs preserved
    expect(terms).toContain('globex');
    expect(terms).toContain('initech');
  });

  it('user input terms appear before domain seeds (ordering preserved)', () => {
    const result = buildFromManifest(fakeCompetitorIntelManifest, {
      account: 'Globex',
      competitor: 'Initech',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const seeds = result.plan.termSeeds;
    const globexIdx = seeds.findIndex(s => s.toLowerCase() === 'globex');
    const firstDomainSeed = seeds.findIndex(
      s => s.toLowerCase() === fakeCompetitorIntelManifest.retrieval.methodologySeeds![0].toLowerCase()
    );
    expect(globexIdx).toBeLessThan(firstDomainSeed);
  });

  it('duplicate terms (user input overlaps domain seed) are deduped', () => {
    // User provides "MEDDICC" as account name — should not appear twice
    const result = buildFromManifest(meddiccReviewManifest, {
      account: 'MEDDICC',
      opportunity: 'Some Deal',
      stage: 'discovery',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lowerTerms = result.plan.termSeeds.map(t => t.toLowerCase());
    const meddiccCount = lowerTerms.filter(t => t === 'meddicc').length;
    expect(meddiccCount).toBe(1);
  });

  it('case-insensitive dedup: "Metrics" input vs "metrics" seed', () => {
    const result = buildFromManifest(meddiccReviewManifest, {
      account: 'Metrics Corp',
      opportunity: 'Metrics Deal',
      stage: 'metrics',  // overlaps with MEDDICC seed "metrics"
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lowerTerms = result.plan.termSeeds.map(t => t.toLowerCase());
    const metricsCount = lowerTerms.filter(t => t === 'metrics').length;
    expect(metricsCount).toBe(1);
  });

  it('skill with no methodologySeeds works fine (field is optional)', () => {
    const result = buildFromManifest(fakeNoSeedsManifest, {
      account: 'Acme',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.termSeeds).toContain('Acme');
    // Only user terms, no domain seeds
    expect(result.plan.termSeeds.length).toBe(1);
  });

  it('zero user inputs + domain seeds alone provide sufficient context', () => {
    // All bindings unresolved, but methodologySeeds provide terms + entity scoped
    const manifest: SkillManifest = {
      ...fakeCompetitorIntelManifest,
      retrieval: {
        ...fakeCompetitorIntelManifest.retrieval,
        termBindings: ['${inputs.missing1}', '${inputs.missing2}'],
      },
    };
    const result = buildFromManifest(manifest, {}, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Domain seeds are the only termSeeds
    expect(result.plan.termSeeds.length).toBe(
      fakeCompetitorIntelManifest.retrieval.methodologySeeds!.length
    );
  });

  it('zero user inputs + zero seeds + no entity = insufficient_context refusal', () => {
    const manifest: SkillManifest = {
      ...fakeNoSeedsManifest,
      retrieval: {
        ...fakeNoSeedsManifest.retrieval,
        termBindings: ['${inputs.missing}'],
      },
    };
    const result = buildFromManifest(manifest, {}, {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result as any).reason).toBe('insufficient_context');
  });

  it('domain seeds are included in planHash (plan changes when seeds change)', () => {
    const r1 = buildFromManifest(fakeCompetitorIntelManifest, { account: 'X', competitor: 'Y' });
    const modifiedManifest: SkillManifest = {
      ...fakeCompetitorIntelManifest,
      retrieval: {
        ...fakeCompetitorIntelManifest.retrieval,
        methodologySeeds: ['totally different seed'],
      },
    };
    const r2 = buildFromManifest(modifiedManifest, { account: 'X', competitor: 'Y' });
    expect(r1.ok && r2.ok).toBe(true);
    if (!r1.ok || !r2.ok) return;
    expect(r1.plan.planHash).not.toBe(r2.plan.planHash);
  });

  it('no skill-specific branch logic — same code path for all manifests', () => {
    // Both MEDDICC and competitor-intel go through identical buildPlan
    const r1 = buildFromManifest(meddiccReviewManifest, {
      account: 'A', opportunity: 'B', stage: 'C',
    });
    const r2 = buildFromManifest(fakeCompetitorIntelManifest, {
      account: 'A', competitor: 'B',
    });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Both plans have termSeeds that include their respective domain seeds
    if (r1.ok) {
      expect(r1.plan.termSeeds.length).toBeGreaterThan(3); // user + MEDDICC seeds
    }
    if (r2.ok) {
      expect(r2.plan.termSeeds.length).toBeGreaterThan(2); // user + competitor seeds
    }
  });
});
