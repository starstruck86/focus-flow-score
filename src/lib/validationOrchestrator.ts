/**
 * End-to-End Validation Orchestrator
 * 
 * Chains: Verify → Remediate → Re-verify → Produce final summary.
 * Proves whether the remediation system actually works on real data.
 */
import { supabase } from '@/integrations/supabase/client';
import {
  verifyResource, buildVerificationSummary,
  type VerifiedResource, type VerificationSummary, type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import {
  buildRemediationQueues, type RemediationQueue,
} from '@/lib/remediationEngine';
import {
  runAutonomousRemediation,
  type RemediationCycleState, type RemediationItem,
} from '@/lib/autonomousRemediation';
import type { Resource } from '@/hooks/useResources';

// ── Types ─────────────────────────────────────────────────

export type ValidationPhase =
  | 'idle'
  | 'initial_verify'
  | 'remediating'
  | 'post_verify'
  | 'complete'
  | 'error';

export interface RemainingResource {
  id: string;
  title: string;
  url: string | null;
  subtypeLabel: string;
  score: number;
  status: string;
  reasonNotComplete: string;
  nextAction: string;
  failureBucket: string;
}

export interface RemainingWorkGroup {
  bucket: string;
  label: string;
  resources: RemainingResource[];
}

export interface RemediationActionLog {
  resourceId: string;
  title: string;
  queue: string;
  strategy: string | null;
  beforeScore: number;
  afterScore: number | null;
  outcome: string;
  timestamp: string;
}

export interface QueueEffectiveness {
  queue: string;
  label: string;
  inputCount: number;
  resolvedCount: number;
  improvedCount: number;
  unchangedCount: number;
  effectivenessRate: number;
}

export interface ValidationResult {
  phase: ValidationPhase;
  // Pre-remediation
  preVerification: VerificationSummary | null;
  preBrokenCount: number;
  preAverageScore: number;
  preResources: VerifiedResource[];
  // Remediation
  remediationState: RemediationCycleState | null;
  actionLog: RemediationActionLog[];
  // Post-remediation
  postVerification: VerificationSummary | null;
  postBrokenCount: number;
  postAverageScore: number;
  postResources: VerifiedResource[];
  // Final summary
  totalScanned: number;
  totalBelowHundredAtStart: number;
  totalAutoResolved: number;
  totalImprovedNotResolved: number;
  totalNeedsManualInput: number;
  totalQuarantined: number;
  netScoreChange: number;
  repeatedFailurePatterns: Array<{ pattern: string; count: number }>;
  // Remaining work
  remainingWork: RemainingWorkGroup[];
  totalRemainingNotHundred: number;
  // Queue effectiveness
  queueEffectiveness: QueueEffectiveness[];
  // System proven
  systemProven: boolean;
  blockers: string[];
  // Timing
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export type ValidationCallback = (result: ValidationResult) => void;

const REMAINING_BUCKET_LABELS: Record<string, string> = {
  needs_transcript: 'Needs Transcript',
  needs_pasted_content: 'Needs Pasted Content',
  needs_access_auth: 'Needs Access/Auth',
  needs_alternate_source: 'Needs Alternate Source',
  accept_metadata_only: 'Metadata Only Decision',
  needs_quarantine: 'Quarantined',
  bad_scoring_state_bug: 'State Bugs Still Broken',
  auto_fix_now: 'Auto Fix (Still Broken)',
  retry_different_strategy: 'Retry (Still Broken)',
  escalated: 'Escalated',
  other: 'Other',
};

// ── Helper: run verification on resources ─────────────────

function runVerification(
  resources: Resource[],
  audioJobsMap: Map<string, any>,
): { verified: VerifiedResource[]; summary: VerificationSummary } {
  const results: VerifiedResource[] = [];
  for (const resource of resources) {
    const rawJob = audioJobsMap.get(resource.id);
    const audioJob: AudioJobInfo | null = rawJob ? {
      resourceId: resource.id,
      stage: rawJob.stage ?? 'unknown',
      failureCode: rawJob.failure_code ?? null,
      failureReason: rawJob.failure_reason ?? null,
      hasTranscript: rawJob.has_transcript ?? false,
      transcriptMode: rawJob.transcript_mode ?? null,
      finalResolutionStatus: rawJob.final_resolution_status ?? null,
      transcriptWordCount: rawJob.transcript_word_count ?? null,
      attemptsCount: rawJob.attempts_count ?? 0,
    } : null;
    results.push(verifyResource(resource, audioJob));
  }
  return { verified: results, summary: buildVerificationSummary(results) };
}

function countBroken(verified: VerifiedResource[]): number {
  return verified.filter(v => v.fixabilityBucket !== 'truly_complete').length;
}

function averageScore(verified: VerifiedResource[]): number {
  if (!verified.length) return 0;
  return Math.round(verified.reduce((s, v) => s + v.qualityScore, 0) / verified.length);
}

// ── Main Orchestrator ─────────────────────────────────────

export async function runEndToEndValidation(
  fetchResources: () => Promise<Resource[]>,
  fetchAudioJobs: () => Promise<Map<string, any>>,
  onUpdate: ValidationCallback,
  signal?: AbortSignal,
): Promise<ValidationResult> {
  const result: ValidationResult = {
    phase: 'idle',
    preVerification: null,
    preBrokenCount: 0,
    preAverageScore: 0,
    preResources: [],
    remediationState: null,
    actionLog: [],
    postVerification: null,
    postBrokenCount: 0,
    postAverageScore: 0,
    postResources: [],
    totalScanned: 0,
    totalBelowHundredAtStart: 0,
    totalAutoResolved: 0,
    totalImprovedNotResolved: 0,
    totalNeedsManualInput: 0,
    totalQuarantined: 0,
    netScoreChange: 0,
    repeatedFailurePatterns: [],
    remainingWork: [],
    totalRemainingNotHundred: 0,
    queueEffectiveness: [],
    systemProven: false,
    blockers: [],
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };

  const emit = () => onUpdate({ ...result });

  try {
    // ── Phase 1: Initial Verification ───────────────────
    result.phase = 'initial_verify';
    emit();

    const resources1 = await fetchResources();
    const audioMap1 = await fetchAudioJobs();
    const { verified: pre, summary: preSummary } = runVerification(resources1, audioMap1);

    result.preVerification = preSummary;
    result.preResources = pre;
    result.preBrokenCount = countBroken(pre);
    result.preAverageScore = averageScore(pre);
    result.totalScanned = resources1.length;
    result.totalBelowHundredAtStart = result.preBrokenCount;
    emit();

    if (signal?.aborted) throw new Error('Aborted');

    // ── Phase 2: Remediation ────────────────────────────
    result.phase = 'remediating';
    emit();

    const brokenPre = pre.filter(v => v.fixabilityBucket !== 'truly_complete');
    if (brokenPre.length > 0) {
      const queues = buildRemediationQueues(brokenPre);
      
      const remState = await runAutonomousRemediation(
        queues,
        (s) => {
          result.remediationState = { ...s };
          emit();
        },
        signal,
      );

      result.remediationState = remState;

      // Build action log from remediation items
      result.actionLog = remState.items.map(item => ({
        resourceId: item.id,
        title: item.title,
        queue: item.queue,
        strategy: item.strategyUsed,
        beforeScore: item.beforeScore,
        afterScore: item.afterScore,
        outcome: item.isResolved
          ? `Resolved (${item.status})`
          : item.status === 'awaiting_manual'
          ? `Awaiting manual: ${item.whatToDoNext}`
          : item.status === 'escalated'
          ? `Escalated: ${item.whyFailed}`
          : item.status,
        timestamp: new Date().toISOString(),
      }));
    }

    if (signal?.aborted) throw new Error('Aborted');

    // ── Phase 3: Post-Remediation Verification ──────────
    result.phase = 'post_verify';
    emit();

    // Re-fetch fresh data after remediation
    const resources2 = await fetchResources();
    const audioMap2 = await fetchAudioJobs();
    const { verified: post, summary: postSummary } = runVerification(resources2, audioMap2);

    result.postVerification = postSummary;
    result.postResources = post;
    result.postBrokenCount = countBroken(post);
    result.postAverageScore = averageScore(post);

    // ── Compute final summary ───────────────────────────
    const preIds = new Set(result.preResources.filter(v => v.fixabilityBucket !== 'truly_complete').map(v => v.id));
    const postBrokenMap = new Map(post.filter(v => v.fixabilityBucket !== 'truly_complete').map(v => [v.id, v]));
    const postCompleteIds = new Set(post.filter(v => v.fixabilityBucket === 'truly_complete').map(v => v.id));

    // Auto-resolved: was broken before, now truly_complete
    result.totalAutoResolved = [...preIds].filter(id => postCompleteIds.has(id)).length;

    // Improved but not resolved
    if (result.remediationState) {
      result.totalImprovedNotResolved = result.remediationState.items.filter(
        i => i.afterScore !== null && i.afterScore > i.beforeScore && !i.isResolved
      ).length;
    }

    // Manual input needed
    result.totalNeedsManualInput = post.filter(v =>
      ['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source'].includes(v.fixabilityBucket)
    ).length;

    // Quarantined
    result.totalQuarantined = post.filter(v => v.fixabilityBucket === 'needs_quarantine' || v.enrichmentStatus === 'quarantined').length;

    // Net score change
    result.netScoreChange = result.postAverageScore - result.preAverageScore;

    // Repeated failure patterns (from post-verification)
    result.repeatedFailurePatterns = postSummary.repeatedPatterns;

    // ── Build remaining work groups ─────────────────────
    const stillBroken = post.filter(v => v.fixabilityBucket !== 'truly_complete');
    const groupMap = new Map<string, RemainingResource[]>();

    for (const v of stillBroken) {
      const bucket = mapToBucket(v);
      if (!groupMap.has(bucket)) groupMap.set(bucket, []);
      groupMap.get(bucket)!.push({
        id: v.id,
        title: v.title,
        url: v.url,
        subtypeLabel: v.subtypeLabel,
        score: v.qualityScore,
        status: v.enrichmentStatusLabel,
        reasonNotComplete: v.whyNotComplete,
        nextAction: v.recommendedAction,
        failureBucket: v.fixabilityBucket,
      });
    }

    result.remainingWork = Array.from(groupMap.entries())
      .map(([bucket, resources]) => ({
        bucket,
        label: REMAINING_BUCKET_LABELS[bucket] || bucket,
        resources: resources.sort((a, b) => b.score - a.score),
      }))
      .sort((a, b) => {
        const order = Object.keys(REMAINING_BUCKET_LABELS);
        return order.indexOf(a.bucket) - order.indexOf(b.bucket);
      });

    result.totalRemainingNotHundred = stillBroken.length;

    // ── Queue effectiveness ─────────────────────────────
    if (result.remediationState) {
      const byQueue = new Map<string, RemediationItem[]>();
      for (const item of result.remediationState.items) {
        if (!byQueue.has(item.queue)) byQueue.set(item.queue, []);
        byQueue.get(item.queue)!.push(item);
      }
      result.queueEffectiveness = Array.from(byQueue.entries()).map(([queue, items]) => {
        const resolved = items.filter(i => i.isResolved && i.status === 'resolved_complete').length;
        const improved = items.filter(i => i.afterScore !== null && i.afterScore > i.beforeScore && !i.isResolved).length;
        return {
          queue,
          label: REMAINING_BUCKET_LABELS[queue] || queue,
          inputCount: items.length,
          resolvedCount: resolved,
          improvedCount: improved,
          unchangedCount: items.length - resolved - improved,
          effectivenessRate: items.length > 0 ? Math.round((resolved / items.length) * 100) : 0,
        };
      });
    }

    // ── System proven check ─────────────────────────────
    const blockers: string[] = [];
    if (result.postBrokenCount >= result.preBrokenCount) {
      blockers.push(`Non-complete resources did not decrease (${result.preBrokenCount} → ${result.postBrokenCount})`);
    }
    if (result.totalAutoResolved === 0 && result.preBrokenCount > 0) {
      blockers.push('Zero resources were auto-resolved');
    }
    // Check if all remaining have clear paths
    const noPathCount = stillBroken.filter(v => !v.recommendedAction || v.recommendedAction === 'Unknown').length;
    if (noPathCount > 0) {
      blockers.push(`${noPathCount} resources have no clear next action`);
    }

    result.systemProven = blockers.length === 0 && result.postBrokenCount < result.preBrokenCount;
    result.blockers = blockers;

    // ── Done ────────────────────────────────────────────
    result.phase = 'complete';
    result.completedAt = new Date().toISOString();
    emit();

  } catch (e: any) {
    if (e.message === 'Aborted') {
      result.phase = 'complete';
    } else {
      result.phase = 'error';
      result.error = e.message;
    }
    result.completedAt = new Date().toISOString();
    emit();
  }

  return result;
}

function mapToBucket(v: VerifiedResource): string {
  switch (v.fixabilityBucket) {
    case 'needs_transcript': return 'needs_transcript';
    case 'needs_pasted_content': return 'needs_pasted_content';
    case 'needs_access_auth': return 'needs_access_auth';
    case 'needs_alternate_source': return 'needs_alternate_source';
    case 'accept_metadata_only': return 'accept_metadata_only';
    case 'needs_quarantine': return 'needs_quarantine';
    case 'bad_scoring_state_bug':
    case 'already_fixed_stale_ui': return 'bad_scoring_state_bug';
    default: return 'other';
  }
}
