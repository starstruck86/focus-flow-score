/**
 * Quarantine Classification System
 *
 * Provides evidence-based quarantine classification instead of label-based.
 * Resources are only quarantined if there is real, current evidence justifying it.
 */
import type { VerifiedResource } from './enrichmentVerification';

// ── Quarantine Reason Types ───────────────────────────────

export type QuarantineReasonType =
  | 'repeated_failure'
  | 'operator_hold'
  | 'system_gap'
  | 'auth_block'
  | 'missing_manual_input'
  | 'legacy_bad_state';

export interface QuarantineMetadata {
  reasonType: QuarantineReasonType;
  reasonText: string;
  quarantinedBySystem: boolean;
  quarantinedByOperator: boolean;
  quarantineLocked: boolean;
  isValid: boolean;
  eligibleForAutoRelease: boolean;
}

export type QuarantineSubClass =
  | 'valid_quarantine'
  | 'invalid_quarantine_legacy'
  | 'operator_locked_quarantine';

// ── Classify quarantine validity ──────────────────────────

export function classifyQuarantine(v: VerifiedResource): QuarantineMetadata {
  const failureReason = v.failureReason || '';

  // Operator-locked: explicit operator quarantine
  if (failureReason.toLowerCase().includes('operator') || failureReason.toLowerCase().includes('manual hold')) {
    return {
      reasonType: 'operator_hold',
      reasonText: failureReason || 'Operator-placed hold',
      quarantinedBySystem: false,
      quarantinedByOperator: true,
      quarantineLocked: true,
      isValid: true,
      eligibleForAutoRelease: false,
    };
  }

  // System gap
  if (v.resolutionType === 'system_gap') {
    return {
      reasonType: 'system_gap',
      reasonText: v.rootCause || 'System gap — requires code change',
      quarantinedBySystem: true,
      quarantinedByOperator: false,
      quarantineLocked: false,
      isValid: true,
      eligibleForAutoRelease: false,
    };
  }

  // Auth block from real attempt
  if (failureReason.toLowerCase().includes('auth') || failureReason.toLowerCase().includes('access denied') || failureReason.toLowerCase().includes('forbidden')) {
    return {
      reasonType: 'auth_block',
      reasonText: failureReason,
      quarantinedBySystem: true,
      quarantinedByOperator: false,
      quarantineLocked: false,
      isValid: true,
      eligibleForAutoRelease: false,
    };
  }

  // Real repeated failure (failure_count >= 2 with actual attempts)
  if (v.failureCount >= 2 && v.lastAttemptAt) {
    return {
      reasonType: 'repeated_failure',
      reasonText: failureReason || `Failed ${v.failureCount} times`,
      quarantinedBySystem: true,
      quarantinedByOperator: false,
      quarantineLocked: false,
      isValid: true,
      eligibleForAutoRelease: false,
    };
  }

  // Missing manual input that's actually needed
  if (v.enrichability === 'manual_input_needed' || v.enrichability === 'needs_auth') {
    return {
      reasonType: 'missing_manual_input',
      reasonText: failureReason || 'Requires manual input',
      quarantinedBySystem: true,
      quarantinedByOperator: false,
      quarantineLocked: false,
      isValid: true,
      eligibleForAutoRelease: false,
    };
  }

  // Legacy bad state: enrichable, low/no failures, no real evidence
  // This is an INVALID quarantine
  return {
    reasonType: 'legacy_bad_state',
    reasonText: failureReason || 'Pre-existing quarantine without evidence',
    quarantinedBySystem: true,
    quarantinedByOperator: false,
    quarantineLocked: false,
    isValid: false,
    eligibleForAutoRelease: true,
  };
}

export function getQuarantineSubClass(meta: QuarantineMetadata): QuarantineSubClass {
  if (meta.quarantineLocked || meta.quarantinedByOperator) return 'operator_locked_quarantine';
  if (!meta.isValid) return 'invalid_quarantine_legacy';
  return 'valid_quarantine';
}

/**
 * Determines whether a quarantined resource should be auto-released.
 * Must satisfy ALL conditions:
 * - enrichability is fully or partially enrichable
 * - failure_count is 0 or no repeated-failure evidence
 * - not operator-locked
 * - not system_gap
 * - not confirmed auth_required from a real attempt
 */
export function shouldAutoRelease(v: VerifiedResource): boolean {
  if (v.enrichmentStatus !== 'quarantined') return false;

  const meta = classifyQuarantine(v);

  // Only auto-release legacy bad states
  if (!meta.eligibleForAutoRelease) return false;

  // Must be enrichable
  if (v.enrichability !== 'fully_enrichable' && v.enrichability !== 'partially_enrichable') return false;

  return true;
}

// ── Skip reasons ──────────────────────────────────────────

export type SkipReason =
  | 'missing_transcript'
  | 'missing_pasted_content'
  | 'still_auth_gated'
  | 'quarantined_not_selected'
  | 'system_gap_excluded'
  | 'no_alternate_url'
  | 'not_machine_fixable'
  | 'operator_locked'
  | 'needs_input_not_provided';

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  missing_transcript: 'Missing transcript',
  missing_pasted_content: 'Missing pasted content',
  still_auth_gated: 'Still auth-gated',
  quarantined_not_selected: 'Quarantined but not selected for this run',
  system_gap_excluded: 'System gap excluded from automation',
  no_alternate_url: 'No alternate URL provided',
  not_machine_fixable: 'Not machine-fixable',
  operator_locked: 'Operator-locked quarantine',
  needs_input_not_provided: 'Required manual input not yet provided',
};

export function getSkipReason(v: VerifiedResource, selectedBuckets: string[]): SkipReason | null {
  if (v.resolutionType === 'system_gap' && !selectedBuckets.includes('system_gap')) return 'system_gap_excluded';
  if (v.quarantined && !selectedBuckets.includes('quarantined')) return 'quarantined_not_selected';

  const meta = v.quarantined ? classifyQuarantine(v) : null;
  if (meta?.quarantineLocked) return 'operator_locked';

  if (v.fixabilityBucket === 'needs_transcript') return 'missing_transcript';
  if (v.fixabilityBucket === 'needs_pasted_content') return 'missing_pasted_content';
  if (v.fixabilityBucket === 'needs_access_auth') return 'still_auth_gated';
  if (v.fixabilityBucket === 'needs_alternate_source') return 'no_alternate_url';

  return null;
}
