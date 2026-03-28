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
  | 'needs_input'
  | 'processing'
  | 'quarantined'
  | 'system_gap';

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
  if (v.enrichmentStatus === 'deep_enrich_in_progress' || v.enrichmentStatus === 'queued_for_deep_enrich') return 'processing';
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
