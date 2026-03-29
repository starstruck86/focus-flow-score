/**
 * Regression tests: processingState correctly recognizes manual recovery states,
 * fixResourceState eligibility, and content-wins-over-failure behavior.
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
import { isFixEligible } from '../fixResourceState';

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

  it('deep_enriched + resolution_method=alternate_url → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched', resolution_method: 'alternate_url' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });

  it('deep_enriched + resolution_method=transcript_upload → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched', resolution_method: 'transcript_upload' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });

  it('deep_enriched + resolution_method=fixed_from_existing_content → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'deep_enriched', resolution_method: 'fixed_from_existing_content' } as any;
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

  // ── Content-wins-over-failure tests ──────────────────────
  it('failed + content_length > 1000 → COMPLETED (content wins)', () => {
    const r = { ...baseResource, enrichment_status: 'failed', content_length: 80000, failure_reason: 'auth_required' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toContain('Content Available');
  });

  it('failed + manual_content_present → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'failed', manual_content_present: true, resolution_method: 'manual_paste', content_length: 500 } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });

  it('incomplete + content_length > 1000 → COMPLETED', () => {
    const r = { ...baseResource, enrichment_status: 'incomplete', content_length: 5000 } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
  });

  it('quarantined + content_length > 1000 → COMPLETED (not quarantined)', () => {
    const r = { ...baseResource, enrichment_status: 'quarantined', content_length: 2000 } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
  });

  it('failed + content_length < 1000 + no manual → still RETRYABLE_FAILURE', () => {
    const r = { ...baseResource, enrichment_status: 'failed', content_length: 100, failure_reason: 'timeout' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('RETRYABLE_FAILURE');
  });

  it('failed + fixed_from_existing_content + content → COMPLETED / Manual Recovery', () => {
    const r = { ...baseResource, enrichment_status: 'failed', content_length: 5000, resolution_method: 'fixed_from_existing_content', manual_content_present: true } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).toBe('Manual Recovery');
  });
});

describe('isFixEligible', () => {
  it('returns true for failed resource with substantial content', () => {
    expect(isFixEligible({
      content_length: 5000,
      enrichment_status: 'failed',
      failure_reason: 'auth_required',
    })).toBe(true);
  });

  it('returns true for resource with manual_content_present but stale status', () => {
    expect(isFixEligible({
      manual_content_present: true,
      enrichment_status: 'incomplete',
      content_length: 100,
    })).toBe(true);
  });

  it('returns false for resource with no content', () => {
    expect(isFixEligible({
      content_length: 50,
      enrichment_status: 'failed',
    })).toBe(false);
  });

  it('returns false for already-resolved resource', () => {
    expect(isFixEligible({
      content_length: 5000,
      enrichment_status: 'deep_enriched',
      recovery_status: 'resolved_manual',
    })).toBe(false);
  });

  it('returns true for high-score blocked resource', () => {
    expect(isFixEligible({
      content_length: 80000,
      enrichment_status: 'failed',
      last_quality_score: 90,
    })).toBe(true);
  });

  it('returns true when blocker fields remain despite good status', () => {
    expect(isFixEligible({
      content_length: 5000,
      enrichment_status: 'deep_enriched',
      manual_input_required: true,
      recovery_queue_bucket: 'needs_transcript',
    })).toBe(true);
  });

  it('returns true for resource with content but no manual_content_present flag', () => {
    expect(isFixEligible({
      content_length: 88000,
      enrichment_status: 'failed',
      manual_content_present: false,
      failure_reason: 'auth_required',
    })).toBe(true);
  });
});

describe('edge cases: no URL but valid manual content', () => {
  it('no URL + manual_content_present + content_length > 1000 → COMPLETED', () => {
    const r = { ...baseResource, file_url: '', enrichment_status: 'not_enriched', manual_content_present: true, content_length: 5000, resolution_method: 'manual_paste' } as any;
    const ps = deriveProcessingState(r);
    // With substantial content and manual flag, content wins
    expect(ps.state).toBe('COMPLETED');
  });

  it('no URL + failed + content_length > 1000 → COMPLETED (content wins)', () => {
    const r = { ...baseResource, file_url: '', enrichment_status: 'failed', content_length: 80000 } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
  });

  it('score 90 + content 88k + failed → COMPLETED not MANUAL_REQUIRED', () => {
    const r = { ...baseResource, enrichment_status: 'failed', content_length: 88908, last_quality_score: 90, failure_reason: 'Zoom auth wall' } as any;
    const ps = deriveProcessingState(r);
    expect(ps.state).toBe('COMPLETED');
    expect(ps.label).not.toBe('Manual Input Needed');
    expect(ps.label).not.toBe('Needs Auth');
  });
});
