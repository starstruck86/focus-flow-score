import { describe, it, expect } from 'vitest';
import {
  isDeepEnrichEligible,
  isReenrichEligible,
  getEligibleResources,
  getEligiblePool,
  selectBatch,
  assertBatchEligibility,
  getRecommendedAction,
  getEnrichmentStatusLabel,
  CURRENT_ENRICHMENT_VERSION,
} from '@/lib/resourceEligibility';
import type { Resource } from '@/hooks/useResources';

function makeResource(overrides: Partial<Resource> & { file_url?: string | null; enrichment_status?: string } = {}): Resource {
  return {
    id: overrides.id ?? 'r1',
    user_id: 'u1',
    folder_id: null,
    title: overrides.title ?? 'Test Resource',
    description: null,
    resource_type: 'document',
    content: null,
    is_template: false,
    template_category: null,
    account_id: null,
    opportunity_id: null,
    file_url: 'file_url' in overrides ? overrides.file_url as any : 'https://example.com/article',
    tags: [],
    current_version: 1,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    content_status: overrides.content_status,
    enrichment_status: (overrides as any).enrichment_status ?? 'not_enriched',
    enriched_at: overrides.enriched_at ?? null,
    content_length: overrides.content_length ?? null,
    enrichment_version: (overrides as any).enrichment_version ?? 0,
  } as Resource;
}

describe('isDeepEnrichEligible', () => {
  it('returns true for not_enriched status', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'not_enriched' } as any))).toBe(true);
  });

  it('returns true for failed status (retryable)', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'failed' } as any))).toBe(true);
  });

  it('returns false for deep_enriched status', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'deep_enriched' } as any))).toBe(false);
  });

  it('returns false for deep_enrich_in_progress', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'deep_enrich_in_progress' } as any))).toBe(false);
  });

  it('returns false when file_url is missing', () => {
    expect(isDeepEnrichEligible(makeResource({ file_url: null, enrichment_status: 'not_enriched' } as any))).toBe(false);
  });

  it('returns false when file_url is not HTTP', () => {
    expect(isDeepEnrichEligible(makeResource({ file_url: 'file:///local', enrichment_status: 'not_enriched' } as any))).toBe(false);
  });

  it('returns false for duplicate status', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'duplicate' } as any))).toBe(false);
  });

  it('returns false for superseded status', () => {
    expect(isDeepEnrichEligible(makeResource({ enrichment_status: 'superseded' } as any))).toBe(false);
  });
});

describe('isReenrichEligible', () => {
  it('returns true for queued_for_reenrich', () => {
    expect(isReenrichEligible(makeResource({ enrichment_status: 'queued_for_reenrich' } as any))).toBe(true);
  });

  it('returns true for outdated enrichment version', () => {
    expect(isReenrichEligible(makeResource({
      enrichment_status: 'deep_enriched',
      enrichment_version: 0,
      enriched_at: new Date().toISOString(),
    } as any))).toBe(CURRENT_ENRICHMENT_VERSION > 0);
  });

  it('returns false for not_enriched status', () => {
    expect(isReenrichEligible(makeResource({ enrichment_status: 'not_enriched' } as any))).toBe(false);
  });

  it('returns false when file_url is missing', () => {
    expect(isReenrichEligible(makeResource({ file_url: null, enrichment_status: 'queued_for_reenrich' } as any))).toBe(false);
  });
});

describe('getEligibleResources', () => {
  const resources = [
    makeResource({ id: '1', enrichment_status: 'not_enriched', file_url: 'https://example.com/a' } as any),
    makeResource({ id: '2', enrichment_status: 'deep_enriched', enrichment_version: 0, enriched_at: new Date().toISOString(), file_url: 'https://example.com/b' } as any),
    makeResource({ id: '3', enrichment_status: 'failed', file_url: 'https://example.com/c' } as any),
    makeResource({ id: '4', enrichment_status: 'queued_for_reenrich', file_url: 'https://example.com/d' } as any),
    makeResource({ id: '5', file_url: null, enrichment_status: 'not_enriched' } as any),
    makeResource({ id: '6', enrichment_status: 'duplicate', file_url: 'https://example.com/f' } as any),
  ];

  it('deep pool contains not_enriched and failed items with http urls', () => {
    const pool = getEligibleResources(resources, 'deep_enrich');
    expect(pool.map(r => r.id)).toEqual(['1', '3']);
  });

  it('reenrich pool contains queued_for_reenrich and outdated items', () => {
    const pool = getEligibleResources(resources, 're_enrich');
    const ids = pool.map(r => r.id);
    expect(ids).toContain('4'); // queued
    // id 2 has version 0 < CURRENT_ENRICHMENT_VERSION=1, so eligible
    if (CURRENT_ENRICHMENT_VERSION > 0) {
      expect(ids).toContain('2');
    }
  });

  it('excludes duplicates and superseded', () => {
    const pool = getEligibleResources(resources, 'deep_enrich');
    expect(pool.map(r => r.id)).not.toContain('6');
  });

  it('deduplicates by canonical URL', () => {
    const dupes = [
      makeResource({ id: 'a', enrichment_status: 'not_enriched', file_url: 'https://example.com/same' } as any),
      makeResource({ id: 'b', enrichment_status: 'not_enriched', file_url: 'https://example.com/same' } as any),
    ];
    const pool = getEligibleResources(dupes, 'deep_enrich');
    expect(pool).toHaveLength(1);
  });

  it('returns empty when nothing eligible', () => {
    const allDone = [makeResource({ id: '1', enrichment_status: 'deep_enriched', enrichment_version: CURRENT_ENRICHMENT_VERSION, enriched_at: new Date().toISOString() } as any)];
    expect(getEligibleResources(allDone, 'deep_enrich')).toEqual([]);
  });
});

describe('selectBatch', () => {
  const pool = [
    makeResource({ id: '1', enrichment_status: 'not_enriched' } as any),
    makeResource({ id: '2', enrichment_status: 'not_enriched' } as any),
    makeResource({ id: '3', enrichment_status: 'not_enriched' } as any),
  ];

  it('selects up to batchSize items', () => {
    expect(selectBatch(pool, 2).map(r => r.id)).toEqual(['1', '2']);
  });

  it('returns all if pool smaller than batchSize', () => {
    expect(selectBatch(pool, 10).map(r => r.id)).toEqual(['1', '2', '3']);
  });
});

describe('assertBatchEligibility', () => {
  const allResources = [
    makeResource({ id: '1', enrichment_status: 'not_enriched' } as any),
    makeResource({ id: '2', enrichment_status: 'deep_enriched', enrichment_version: CURRENT_ENRICHMENT_VERSION, enriched_at: new Date().toISOString() } as any),
  ];

  it('passes for valid deep enrich batch', () => {
    const batch = [allResources[0]];
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).not.toThrow();
  });

  it('throws when deep_enriched item is in deep enrich batch', () => {
    const batch = [allResources[1]]; // deep_enriched, current version, fresh
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).toThrow();
  });

  it('includes offending IDs in error message', () => {
    const batch = [allResources[1]];
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).toThrow(allResources[1].id);
  });
});

describe('getRecommendedAction', () => {
  it('recommends deep_enrich for not_enriched', () => {
    const r = makeResource({ enrichment_status: 'not_enriched' } as any);
    expect(getRecommendedAction(r).action).toBe('deep_enrich');
  });

  it('recommends retry for failed', () => {
    const r = makeResource({ enrichment_status: 'failed' } as any);
    expect(getRecommendedAction(r).action).toBe('retry');
  });

  it('recommends no_action for fresh deep_enriched', () => {
    const r = makeResource({ enrichment_status: 'deep_enriched', enrichment_version: CURRENT_ENRICHMENT_VERSION, enriched_at: new Date().toISOString() } as any);
    expect(getRecommendedAction(r).action).toBe('no_action');
  });

  it('recommends ignore for duplicate', () => {
    const r = makeResource({ enrichment_status: 'duplicate' } as any);
    expect(getRecommendedAction(r).action).toBe('ignore');
  });

  it('recommends re_enrich for queued_for_reenrich', () => {
    const r = makeResource({ enrichment_status: 'queued_for_reenrich' } as any);
    expect(getRecommendedAction(r).action).toBe('re_enrich');
  });
});

describe('getEnrichmentStatusLabel', () => {
  it('returns correct labels', () => {
    expect(getEnrichmentStatusLabel('not_enriched')).toBe('Not Enriched');
    expect(getEnrichmentStatusLabel('deep_enriched')).toBe('Enriched');
    expect(getEnrichmentStatusLabel('failed')).toBe('Failed');
    expect(getEnrichmentStatusLabel(undefined)).toBe('Not Enriched');
  });
});

describe('status transitions are valid', () => {
  it('not_enriched items never appear in re_enrich pool', () => {
    const resources = [
      makeResource({ id: '1', enrichment_status: 'not_enriched' } as any),
      makeResource({ id: '2', enrichment_status: 'not_enriched' } as any),
    ];
    const pool = getEligibleResources(resources, 're_enrich');
    expect(pool).toHaveLength(0);
  });

  it('deep_enriched items with current version never appear in deep_enrich pool', () => {
    const resources = [
      makeResource({ id: '1', enrichment_status: 'deep_enriched', enrichment_version: CURRENT_ENRICHMENT_VERSION, enriched_at: new Date().toISOString() } as any),
    ];
    const pool = getEligibleResources(resources, 'deep_enrich');
    expect(pool).toHaveLength(0);
  });
});
