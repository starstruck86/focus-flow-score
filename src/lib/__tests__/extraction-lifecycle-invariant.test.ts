/**
 * Regression tests: Extraction Lifecycle Invariant
 *
 * INVARIANT: If ki_count > 0, the resource must NOT appear in "Needs Extract."
 *
 * Tests cover:
 *  1. deriveBlockedReason: ki.total > 0 → never returns 'no_extraction'
 *  2. deriveResourceTruth: ki.total > 0 → never adds 'needs_extraction' blocker
 *  3. auditImpossibleExtractionStates: detects violations
 *  4. Full flow: resource transitions from needs_extraction → extracted → leaves needs_extract
 */

import { describe, it, expect } from 'vitest';
import { deriveBlockedReason, deriveCanonicalStage } from '../canonicalLifecycle';
import { auditImpossibleExtractionStates } from '../postExtractionReconciliation';

// ── Helper: minimal resource shape ────────────────────────

function makeResource(overrides: Record<string, any> = {}) {
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

// ── 1. deriveBlockedReason: ki > 0 → never 'no_extraction' ──

describe('deriveBlockedReason invariant: ki > 0 → never no_extraction', () => {
  it('returns no_extraction when ki.total = 0 and enriched', () => {
    const result = deriveBlockedReason(makeResource(), { total: 0, active: 0, activeWithContexts: 0 });
    expect(result).toBe('no_extraction');
  });

  it('returns none when ki.total > 0 and all active with contexts', () => {
    const result = deriveBlockedReason(makeResource(), { total: 10, active: 10, activeWithContexts: 10 });
    expect(result).toBe('none');
  });

  it('returns no_activation when ki.total > 0 but active = 0', () => {
    const result = deriveBlockedReason(makeResource(), { total: 10, active: 0, activeWithContexts: 0 });
    expect(result).toBe('no_activation');
  });

  it('returns missing_contexts when active > 0 but no contexts', () => {
    const result = deriveBlockedReason(makeResource(), { total: 10, active: 5, activeWithContexts: 0 });
    expect(result).toBe('missing_contexts');
  });

  it('NEVER returns no_extraction when ki.total > 0 (exhaustive)', () => {
    const kiVariants = [
      { total: 1, active: 0, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 1 },
      { total: 50, active: 25, activeWithContexts: 10 },
      { total: 100, active: 0, activeWithContexts: 0 },
    ];
    for (const ki of kiVariants) {
      const result = deriveBlockedReason(makeResource(), ki);
      expect(result).not.toBe('no_extraction');
    }
  });
});

// ── 2. deriveCanonicalStage: ki > 0 → never 'tagged' ────────

describe('deriveCanonicalStage invariant: ki > 0 → past tagged', () => {
  it('returns tagged when ki.total = 0 and has tags', () => {
    const stage = deriveCanonicalStage(makeResource(), { total: 0, active: 0, activeWithContexts: 0 });
    expect(stage).toBe('tagged');
  });

  it('returns knowledge_extracted when ki.total > 0 but active = 0', () => {
    const stage = deriveCanonicalStage(makeResource(), { total: 5, active: 0, activeWithContexts: 0 });
    expect(stage).toBe('knowledge_extracted');
  });

  it('returns operationalized when fully active with contexts', () => {
    const stage = deriveCanonicalStage(makeResource(), { total: 5, active: 5, activeWithContexts: 5 });
    expect(stage).toBe('operationalized');
  });

  it('NEVER returns tagged when ki.total > 0', () => {
    const kiVariants = [
      { total: 1, active: 0, activeWithContexts: 0 },
      { total: 1, active: 1, activeWithContexts: 1 },
      { total: 100, active: 50, activeWithContexts: 25 },
    ];
    for (const ki of kiVariants) {
      const stage = deriveCanonicalStage(makeResource(), ki);
      expect(stage).not.toBe('tagged');
    }
  });
});

// ── 3. Impossible state audit ─────────────────────────────

describe('auditImpossibleExtractionStates', () => {
  it('detects ki > 0 with blocked_reason = no_extraction', () => {
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r1', title: 'Test', knowledge_item_count: 5, blocked_reason: 'no_extraction', canonical_stage: 'knowledge_extracted' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe('ki_count_positive_but_blocked_no_extraction');
  });

  it('detects ki > 0 with stage = tagged', () => {
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r2', title: 'Test 2', knowledge_item_count: 3, blocked_reason: 'none', canonical_stage: 'tagged' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe('ki_count_positive_but_needs_extraction');
  });

  it('returns empty when state is consistent', () => {
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r3', title: 'Healthy', knowledge_item_count: 10, blocked_reason: 'none', canonical_stage: 'operationalized' },
      { resource_id: 'r4', title: 'No KIs', knowledge_item_count: 0, blocked_reason: 'no_extraction', canonical_stage: 'tagged' },
    ]);
    expect(violations).toHaveLength(0);
  });
});

// ── 4. Full lifecycle flow ────────────────────────────────

describe('Full extraction lifecycle flow', () => {
  it('resource transitions: needs_extraction → extracted → leaves needs_extract', () => {
    const resource = makeResource();

    // Step 1: Before extraction — 0 KIs
    const ki0 = { total: 0, active: 0, activeWithContexts: 0 };
    expect(deriveBlockedReason(resource, ki0)).toBe('no_extraction');
    expect(deriveCanonicalStage(resource, ki0)).toBe('tagged');

    // Step 2: After extraction — KIs created and activated
    const ki10 = { total: 10, active: 10, activeWithContexts: 10 };
    expect(deriveBlockedReason(resource, ki10)).toBe('none');
    expect(deriveCanonicalStage(resource, ki10)).toBe('operationalized');

    // Step 3: Verify impossible state audit is clean
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'r1', title: 'Test', knowledge_item_count: 10, blocked_reason: 'none', canonical_stage: 'operationalized' },
    ]);
    expect(violations).toHaveLength(0);
  });

  it('stale flags are detected when ki_count > 0 but blocked_reason not cleared', () => {
    // Simulates the bug: KIs were saved but blocked_reason is stale
    const violations = auditImpossibleExtractionStates([
      { resource_id: 'bug1', title: 'Stale Resource', knowledge_item_count: 7, blocked_reason: 'no_extraction', canonical_stage: 'knowledge_extracted' },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0].violation).toBe('ki_count_positive_but_blocked_no_extraction');
  });
});
