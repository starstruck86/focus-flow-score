import { describe, it, expect } from 'vitest';
import {
  isDeepEnrichEligible,
  isReenrichEligible,
  getEligiblePool,
  selectBatch,
  assertBatchEligibility,
} from '@/lib/resourceEligibility';
import type { Resource } from '@/hooks/useResources';

function makeResource(overrides: Partial<Resource> = {}): Resource {
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
    file_url: overrides.file_url ?? 'https://example.com/article',
    tags: [],
    current_version: 1,
    created_at: '2025-01-01',
    updated_at: '2025-01-01',
    content_status: overrides.content_status,
    enriched_at: overrides.enriched_at ?? null,
    content_length: overrides.content_length ?? null,
  };
}

describe('isDeepEnrichEligible', () => {
  it('returns true for placeholder status', () => {
    expect(isDeepEnrichEligible(makeResource({ content_status: 'placeholder' }))).toBe(true);
  });

  it('returns true for file status', () => {
    expect(isDeepEnrichEligible(makeResource({ content_status: 'file' }))).toBe(true);
  });

  it('returns true for undefined status', () => {
    expect(isDeepEnrichEligible(makeResource({ content_status: undefined }))).toBe(true);
  });

  it('returns false for enriched status', () => {
    expect(isDeepEnrichEligible(makeResource({ content_status: 'enriched' }))).toBe(false);
  });

  it('returns false for enriching status', () => {
    expect(isDeepEnrichEligible(makeResource({ content_status: 'enriching' }))).toBe(false);
  });

  it('returns false when file_url is missing', () => {
    expect(isDeepEnrichEligible(makeResource({ file_url: null, content_status: 'placeholder' }))).toBe(false);
  });

  it('returns false when file_url is not HTTP', () => {
    expect(isDeepEnrichEligible(makeResource({ file_url: 'file:///local', content_status: 'placeholder' }))).toBe(false);
  });
});

describe('isReenrichEligible', () => {
  it('returns true for enriched status', () => {
    expect(isReenrichEligible(makeResource({ content_status: 'enriched' }))).toBe(true);
  });

  it('returns false for placeholder status', () => {
    expect(isReenrichEligible(makeResource({ content_status: 'placeholder' }))).toBe(false);
  });

  it('returns false for file status', () => {
    expect(isReenrichEligible(makeResource({ content_status: 'file' }))).toBe(false);
  });

  it('returns false when file_url is missing', () => {
    expect(isReenrichEligible(makeResource({ file_url: null, content_status: 'enriched' }))).toBe(false);
  });
});

describe('getEligiblePool', () => {
  const resources = [
    makeResource({ id: '1', content_status: 'placeholder' }),
    makeResource({ id: '2', content_status: 'enriched' }),
    makeResource({ id: '3', content_status: 'file' }),
    makeResource({ id: '4', content_status: 'enriched' }),
    makeResource({ id: '5', file_url: null, content_status: 'placeholder' }),
  ];

  it('deep pool contains only placeholder/file items with http urls', () => {
    const pool = getEligiblePool(resources, 'deep');
    expect(pool.map(r => r.id)).toEqual(['1', '3']);
  });

  it('reenrich pool contains only enriched items with http urls', () => {
    const pool = getEligiblePool(resources, 'reenrich');
    expect(pool.map(r => r.id)).toEqual(['2', '4']);
  });

  it('returns empty when nothing eligible', () => {
    const allEnriched = [makeResource({ id: '1', content_status: 'enriched' })];
    expect(getEligiblePool(allEnriched, 'deep')).toEqual([]);
  });

  it('zero eligible disables run (empty array)', () => {
    expect(getEligiblePool([], 'deep')).toEqual([]);
    expect(getEligiblePool([], 'reenrich')).toEqual([]);
  });
});

describe('selectBatch', () => {
  const pool = [
    makeResource({ id: '1', content_status: 'placeholder' }),
    makeResource({ id: '2', content_status: 'placeholder' }),
    makeResource({ id: '3', content_status: 'placeholder' }),
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
    makeResource({ id: '1', content_status: 'placeholder' }),
    makeResource({ id: '2', content_status: 'enriched' }),
  ];

  it('passes for valid deep enrich batch', () => {
    const batch = [allResources[0]];
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).not.toThrow();
  });

  it('passes for valid reenrich batch', () => {
    const batch = [allResources[1]];
    expect(() => assertBatchEligibility(batch, 'reenrich', allResources)).not.toThrow();
  });

  it('throws when enriched item is in deep enrich batch', () => {
    const batch = [allResources[1]]; // enriched
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).toThrow('assertion failed');
  });

  it('throws when placeholder item is in reenrich batch', () => {
    const batch = [allResources[0]]; // placeholder
    expect(() => assertBatchEligibility(batch, 'reenrich', allResources)).toThrow('assertion failed');
  });

  it('includes offending IDs in error message', () => {
    const batch = [allResources[1]];
    expect(() => assertBatchEligibility(batch, 'deep', allResources)).toThrow(allResources[1].id);
  });
});
