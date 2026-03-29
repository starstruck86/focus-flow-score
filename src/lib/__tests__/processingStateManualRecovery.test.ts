/**
 * Regression tests: processingState correctly recognizes manual recovery states.
 */
import { describe, it, expect, vi } from 'vitest';

// Mock dependencies that processingState imports
vi.mock('@/lib/salesBrain/resourceSubtype', () => ({
  classifyEnrichability: vi.fn().mockReturnValue({ enrichability: 'fully_enrichable', reason: 'ok' }),
}));
vi.mock('@/lib/salesBrain/audioPipeline', () => ({
  isAudioResource: vi.fn().mockReturnValue(false),
  detectAudioSubtype: vi.fn().mockReturnValue('unknown'),
  getAudioStrategy: vi.fn().mockReturnValue({ manualAssistRequired: false, retryMode: 'automatic', primaryPath: { description: '' } }),
}));

import { deriveProcessingState } from '../processingState';

const baseResource = {
  id: 'r1',
  title: 'Test',
  resource_type: 'document',
  file_url: 'https://example.com/doc',
  content: '',
  content_status: 'full',
  enrichment_status: 'deep_enriched',
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  user_id: 'u1',
  brain_status: 'pending',
};

describe('processingState manual recovery recognition', () => {
  it('deep_enriched + manual_content_present → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched', manual_content_present: true, resolution_method: 'manual_paste' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });

  it('deep_enriched + resolution_method=metadata_only → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched', resolution_method: 'metadata_only' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });

  it('deep_enriched without manual flags → COMPLETED / Completed (not Manual Recovery)', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Completed');
  });

  it('legacy "enriched" status → COMPLETED', () => {
    const r = { ...baseResource, enrichment_status: 'enriched' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
  });

  it('partial status → COMPLETED', () => {
    const r = { ...baseResource, enrichment_status: 'partial' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Partial');
  });

  it('not_enriched → READY (not regressed to manual/blocked)', () => {
    const r = { ...baseResource, enrichment_status: 'not_enriched' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('READY');
  });
});
