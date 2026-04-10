/**
 * Regression tests: Extraction Lifecycle Invariant
 *
 * INVARIANT: If ki_count > 0, the resource must NOT appear in "Needs Extract."
 */

import { describe, it, expect } from 'vitest';
import type { CanonicalResourceStatus } from '../canonicalLifecycle';
import { deriveBlockedReason, deriveCanonicalStage } from '../canonicalLifecycle';
import { deriveControlPlaneState, computeControlPlaneSummary } from '../controlPlaneState';
import { auditImpossibleExtractionStates } from '../postExtractionReconciliation';

function makeLifecycleResource(overrides: Record<string, any> = {}) {
  return {
    content_length: 5000,
    content: 'A'.repeat(5000),
    manual_content_present: false,
    tags: ['skill:discovery', 'context:saas'],
    enrichment_status: 'enriched',
    manual_input_required: false,
    recovery_queue_bucket: null,
    failure_reason: null,
    ...overrides,
  };
}

function makeCanonicalResource(overrides: Partial<CanonicalResourceStatus> = {}): CanonicalResourceStatus {
  return {
    resource_id: 'r1',
    title: 'Test resource',
    resource_type: 'transcript',
    file_url: null,
    canonical_stage: 'content_ready',
    is_enriched: true,
    is_content_backed: true,
    knowledge_item_count: 0,
    active_ki_count: 0,
    active_ki_with_context_count: 0,
    blocked_reason: 'none',
    last_transition_at: null,
    active_job_status: null,
    ...overrides,
  };
}

describe('deriveBlockedReason invariant: ki > 0 → never no_extraction', () => {
  it('returns no_extraction when ki.total = 0 and enriched', () => {
    const result = deriveBlockedReason(makeLifecycleResource(), { total: 0, active: 0, activeWithContexts: 0 });
    expect(result).toBe('no_extraction');
  });

  it('never returns no_extraction when ki.total > 0', () => {
    const kiVariants = [
      { total: 1, active: 0, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 1 },
      { total: 50, active: 25, activeWithContexts: 10 },
    ];

    for (const ki of kiVariants) {
      const result = deriveBlockedReason(makeLifecycleResource(), ki);
      expect(result).not.toBe('no_extraction');
    }
  });
});

describe('deriveCanonicalStage invariant: ki > 0 → never pre-extraction', () => {
  it('returns tagged when ki.total = 0 and has tags', () => {
    const stage = deriveCanonicalStage(makeLifecycleResource(), { total: 0, active: 0, activeWithContexts: 0 });
    expect(stage).toBe('tagged');
  });

  it('returns knowledge_extracted when ki.total > 0 but active = 0', () => {
    const stage = deriveCanonicalStage(makeLifecycleResource(), { total: 5, active: 0, activeWithContexts: 0 });
    expect(stage).toBe('knowledge_extracted');
  });

  it('returns operationalized when fully active with contexts', () => {
    const stage = deriveCanonicalStage(makeLifecycleResource(), { total: 5, active: 5, activeWithContexts: 5 });
    expect(stage).toBe('operationalized');
  });

  it('tagless transcript with KIs still moves past pre-extraction stage', () => {
    const stage = deriveCanonicalStage(
      makeLifecycleResource({ tags: ['podcast', 'direct_audio'] }),
      { total: 12, active: 12, activeWithContexts: 12 },
    );
    expect(stage).toBe('operationalized');
  });

  it('never returns uploaded/content_ready/tagged when ki.total > 0', () => {
    const kiVariants = [
      { total: 1, active: 0, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 1 },
      { total: 100, active: 50, activeWithContexts: 25 },
    ];

    for (const ki of kiVariants) {
      const stage = deriveCanonicalStage(makeLifecycleResource({ tags: ['podcast', 'direct_audio'] }), ki);
      expect(['uploaded', 'content_ready', 'tagged']).not.toContain(stage);
    }
  });
});

describe('deriveControlPlaneState invariant: KI-backed resources never map to Needs Extraction', () => {
  it('maps tagless transcript with KIs to activated, not has_content', () => {
    const state = deriveControlPlaneState(makeCanonicalResource({
      canonical_stage: 'content_ready',
      knowledge_item_count: 12,
      active_ki_count: 12,
      active_ki_with_context_count: 12,
      blocked_reason: 'none',
    }));
    expect(state).toBe('activated');
  });

  it('maps KI-backed resource with no active KIs to extracted, not has_content', () => {
    const state = deriveControlPlaneState(makeCanonicalResource({
      canonical_stage: 'tagged',
      knowledge_item_count: 5,
      active_ki_count: 0,
      active_ki_with_context_count: 0,
      blocked_reason: 'none',
    }));
    expect(state).toBe('extracted');
  });

  it('summary count excludes KI-backed tagless transcripts from Needs Extraction', () => {
    const summary = computeControlPlaneSummary([
      makeCanonicalResource({
        resource_id: 'a',
        canonical_stage: 'content_ready',
        knowledge_item_count: 12,
        active_ki_count: 12,
        active_ki_with_context_count: 12,
      }),
      makeCanonicalResource({
        resource_id: 'b',
        canonical_stage: 'content_ready',
        knowledge_item_count: 0,
        active_ki_count: 0,
        active_ki_with_context_count: 0,
      }),
    ]);

    expect(summary.needsExtraction).toBe(1);
    expect(summary.ready).toBe(1);
  });
});

describe('auditImpossibleExtractionStates', () => {
  it('detects ki > 0 with blocked_reason = no_extraction', () => {
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r1', title: 'Test', knowledge_item_count: 5, blocked_reason: 'no_extraction', canonical_stage: 'knowledge_extracted' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe('ki_count_positive_but_blocked_no_extraction');
  });

  it('detects ki > 0 with pre-extraction stage', () => {
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r2', title: 'Test 2', knowledge_item_count: 3, blocked_reason: 'none', canonical_stage: 'content_ready' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe('ki_count_positive_but_needs_extraction');
  });
});

describe('full extraction lifecycle flow', () => {
  it('resource leaves Needs Extract after KI creation', () => {
    const resource = makeLifecycleResource({ tags: ['podcast', 'direct_audio'] });

    expect(deriveBlockedReason(resource, { total: 0, active: 0, activeWithContexts: 0 })).toBe('no_extraction');
    expect(deriveBlockedReason(resource, { total: 10, active: 10, activeWithContexts: 10 })).toBe('none');
    expect(deriveCanonicalStage(resource, { total: 10, active: 10, activeWithContexts: 10 })).toBe('operationalized');

    const state = deriveControlPlaneState(makeCanonicalResource({
      canonical_stage: 'content_ready',
      knowledge_item_count: 10,
      active_ki_count: 10,
      active_ki_with_context_count: 10,
      blocked_reason: 'none',
    }));
    expect(state).toBe('activated');
  });
});
