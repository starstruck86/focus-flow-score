/**
 * Shared types for the Enrichment Operator Console
 */
import type { CanonicalState } from '@/lib/canonicalResourceState';
import type { VerifiedResource } from '@/lib/enrichmentVerification';
import type { RoadmapSummary } from '@/lib/systemGapRoadmap';
import type { InboxQueue } from '../ManualInputInbox';
import type { RemediationCycleState } from '@/lib/autonomousRemediation';

export type BucketFilter =
  | 'all'
  | 'complete'
  | 'auto_fixable'
  | 'advanced_extraction'
  | 'assisted_resolution'
  | 'needs_input'
  | 'processing'
  | 'quarantined'
  | 'system_gap';

// Selectable scope buckets for Run Full System
export type RunScopeBucket =
  | 'auto_fixable'
  | 'retry_different_strategy'
  | 'bad_scoring_state_bug'
  | 'already_fixed_stale_ui'
  | 'quarantined'
  | 'needs_input'
  | 'system_gap';

export const RUN_SCOPE_META: Record<RunScopeBucket, { label: string; defaultOn: boolean; description: string }> = {
  auto_fixable: { label: 'Auto-fixable', defaultOn: true, description: 'Re-enrich/reset automatically' },
  retry_different_strategy: { label: 'Retry Strategy', defaultOn: true, description: 'Reset and try alternate pipeline' },
  bad_scoring_state_bug: { label: 'Scoring Bugs', defaultOn: true, description: 'Re-score and reconcile state' },
  already_fixed_stale_ui: { label: 'Stale UI', defaultOn: true, description: 'Clear stale state markers' },
  quarantined: { label: 'Quarantined', defaultOn: false, description: 'Opt-in: unquarantine & reprocess' },
  needs_input: { label: 'Needs Input', defaultOn: false, description: 'Opt-in: only if input exists' },
  system_gap: { label: 'System Gap', defaultOn: false, description: 'Opt-in: normally roadmap only' },
};

export const DEFAULT_RUN_SCOPE: RunScopeBucket[] = ['auto_fixable', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui'];

// Per-bucket execution summary
export interface BucketExecutionSummary {
  bucket: string;
  bucketLabel: string;
  inputCount: number;
  attemptedCount: number;
  skippedCount: number;
  resolvedCount: number;
  improvedNotComplete: number;
  unchangedCount: number;
  failedCount: number;
  autoReleasedFromQuarantine: number;
  skipReasons: Record<string, number>;
  // Recovery-aware reporting
  queuedForRecoveryCount: number;
  awaitingManualInputCount: number;
  terminalFailedCount: number;
}

export interface RunSnapshot {
  timestamp: string;
  total: number;
  complete: number;
  broken: number;
  avgScore: number;
}

export interface RunResult {
  phase: 'idle' | 'scanning' | 'verifying' | 'remediating' | 'analyzing' | 'complete' | 'error';
  preSnapshot: RunSnapshot | null;
  postSnapshot: RunSnapshot | null;
  autoResolved: number;
  improvedNotComplete: number;
  needsManual: number;
  quarantined: number;
  systemGaps: number;
  remediationState: RemediationCycleState | null;
  roadmap: RoadmapSummary | null;
  inboxQueues: InboxQueue[];
  verifiedResources: VerifiedResource[];
  errorMessage?: string;
  bucketSummaries?: BucketExecutionSummary[];
}

export const EMPTY_RESULT: RunResult = {
  phase: 'idle', preSnapshot: null, postSnapshot: null,
  autoResolved: 0, improvedNotComplete: 0, needsManual: 0,
  quarantined: 0, systemGaps: 0,
  remediationState: null, roadmap: null, inboxQueues: [], verifiedResources: [],
};

export interface EnrichedResourceRow {
  resource: VerifiedResource;
  canonicalState: CanonicalState;
  canonicalLabel: string;
  nextAction: string;
  rootCause: string;
  bucketFilter: BucketFilter;
}

export function mapVerifiedToBucket(v: VerifiedResource): BucketFilter {
  if (v.fixabilityBucket === 'truly_complete') return 'complete';
  if (v.resolutionType === 'system_gap') return 'system_gap';
  if (v.quarantined || v.fixabilityBucket === 'needs_quarantine') return 'quarantined';
  if (['auto_fix_now', 'retry_different_strategy', 'bad_scoring_state_bug', 'already_fixed_stale_ui'].includes(v.fixabilityBucket)) return 'auto_fixable';
  if (['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source', 'accept_metadata_only'].includes(v.fixabilityBucket)) return 'needs_input';
  if (['deep_enrich_in_progress', 'queued_for_deep_enrich', 'queued_for_reenrich', 'reenrich_in_progress'].includes(v.enrichmentStatus)) return 'processing';
  return 'needs_input';
}

export const BUCKET_META: Record<BucketFilter, { label: string; color: string; icon: string }> = {
  all: { label: 'All Resources', color: 'text-foreground', icon: 'list' },
  complete: { label: 'Complete', color: 'text-status-green', icon: 'check-circle' },
  auto_fixable: { label: 'Auto-fixable', color: 'text-primary', icon: 'zap' },
  needs_input: { label: 'Needs Input', color: 'text-status-yellow', icon: 'file-text' },
  processing: { label: 'Processing', color: 'text-muted-foreground', icon: 'clock' },
  quarantined: { label: 'Quarantined', color: 'text-destructive', icon: 'ban' },
  system_gap: { label: 'System Gap', color: 'text-destructive', icon: 'wrench' },
};
