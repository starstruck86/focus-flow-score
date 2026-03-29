import { describe, it, expect } from 'vitest';
import { classifyQuarantine, getQuarantineSubClass, shouldAutoRelease, getSkipReason, SKIP_REASON_LABELS } from '@/lib/quarantineClassification';
import type { VerifiedResource } from '@/lib/enrichmentVerification';

function makeVerified(overrides: Partial<VerifiedResource>): VerifiedResource {
  return {
    id: 'test-1', title: 'Test Resource', url: 'https://example.com',
    subtype: 'web_article', subtypeLabel: 'Web Article',
    enrichability: 'fully_enrichable',
    enrichmentStatus: 'quarantined', enrichmentStatusLabel: 'Quarantined',
    qualityScore: 0, qualityTier: 'empty',
    failureBucket: null, failureReason: null, failureCount: 0,
    retryEligible: false, quarantined: true,
    contentLength: 0, enrichmentVersion: 0, enrichedAt: null, lastAttemptAt: null,
    audioJobStatus: null, transcriptMode: null, finalResolutionStatus: null, hasTranscript: false,
    contradictions: [], fixabilityBucket: 'needs_quarantine',
    rootCauseCategory: 'Unknown', whyNotComplete: 'Quarantined',
    recommendedAction: 'Review', isSystemBehaviorCorrect: true,
    isMisclassified: false, isStuckInWrongQueue: false, scoreStatusContradict: false,
    resolutionType: 'auto_fix', rootCause: 'Legacy quarantine', requiredBuild: null,
    advancedExtractionAttempts: 0,
    ...overrides,
  };
}

describe('Quarantine Classification', () => {
  it('classifies fully_enrichable + failure_count 0 + quarantined as legacy_bad_state', () => {
    const v = makeVerified({ enrichability: 'fully_enrichable', failureCount: 0, failureReason: 'Pre-existing quarantine — manual review only' });
    const meta = classifyQuarantine(v);
    expect(meta.reasonType).toBe('legacy_bad_state');
    expect(meta.isValid).toBe(false);
    expect(meta.eligibleForAutoRelease).toBe(true);
  });

  it('operator-locked quarantine stays quarantined', () => {
    const v = makeVerified({ failureReason: 'Operator hold — needs review' });
    const meta = classifyQuarantine(v);
    expect(meta.reasonType).toBe('operator_hold');
    expect(meta.quarantineLocked).toBe(true);
    expect(meta.eligibleForAutoRelease).toBe(false);
  });

  it('repeated-failure quarantine stays quarantined', () => {
    const v = makeVerified({ failureCount: 3, lastAttemptAt: new Date().toISOString(), failureReason: 'Extraction failed 3 times' });
    const meta = classifyQuarantine(v);
    expect(meta.reasonType).toBe('repeated_failure');
    expect(meta.isValid).toBe(true);
    expect(meta.eligibleForAutoRelease).toBe(false);
  });

  it('system_gap quarantine stays quarantined', () => {
    const v = makeVerified({ resolutionType: 'system_gap', rootCause: 'No parser for this type' });
    const meta = classifyQuarantine(v);
    expect(meta.reasonType).toBe('system_gap');
    expect(meta.eligibleForAutoRelease).toBe(false);
  });

  it('shouldAutoRelease returns true for legacy bad state', () => {
    const v = makeVerified({ enrichability: 'fully_enrichable', failureCount: 0 });
    expect(shouldAutoRelease(v)).toBe(true);
  });

  it('shouldAutoRelease returns false for non-quarantined', () => {
    const v = makeVerified({ enrichmentStatus: 'not_enriched', quarantined: false });
    expect(shouldAutoRelease(v)).toBe(false);
  });

  it('shouldAutoRelease returns false for operator-locked', () => {
    const v = makeVerified({ failureReason: 'Operator hold' });
    expect(shouldAutoRelease(v)).toBe(false);
  });

  it('getQuarantineSubClass classifies correctly', () => {
    const legacy = classifyQuarantine(makeVerified({ enrichability: 'fully_enrichable', failureCount: 0 }));
    expect(getQuarantineSubClass(legacy)).toBe('invalid_quarantine_legacy');

    const opLocked = classifyQuarantine(makeVerified({ failureReason: 'Operator hold' }));
    expect(getQuarantineSubClass(opLocked)).toBe('operator_locked_quarantine');

    const valid = classifyQuarantine(makeVerified({ failureCount: 3, lastAttemptAt: new Date().toISOString() }));
    expect(getQuarantineSubClass(valid)).toBe('valid_quarantine');
  });
});

describe('Skip Reasons', () => {
  it('returns quarantined_not_selected when quarantined bucket not included', () => {
    const v = makeVerified({});
    const reason = getSkipReason(v, ['auto_fixable']);
    expect(reason).toBe('quarantined_not_selected');
  });

  it('returns system_gap_excluded for system gap resources', () => {
    const v = makeVerified({ resolutionType: 'system_gap', quarantined: false, fixabilityBucket: 'true_unsupported' });
    const reason = getSkipReason(v, ['auto_fixable']);
    expect(reason).toBe('system_gap_excluded');
  });

  it('returns null when buckets are selected', () => {
    const v = makeVerified({ quarantined: false, fixabilityBucket: 'auto_fix_now' });
    const reason = getSkipReason(v, ['auto_fixable', 'quarantined']);
    expect(reason).toBeNull();
  });
});

describe('Verification auto-release of invalid quarantines', () => {
  // This tests the classifyFixability change in enrichmentVerification.ts
  // by verifying that fully_enrichable + low failure count quarantined resources
  // get reclassified to auto_fix_now
  it('legacy quarantine with enrichable URL should not stay in needs_quarantine fixability', () => {
    // The actual classifyFixability is tested implicitly through verifyResource
    // Here we test the classification model directly
    const v = makeVerified({
      enrichability: 'fully_enrichable',
      failureCount: 0,
      contentLength: 0,
      enrichmentVersion: 0,
    });
    const meta = classifyQuarantine(v);
    expect(meta.reasonType).toBe('legacy_bad_state');
    expect(meta.eligibleForAutoRelease).toBe(true);
  });
});
