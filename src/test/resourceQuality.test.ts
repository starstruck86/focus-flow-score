/**
 * Tests for resource quality validation, eligibility, lifecycle, and reconciliation.
 */
import { describe, it, expect } from 'vitest';
import {
  validateResourceQuality,
  assertCompletionContract,
  determinePostEnrichmentStatus,
  classifyFailureMode,
  reconcileResource,
  assertEnrichmentInvariants,
  QUALITY_THRESHOLDS,
  CURRENT_ENRICHMENT_VERSION,
  CURRENT_VALIDATION_VERSION,
  type ResourceForValidation,
} from '@/lib/resourceQuality';
import {
  evaluateResourceEligibility,
  getEligibleResources,
  getRecommendedAction,
  assertBatchEligibility,
  selectEligibleBatch,
  getEligibleCount,
} from '@/lib/resourceEligibility';
import {
  isValidTransition,
  detectDrift,
} from '@/lib/resourceLifecycle';
import type { Resource } from '@/hooks/useResources';

// Diverse content that passes vocabulary checks
const DIVERSE_CONTENT = `
The enterprise sales methodology requires careful discovery and qualification processes.
Understanding customer pain points drives effective solution positioning and value articulation.
Budget constraints often emerge during procurement review cycles alongside technical evaluations.
Stakeholder alignment remains critical for complex organizational buying decisions and approvals.
Competition analysis should inform differentiated messaging strategies and unique positioning.
Pipeline velocity metrics indicate deal health and forecast accuracy for quarterly planning.
Relationship mapping helps identify champions advocates detractors and economic buyers.
Objection handling frameworks provide structured approaches to overcoming resistance patterns.
Renewal expansion conversations benefit from proactive account management and engagement.
Territory planning optimization ensures maximum coverage and strategic resource allocation.
`.trim();

function makeLongContent(minChars: number): string {
  let result = '';
  while (result.length < minChars) {
    result += DIVERSE_CONTENT + '\n\n';
  }
  return result;
}

function makeResource(overrides: Partial<ResourceForValidation> = {}): ResourceForValidation {
  const content = makeLongContent(3000);
  return {
    id: 'test-id',
    title: 'Test Resource',
    content,
    content_length: content.length,
    enrichment_status: 'deep_enriched',
    enrichment_version: CURRENT_ENRICHMENT_VERSION,
    validation_version: CURRENT_VALIDATION_VERSION,
    enriched_at: new Date().toISOString(),
    failure_reason: null,
    file_url: 'https://example.com/article',
    description: 'Test description',
    ...overrides,
  };
}

function makeFullResource(overrides: Partial<Resource & Record<string, any>> = {}): Resource {
  return {
    id: overrides.id || 'test-id',
    user_id: 'user-1',
    folder_id: null,
    title: 'Test Resource',
    description: null,
    resource_type: 'video',
    content: makeLongContent(3000),
    is_template: false,
    template_category: null,
    account_id: null,
    opportunity_id: null,
    file_url: overrides.file_url || `https://example.com/article-${overrides.id || 'test'}`,
    tags: [],
    current_version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    enrichment_status: 'not_enriched' as any,
    enrichment_version: 0,
    validation_version: 0,
    failure_count: 0,
    ...overrides,
  } as Resource;
}

// ── Completion Contract ────────────────────────────────────
describe('Completion Contract', () => {
  it('shallow outputs (< 500 chars) do NOT become deep_enriched', () => {
    const r = makeResource({ content: 'Short content', content_length: 13 });
    const result = validateResourceQuality(r);
    expect(result.tier).not.toBe('complete');
    expect(result.passesCompletionContract).toBe(false);
  });

  it('empty content does NOT become deep_enriched', () => {
    const r = makeResource({ content: '', content_length: 0 });
    const result = validateResourceQuality(r);
    expect(result.passesCompletionContract).toBe(false);
    expect(['failed', 'incomplete']).toContain(result.tier);
  });

  it('~600 chars of low-quality content fails validation', () => {
    const r = makeResource({ content: 'X'.repeat(600), content_length: 600 });
    const result = validateResourceQuality(r);
    expect(result.passesCompletionContract).toBe(false);
  });

  it('valid diverse output with all fields DOES become deep_enriched', () => {
    const r = makeResource();
    const result = validateResourceQuality(r);
    expect(result.passesCompletionContract).toBe(true);
    expect(result.tier).toBe('complete');
  });

  it('placeholder content fails validation', () => {
    const r = makeResource({ content: '[External Link: https://example.com]', content_length: 36 });
    const result = validateResourceQuality(r);
    expect(result.passesCompletionContract).toBe(false);
  });

  it('assertCompletionContract returns detailed reason on failure', () => {
    const r = makeResource({ content: null, content_length: 0 });
    const result = assertCompletionContract(r);
    expect(result.passes).toBe(false);
    expect(result.reason).toContain('Failed');
  });
});

// ── Quality Scoring ────────────────────────────────────────
describe('Quality Scoring', () => {
  it('scores low for completely empty resource', () => {
    const r = makeResource({
      content: null, content_length: 0,
      enrichment_version: 0, enriched_at: null,
      file_url: null, validation_version: 0,
    });
    const result = validateResourceQuality(r);
    expect(result.score).toBeLessThanOrEqual(20);
    expect(result.passesCompletionContract).toBe(false);
  });

  it('high-boilerplate content gets penalized', () => {
    const boilerplate = 'Cookie policy\nPrivacy policy\nTerms of service\nSubscribe now\nFollow us on\nAll rights reserved\n© 2024\nSkip to content\n';
    const r = makeResource({ content: boilerplate.repeat(10), content_length: boilerplate.length * 10 });
    const result = validateResourceQuality(r);
    expect(result.violations.some(v => v.includes('boilerplate'))).toBe(true);
  });

  it('determinePostEnrichmentStatus maps quality tier to correct status', () => {
    const shallow = validateResourceQuality(makeResource({ content: 'X'.repeat(100), content_length: 100 }));
    expect(determinePostEnrichmentStatus(shallow, false)).not.toBe('deep_enriched');
    const good = validateResourceQuality(makeResource());
    expect(determinePostEnrichmentStatus(good, false)).toBe('deep_enriched');
  });
});

// ── Failure Classification ─────────────────────────────────
describe('Failure Classification', () => {
  it('classifies rate limit as transient', () => {
    const qr = validateResourceQuality(makeResource({ content: null, content_length: 0 }));
    expect(classifyFailureMode(qr, 'Error 429 rate limit exceeded')).toBe('transient_failure');
  });

  it('classifies private content as permanent', () => {
    const qr = validateResourceQuality(makeResource({ content: null, content_length: 0 }));
    expect(classifyFailureMode(qr, 'Private or restricted content')).toBe('permanent_invalid_input');
  });

  it('classifies shallow content as validation_failure', () => {
    const qr = validateResourceQuality(makeResource({ content: 'X'.repeat(100), content_length: 100 }));
    expect(classifyFailureMode(qr)).toBe('validation_failure');
  });
});

// ── Eligibility Selectors ──────────────────────────────────
describe('Eligibility Selectors', () => {
  it('not_enriched is eligible for deep_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'not_enriched' as any });
    expect(evaluateResourceEligibility(r, 'deep_enrich').eligible).toBe(true);
  });

  it('incomplete is eligible for deep_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'incomplete' as any });
    expect(evaluateResourceEligibility(r, 'deep_enrich').eligible).toBe(true);
  });

  it('deep_enriched is NOT eligible for deep_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'deep_enriched' as any });
    expect(evaluateResourceEligibility(r, 'deep_enrich').eligible).toBe(false);
  });

  it('incomplete is eligible for re_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'incomplete' as any });
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(true);
  });

  it('deep_enriched with shallow tier is eligible for re_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'deep_enriched' as any, last_quality_tier: 'shallow' } as any);
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(true);
  });

  it('duplicate is never eligible', () => {
    const r = makeFullResource({ enrichment_status: 'duplicate' as any });
    expect(evaluateResourceEligibility(r, 'deep_enrich').eligible).toBe(false);
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(false);
  });

  it('getEligibleResources returns only eligible items with unique URLs', () => {
    const resources = [
      makeFullResource({ id: '1', enrichment_status: 'not_enriched' as any, file_url: 'https://example.com/1' }),
      makeFullResource({ id: '2', enrichment_status: 'deep_enriched' as any, file_url: 'https://example.com/2' }),
      makeFullResource({ id: '3', enrichment_status: 'failed' as any, file_url: 'https://example.com/3' }),
    ];
    const eligible = getEligibleResources(resources, 'deep_enrich');
    expect(eligible.map(r => r.id)).toEqual(['1', '3']);
  });

  it('batch assertion fails for ineligible items', () => {
    const all = [makeFullResource({ id: '1', enrichment_status: 'deep_enriched' as any })];
    expect(() => assertBatchEligibility(all, 'deep_enrich', all)).toThrow();
  });

  it('selectEligibleBatch respects batch size', () => {
    const resources = [
      makeFullResource({ id: '1', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/1' }),
      makeFullResource({ id: '2', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/2' }),
      makeFullResource({ id: '3', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/3' }),
    ];
    const batch = selectEligibleBatch(resources, 'deep_enrich', 2);
    expect(batch).toHaveLength(2);
  });

  it('getEligibleCount matches getEligibleResources length', () => {
    const resources = [
      makeFullResource({ id: '1', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/1' }),
      makeFullResource({ id: '2', enrichment_status: 'deep_enriched' as any, file_url: 'https://a.com/2' }),
    ];
    expect(getEligibleCount(resources, 'deep_enrich')).toBe(getEligibleResources(resources, 'deep_enrich').length);
  });
});

// ── Reconciliation ─────────────────────────────────────────
describe('Reconciliation', () => {
  it('downgrades deep_enriched with shallow content', () => {
    const r = makeResource({ content: 'X'.repeat(100), content_length: 100, enrichment_status: 'deep_enriched' });
    const result = reconcileResource(r);
    expect(result.action).toBe('downgrade');
    expect(result.newStatus).toBeDefined();
  });

  it('keeps valid deep_enriched as ok', () => {
    const r = makeResource();
    const result = reconcileResource(r);
    expect(result.action).toBe('ok');
  });
});

// ── State Transition Invariants ────────────────────────────
describe('Invariants', () => {
  it('deep_enriched with non-complete tier throws', () => {
    expect(() => assertEnrichmentInvariants('deep_enriched', 'shallow')).toThrow('INVARIANT VIOLATION');
  });

  it('deep_enriched with complete tier passes', () => {
    expect(() => assertEnrichmentInvariants('deep_enriched', 'complete')).not.toThrow();
  });

  it('failed status with failed tier passes', () => {
    expect(() => assertEnrichmentInvariants('failed', 'failed')).not.toThrow();
  });
});

// ── Version and Freshness ──────────────────────────────────
describe('Version and Freshness', () => {
  it('outdated enrichment_version makes re-enrich eligible', () => {
    const r = makeFullResource({ enrichment_status: 'deep_enriched' as any, enrichment_version: 0 });
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(true);
  });

  it('outdated validation_version makes re-enrich eligible', () => {
    const r = makeFullResource({
      enrichment_status: 'deep_enriched' as any,
      enrichment_version: CURRENT_ENRICHMENT_VERSION,
      validation_version: 0,
    } as any);
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(true);
  });

  it('stale enrichment date makes re-enrich eligible', () => {
    const r = makeFullResource({
      enrichment_status: 'deep_enriched' as any,
      enrichment_version: CURRENT_ENRICHMENT_VERSION,
      enriched_at: new Date(Date.now() - 100 * 86400000).toISOString(),
    } as any);
    (r as any).validation_version = CURRENT_VALIDATION_VERSION;
    expect(evaluateResourceEligibility(r, 're_enrich').eligible).toBe(true);
  });
});

// ── Recommended Actions ────────────────────────────────────
describe('Recommended Actions', () => {
  it('not_enriched → deep_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'not_enriched' as any });
    expect(getRecommendedAction(r).action).toBe('deep_enrich');
  });

  it('incomplete → re_enrich', () => {
    const r = makeFullResource({ enrichment_status: 'incomplete' as any });
    expect(getRecommendedAction(r).action).toBe('re_enrich');
  });

  it('failed with low failure count → retry', () => {
    const r = makeFullResource({ enrichment_status: 'failed' as any, failure_count: 1 } as any);
    expect(getRecommendedAction(r).action).toBe('retry');
  });

  it('failed with high failure count → review_manually', () => {
    const r = makeFullResource({ enrichment_status: 'failed' as any, failure_count: 5 } as any);
    expect(getRecommendedAction(r).action).toBe('review_manually');
  });

  it('duplicate → ignore', () => {
    const r = makeFullResource({ enrichment_status: 'duplicate' as any });
    expect(getRecommendedAction(r).action).toBe('ignore');
  });
});

// ── State Transitions ──────────────────────────────────────
describe('State Transitions', () => {
  it('allows valid transitions', () => {
    expect(isValidTransition('not_enriched', 'queued_for_deep_enrich')).toBe(true);
    expect(isValidTransition('deep_enrich_in_progress', 'deep_enriched')).toBe(true);
    expect(isValidTransition('deep_enriched', 'queued_for_reenrich')).toBe(true);
  });

  it('blocks invalid transitions', () => {
    expect(isValidTransition('not_enriched', 'deep_enriched')).toBe(false);
    expect(isValidTransition('duplicate', 'deep_enriched')).toBe(false);
  });
});

// ── Drift Detection ────────────────────────────────────────
describe('Drift Detection', () => {
  it('detects deep_enriched with shallow tier', () => {
    const drift = detectDrift({ enrichment_status: 'deep_enriched', last_quality_tier: 'shallow' });
    expect(drift.hasDrift).toBe(true);
    expect(drift.issues).toHaveLength(1);
  });

  it('detects deep_enriched with outdated version', () => {
    const drift = detectDrift({ enrichment_status: 'deep_enriched', last_quality_tier: 'complete', enrichment_version: 0 });
    expect(drift.hasDrift).toBe(true);
  });

  it('no drift for valid deep_enriched', () => {
    const drift = detectDrift({
      enrichment_status: 'deep_enriched',
      last_quality_tier: 'complete',
      last_quality_score: 85,
      enrichment_version: CURRENT_ENRICHMENT_VERSION,
      validation_version: CURRENT_VALIDATION_VERSION,
    });
    expect(drift.hasDrift).toBe(false);
  });

  it('no drift for non-enriched resources', () => {
    const drift = detectDrift({ enrichment_status: 'not_enriched' });
    expect(drift.hasDrift).toBe(false);
  });
});

// ── Batch Integrity ────────────────────────────────────────
describe('Batch Integrity', () => {
  it('batch from eligible pool passes assertion', () => {
    const resources = [
      makeFullResource({ id: '1', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/1' }),
      makeFullResource({ id: '2', enrichment_status: 'not_enriched' as any, file_url: 'https://a.com/2' }),
    ];
    const batch = selectEligibleBatch(resources, 'deep_enrich', 2);
    expect(() => assertBatchEligibility(batch, 'deep_enrich', resources)).not.toThrow();
  });

  it('manually constructed ineligible batch fails assertion', () => {
    const resources = [
      makeFullResource({ id: '1', enrichment_status: 'deep_enriched' as any, file_url: 'https://a.com/1' }),
    ];
    expect(() => assertBatchEligibility(resources, 'deep_enrich', resources)).toThrow();
  });
});
