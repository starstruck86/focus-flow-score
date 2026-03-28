/**
 * Enrichment Engine — Integrated Operator Console
 *
 * Combines: clickable summary cards, resource workbench, inline editor,
 * run controls, proof-of-impact, manual inbox, product roadmap.
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import {
  resolveCanonicalState, computeEnrichmentHealth,
  CANONICAL_STATE_LABELS,
  type CanonicalState, type EnrichmentHealthStats,
} from '@/lib/canonicalResourceState';
import {
  verifyResource, type VerifiedResource, type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import { buildRemediationQueues } from '@/lib/remediationEngine';
import { runAutonomousRemediation, type RemediationCycleState } from '@/lib/autonomousRemediation';
import { analyzeRemediationBatch } from '@/lib/remediationIntelligence';
import { generateProductRoadmap, type RoadmapSummary } from '@/lib/systemGapRoadmap';
import { shouldAutoRelease, classifyQuarantine, getQuarantineSubClass, SKIP_REASON_LABELS, getSkipReason, isRecoverableSkip, getRecoveryAction } from '@/lib/quarantineClassification';
import { ManualInputInbox, type InboxQueue, type InboxItem } from './ManualInputInbox';
import { FileText, Lock, ExternalLink, Eye } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { BucketFilter, RunSnapshot, RunResult, RunScopeBucket, BucketExecutionSummary } from './enrichment/types';
import { EMPTY_RESULT, mapVerifiedToBucket, RUN_SCOPE_META, DEFAULT_RUN_SCOPE } from './enrichment/types';
import { SummaryCards } from './enrichment/SummaryCards';
import { ResourceWorkbench } from './enrichment/ResourceWorkbench';
import { ResourceDetailDrawer } from './enrichment/ResourceDetailDrawer';
import { RunControls } from './enrichment/RunControls';
import { ProofOfImpact } from './enrichment/ProofOfImpact';
import { RoadmapPanel } from './enrichment/RoadmapPanel';
import { BucketSummaryPanel } from './enrichment/BucketSummaryPanel';

// ── Helpers ────────────────────────────────────────────────

function buildAudioJobInfo(rawJob: any): AudioJobInfo {
  return {
    resourceId: rawJob.resource_id, stage: rawJob.stage ?? 'unknown',
    failureCode: rawJob.failure_code ?? null, failureReason: rawJob.failure_reason ?? null,
    hasTranscript: rawJob.has_transcript ?? false, transcriptMode: rawJob.transcript_mode ?? null,
    finalResolutionStatus: rawJob.final_resolution_status ?? null,
    transcriptWordCount: rawJob.transcript_word_count ?? null, attemptsCount: rawJob.attempts_count ?? 0,
  };
}

async function fetchFreshData() {
  const [{ data: resources }, { data: audioRaw }] = await Promise.all([
    supabase.from('resources').select('*').order('created_at', { ascending: false }),
    supabase.from('audio_jobs').select('*').order('created_at', { ascending: false }).limit(500),
  ]);
  const audioMap = new Map<string, any>();
  for (const row of (audioRaw || [])) {
    if (!audioMap.has((row as any).resource_id)) audioMap.set((row as any).resource_id, row);
  }
  return { resources: (resources || []) as any[], audioMap };
}

function verifyAll(resources: any[], audioMap: Map<string, any>): VerifiedResource[] {
  return resources.map(r => {
    const rawJob = audioMap.get(r.id);
    const audioJob: AudioJobInfo | null = rawJob ? buildAudioJobInfo(rawJob) : null;
    return verifyResource(r as any, audioJob);
  });
}

function buildSnapshot(verified: VerifiedResource[]): RunSnapshot {
  const complete = verified.filter(v => v.fixabilityBucket === 'truly_complete').length;
  const avg = verified.length > 0 ? Math.round(verified.reduce((s, v) => s + v.qualityScore, 0) / verified.length) : 0;
  return { timestamp: new Date().toISOString(), total: verified.length, complete, broken: verified.length - complete, avgScore: avg };
}

function buildInboxQueues(resources: any[], audioMap: Map<string, any>): InboxQueue[] {
  const queueMap = new Map<CanonicalState, InboxItem[]>();
  const MANUAL_STATES: CanonicalState[] = [
    'needs_transcript', 'needs_pasted_content', 'needs_access_auth',
    'needs_alternate_source', 'metadata_only_candidate',
  ];

  for (const resource of resources) {
    const job = audioMap.get(resource.id) ?? null;
    const resolved = resolveCanonicalState(resource, job);
    if (!MANUAL_STATES.includes(resolved.state)) continue;
    if (!queueMap.has(resolved.state)) queueMap.set(resolved.state, []);
    queueMap.get(resolved.state)!.push({
      id: resource.id, title: resource.title, url: resource.file_url ?? null,
      subtypeLabel: resolved.subtypeLabel, score: resolved.qualityScore,
      status: resource.enrichment_status ?? 'unknown', reason: resolved.description,
      nextAction: resolved.nextAction || 'Review', sourceRouter: resolved.sourceRouter,
      failureCount: resource.failure_count ?? 0,
      lastAttempt: resource.last_enrichment_attempt_at ?? null,
      audioJobStatus: job?.stage ?? null,
    });
  }

  const ICONS: Record<string, React.ReactNode> = {
    needs_transcript: <FileText className="h-3.5 w-3.5 text-accent-foreground" />,
    needs_pasted_content: <FileText className="h-3.5 w-3.5 text-accent-foreground" />,
    needs_access_auth: <Lock className="h-3.5 w-3.5 text-destructive" />,
    needs_alternate_source: <ExternalLink className="h-3.5 w-3.5 text-destructive" />,
    metadata_only_candidate: <Eye className="h-3.5 w-3.5 text-muted-foreground" />,
  };
  const ACTIONS: Record<string, string> = {
    needs_transcript: 'Paste transcript',
    needs_pasted_content: 'Paste content',
    needs_access_auth: 'Provide access or paste',
    needs_alternate_source: 'Provide better URL',
    metadata_only_candidate: 'Accept or improve',
  };

  return MANUAL_STATES.filter(s => queueMap.has(s)).map(s => ({
    state: s, label: CANONICAL_STATE_LABELS[s], action: ACTIONS[s] || '',
    icon: ICONS[s] || <FileText className="h-3.5 w-3.5" />,
    items: queueMap.get(s) || [],
  }));
}

// Maps fixabilityBucket → RunScopeBucket for filtering
function fixabilityToScopeBucket(v: VerifiedResource): RunScopeBucket | null {
  if (v.fixabilityBucket === 'auto_fix_now') return 'auto_fixable';
  if (v.fixabilityBucket === 'retry_different_strategy') return 'retry_different_strategy';
  if (v.fixabilityBucket === 'bad_scoring_state_bug') return 'bad_scoring_state_bug';
  if (v.fixabilityBucket === 'already_fixed_stale_ui') return 'already_fixed_stale_ui';
  if (v.quarantined || v.fixabilityBucket === 'needs_quarantine') return 'quarantined';
  if (['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source', 'accept_metadata_only'].includes(v.fixabilityBucket)) return 'needs_input';
  if (v.resolutionType === 'system_gap') return 'system_gap';
  return null;
}

/**
 * Filter verified resources based on selected run scope buckets.
 * Auto-releases invalid quarantines when quarantined bucket is selected.
 */
function filterByScope(verified: VerifiedResource[], selectedBuckets: RunScopeBucket[]): {
  included: VerifiedResource[];
  skipped: Array<{ resource: VerifiedResource; reason: string }>;
  autoReleased: VerifiedResource[];
} {
  const included: VerifiedResource[] = [];
  const skipped: Array<{ resource: VerifiedResource; reason: string }> = [];
  const autoReleased: VerifiedResource[] = [];

  for (const v of verified) {
    if (v.fixabilityBucket === 'truly_complete' || v.fixabilityBucket === 'true_unsupported') {
      continue; // Skip complete/unsupported
    }

    const scopeBucket = fixabilityToScopeBucket(v);
    if (!scopeBucket || !selectedBuckets.includes(scopeBucket)) {
      const skipReason = getSkipReason(v, selectedBuckets);
      skipped.push({ resource: v, reason: skipReason ? SKIP_REASON_LABELS[skipReason] : `Bucket "${scopeBucket}" not selected` });
      continue;
    }

    // Handle quarantined resources
    if (v.quarantined || v.fixabilityBucket === 'needs_quarantine') {
      if (shouldAutoRelease(v)) {
        autoReleased.push(v);
        included.push(v); // Will be unquarantined and processed
      } else {
        const meta = classifyQuarantine(v);
        if (meta.quarantineLocked) {
          skipped.push({ resource: v, reason: SKIP_REASON_LABELS.operator_locked });
        } else if (selectedBuckets.includes('quarantined')) {
          included.push(v);
        } else {
          skipped.push({ resource: v, reason: SKIP_REASON_LABELS.quarantined_not_selected });
        }
      }
      continue;
    }

    // Handle needs_input: check if required input exists
    if (scopeBucket === 'needs_input' && !selectedBuckets.includes('needs_input')) {
      const skipReason = getSkipReason(v, selectedBuckets);
      skipped.push({ resource: v, reason: skipReason ? SKIP_REASON_LABELS[skipReason] : 'Needs input bucket not selected' });
      continue;
    }

    included.push(v);
  }

  return { included, skipped, autoReleased };
}

/**
 * Build per-bucket execution summaries from remediation state + skip data.
 */
function buildBucketSummaries(
  preVerified: VerifiedResource[],
  postVerified: VerifiedResource[],
  skipped: Array<{ resource: VerifiedResource; reason: string }>,
  autoReleased: VerifiedResource[],
  remState: RemediationCycleState | null,
): BucketExecutionSummary[] {
  const buckets = new Map<string, BucketExecutionSummary>();

  const getOrCreate = (bucket: string, label: string): BucketExecutionSummary => {
    if (!buckets.has(bucket)) {
      buckets.set(bucket, {
        bucket, bucketLabel: label,
        inputCount: 0, attemptedCount: 0, skippedCount: 0,
        resolvedCount: 0, improvedNotComplete: 0, unchangedCount: 0,
        failedCount: 0, autoReleasedFromQuarantine: 0, skipReasons: {},
      });
    }
    return buckets.get(bucket)!;
  };

  // Count inputs by pre-run bucket
  for (const v of preVerified) {
    if (v.fixabilityBucket === 'truly_complete' || v.fixabilityBucket === 'true_unsupported') continue;
    const sb = fixabilityToScopeBucket(v);
    if (sb) {
      const s = getOrCreate(sb, RUN_SCOPE_META[sb]?.label || sb);
      s.inputCount++;
    }
  }

  // Count skipped
  for (const { resource, reason } of skipped) {
    const sb = fixabilityToScopeBucket(resource);
    if (sb) {
      const s = getOrCreate(sb, RUN_SCOPE_META[sb]?.label || sb);
      s.skippedCount++;
      s.skipReasons[reason] = (s.skipReasons[reason] || 0) + 1;
    }
  }

  // Count auto-released
  const qSummary = getOrCreate('quarantined', 'Quarantined');
  qSummary.autoReleasedFromQuarantine = autoReleased.length;

  // Count attempted/resolved from remediation state
  if (remState) {
    for (const item of remState.items) {
      // Map the remediation queue back to scope bucket
      let sb: string = 'auto_fixable';
      if (item.queue === 'auto_fix_now') sb = 'auto_fixable';
      else if (item.queue === 'retry_different_strategy') sb = 'retry_different_strategy';
      else if (item.queue === 'bad_scoring_state_bug') sb = 'bad_scoring_state_bug';
      else if (item.queue === 'needs_quarantine') sb = 'quarantined';
      else if (['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source', 'accept_metadata_only'].includes(item.queue)) sb = 'needs_input';

      const s = getOrCreate(sb, RUN_SCOPE_META[sb as RunScopeBucket]?.label || sb);
      s.attemptedCount++;

      if (item.status === 'resolved_complete' || item.status === 'resolved_metadata_only') {
        s.resolvedCount++;
      } else if (item.afterScore !== null && item.afterScore > item.beforeScore) {
        s.improvedNotComplete++;
      } else if (item.status === 'escalated' || item.status === 'resolved_quarantined') {
        s.failedCount++;
      } else {
        s.unchangedCount++;
      }
    }
  }

  return Array.from(buckets.values()).filter(s => s.inputCount > 0 || s.attemptedCount > 0 || s.skippedCount > 0);
}

// ── Main Component ─────────────────────────────────────────

export function EnrichmentEngine() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: allResources, isLoading: loadingResources } = useAllResources();
  const { data: audioJobsMap, isLoading: loadingAudio } = useAudioJobsMap();
  const [result, setResult] = useState<RunResult>(EMPTY_RESULT);
  const [lastRun, setLastRun] = useState<RunSnapshot | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [showInbox, setShowInbox] = useState(false);
  const [activeBucket, setActiveBucket] = useState<BucketFilter>('all');
  const [selectedResource, setSelectedResource] = useState<VerifiedResource | null>(null);
  const [expandedSections, setExpanded] = useState<Record<string, boolean>>({});

  const isMobile = useIsMobile();
  const isRunning = !['idle', 'complete', 'error'].includes(result.phase);
  const isLoading = loadingResources || loadingAudio;

  // Compute live health
  const health = useMemo<EnrichmentHealthStats | null>(() => {
    if (!allResources) return null;
    return computeEnrichmentHealth(allResources, audioJobsMap ?? undefined);
  }, [allResources, audioJobsMap]);

  // Live verified resources for the workbench
  const liveVerified = useMemo<VerifiedResource[]>(() => {
    if (!allResources) return [];
    const audioMap = new Map<string, any>();
    if (audioJobsMap) for (const [k, v] of audioJobsMap) audioMap.set(k, v);
    return verifyAll(allResources as any[], audioMap);
  }, [allResources, audioJobsMap]);

  // Live inbox queues
  const liveInboxQueues = useMemo(() => {
    if (!allResources) return [];
    const audioMap = new Map<string, any>();
    if (audioJobsMap) for (const [k, v] of audioJobsMap) audioMap.set(k, v);
    return buildInboxQueues(allResources as any[], audioMap);
  }, [allResources, audioJobsMap]);

  const deltaComplete = lastRun ? (health?.trulyComplete ?? 0) - lastRun.complete : null;

  // Compute bucket counts for scope selector
  const scopeBucketCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const v of liveVerified) {
      const sb = fixabilityToScopeBucket(v);
      if (sb) counts[sb] = (counts[sb] || 0) + 1;
    }
    return counts;
  }, [liveVerified]);

  // ── Auto-release quarantined resources in DB ───────────
  async function autoReleaseQuarantines(resources: VerifiedResource[]): Promise<number> {
    if (resources.length === 0) return 0;
    const ids = resources.map(r => r.id);
    const { error } = await supabase
      .from('resources')
      .update({
        enrichment_status: 'not_enriched',
        failure_reason: null,
        failure_count: 0,
        last_status_change_at: new Date().toISOString(),
      } as any)
      .in('id', ids);
    if (error) {
      console.error('Auto-release failed:', error);
      return 0;
    }
    return ids.length;
  }

  // ── Run Full System (bucket-scoped) ────────────────────
  const handleRunFull = useCallback(async (selectedBuckets: RunScopeBucket[]) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setResult({ ...EMPTY_RESULT, phase: 'scanning' });
    try {
      const { resources, audioMap } = await fetchFreshData();
      if (controller.signal.aborted) return;
      setResult(prev => ({ ...prev, phase: 'verifying' }));
      const preVerified = verifyAll(resources, audioMap);
      const preSnap = buildSnapshot(preVerified);

      // Filter by selected scope
      const { included, skipped, autoReleased } = filterByScope(preVerified, selectedBuckets);

      // Auto-release invalid quarantines
      const releasedCount = await autoReleaseQuarantines(autoReleased);
      if (releasedCount > 0) {
        toast.info(`Auto-released ${releasedCount} invalid quarantine${releasedCount > 1 ? 's' : ''}`);
      }

      setResult(prev => ({ ...prev, phase: 'remediating', preSnapshot: preSnap }));
      let remState: RemediationCycleState | null = null;
      if (included.length > 0) {
        const queues = buildRemediationQueues(included);
        remState = await runAutonomousRemediation(queues, () => {}, controller.signal);
      }
      if (controller.signal.aborted) return;
      setResult(prev => ({ ...prev, phase: 'analyzing' }));
      const post = await fetchFreshData();
      const postVerified = verifyAll(post.resources, post.audioMap);
      const postSnap = buildSnapshot(postVerified);
      const stillBroken = postVerified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const analysis = analyzeRemediationBatch(stillBroken);
      const roadmap = generateProductRoadmap(stillBroken);
      const inboxQueues = buildInboxQueues(post.resources, post.audioMap);

      const bucketSummaries = buildBucketSummaries(preVerified, postVerified, skipped, autoReleased, remState);

      setResult({
        phase: 'complete', preSnapshot: preSnap, postSnapshot: postSnap,
        autoResolved: remState?.resolvedCompleteCount ?? 0,
        improvedNotComplete: (remState?.scoreImprovements ?? 0) - (remState?.resolvedCompleteCount ?? 0),
        needsManual: analysis.manualInput, quarantined: remState?.resolvedQuarantinedCount ?? 0,
        systemGaps: analysis.systemGaps.length, remediationState: remState, roadmap, inboxQueues,
        verifiedResources: postVerified,
        bucketSummaries,
      });
      setLastRun(preSnap);
      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      const totalAttempted = included.length;
      const totalSkipped = skipped.length;
      toast.success(`Done: ${postSnap.complete - preSnap.complete} newly resolved, ${totalAttempted} attempted, ${totalSkipped} skipped`);
    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
      toast.error(`Failed: ${e.message}`);
    }
  }, [qc]);

  // ── Bulk re-enrich a specific bucket ───────────────────
  const handleBulkBucket = useCallback(async (bucket: RunScopeBucket) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setResult({ ...EMPTY_RESULT, phase: 'scanning' });
    try {
      const { resources, audioMap } = await fetchFreshData();
      const verified = verifyAll(resources, audioMap);
      const preSnap = buildSnapshot(verified);

      const { included, skipped, autoReleased } = filterByScope(verified, [bucket]);
      if (included.length === 0) {
        setResult({ ...EMPTY_RESULT, phase: 'complete', preSnapshot: preSnap, postSnapshot: preSnap });
        toast.info(`No processable resources in ${RUN_SCOPE_META[bucket]?.label || bucket}`);
        return;
      }

      // Auto-release if quarantined
      await autoReleaseQuarantines(autoReleased);

      setResult(prev => ({ ...prev, phase: 'remediating', preSnapshot: preSnap }));
      const queues = buildRemediationQueues(included);
      const remState = await runAutonomousRemediation(queues, () => {}, controller.signal);
      const post = await fetchFreshData();
      const postVerified = verifyAll(post.resources, post.audioMap);
      const postSnap = buildSnapshot(postVerified);
      const bucketSummaries = buildBucketSummaries(verified, postVerified, skipped, autoReleased, remState);

      setResult({
        phase: 'complete', preSnapshot: preSnap, postSnapshot: postSnap,
        autoResolved: remState.resolvedCompleteCount, improvedNotComplete: 0,
        needsManual: 0, quarantined: remState.resolvedQuarantinedCount, systemGaps: 0,
        remediationState: remState, roadmap: null,
        inboxQueues: buildInboxQueues(post.resources, post.audioMap),
        verifiedResources: postVerified,
        bucketSummaries,
      });
      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      toast.success(`${RUN_SCOPE_META[bucket]?.label}: ${remState.resolvedCompleteCount} resolved`);
    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
    }
  }, [qc]);

  const handleAutoFixOnly = useCallback(async () => {
    // Delegate to handleBulkBucket with all auto-fix buckets
    handleRunFull(DEFAULT_RUN_SCOPE);
  }, [handleRunFull]);

  const handleVerifyOnly = useCallback(async () => {
    setResult({ ...EMPTY_RESULT, phase: 'verifying' });
    try {
      const { resources, audioMap } = await fetchFreshData();
      const verified = verifyAll(resources, audioMap);
      const snap = buildSnapshot(verified);
      const stillBroken = verified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const roadmap = generateProductRoadmap(stillBroken);
      setResult({
        phase: 'complete', preSnapshot: snap, postSnapshot: snap,
        autoResolved: 0, improvedNotComplete: 0,
        needsManual: stillBroken.filter(v => ['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source'].includes(v.fixabilityBucket)).length,
        quarantined: stillBroken.filter(v => v.fixabilityBucket === 'needs_quarantine').length,
        systemGaps: stillBroken.filter(v => v.resolutionType === 'system_gap').length,
        remediationState: null, roadmap,
        inboxQueues: buildInboxQueues(resources, audioMap),
        verifiedResources: verified,
      });
      toast.success('Verification complete');
    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
    }
  }, []);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setResult(prev => ({ ...prev, phase: 'idle' }));
  }, []);

  const handleInboxResolved = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['resources'] });
    qc.invalidateQueries({ queryKey: ['all-resources'] });
  }, [qc]);

  const toggleSection = (key: string) => setExpanded(prev => ({ ...prev, [key]: !prev[key] }));

  // Use post-run verified resources if available, otherwise live
  const displayResources = result.verifiedResources.length > 0 ? result.verifiedResources : liveVerified;
  const displayRoadmap = result.roadmap;

  return (
    <div className="space-y-3">
      {/* Summary Cards — clickable filters */}
      {health && (
        <SummaryCards
          health={health}
          activeBucket={activeBucket}
          onBucketClick={setActiveBucket}
          deltaComplete={deltaComplete}
          verifiedResources={displayResources}
        />
      )}

      {/* Run Controls */}
      <RunControls
        isRunning={isRunning}
        isLoading={isLoading}
        phase={result.phase}
        manualInboxCount={liveInboxQueues.reduce((s, q) => s + q.items.length, 0)}
        onRunFull={handleRunFull}
        onAutoFix={handleAutoFixOnly}
        onVerifyOnly={handleVerifyOnly}
        onStop={handleStop}
        onToggleInbox={() => setShowInbox(!showInbox)}
        showInbox={showInbox}
        onBulkBucket={handleBulkBucket}
        bucketCounts={scopeBucketCounts}
      />

      {/* Manual Inbox (toggle) */}
      {showInbox && !isRunning && (
        <ManualInputInbox queues={liveInboxQueues} onItemResolved={handleInboxResolved} />
      )}

      {/* Proof of Impact */}
      {result.phase === 'complete' && result.preSnapshot && result.postSnapshot && (
        <ProofOfImpact pre={result.preSnapshot} post={result.postSnapshot} result={result} />
      )}

      {/* Per-Bucket Execution Summary */}
      {result.phase === 'complete' && result.bucketSummaries && result.bucketSummaries.length > 0 && (
        <BucketSummaryPanel summaries={result.bucketSummaries} />
      )}

      {/* Resource Workbench + Detail Drawer */}
      {displayResources.length > 0 && (
        <div className="flex gap-0 border border-border rounded-lg overflow-hidden bg-background">
          {/* Workbench list */}
          <div className={selectedResource && !isMobile ? 'w-1/2 border-r border-border' : 'w-full'}>
            <div className="p-3">
              <ResourceWorkbench
                resources={displayResources}
                activeBucket={activeBucket}
                onSelectResource={setSelectedResource}
                selectedId={selectedResource?.id}
              />
            </div>
          </div>
          {/* Desktop: inline split pane */}
          {selectedResource && !isMobile && (
            <div className="w-1/2 min-h-[400px] max-h-[80vh]">
              <ResourceDetailDrawer
                key={selectedResource.id}
                resource={selectedResource}
                onClose={() => setSelectedResource(null)}
                onResourceUpdated={() => {
                  qc.invalidateQueries({ queryKey: ['resources'] });
                  qc.invalidateQueries({ queryKey: ['all-resources'] });
                  qc.invalidateQueries({ queryKey: ['audio-jobs-map'] });
                  setSelectedResource(null);
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Mobile: full-screen overlay for detail drawer */}
      {selectedResource && isMobile && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col">
          <ResourceDetailDrawer
            key={selectedResource.id}
            resource={selectedResource}
            onClose={() => setSelectedResource(null)}
            onResourceUpdated={() => {
              qc.invalidateQueries({ queryKey: ['resources'] });
              qc.invalidateQueries({ queryKey: ['all-resources'] });
              qc.invalidateQueries({ queryKey: ['audio-jobs-map'] });
              setSelectedResource(null);
            }}
          />
        </div>
      )}

      {/* Product Roadmap */}
      {displayRoadmap && displayRoadmap.issues.length > 0 && (
        <RoadmapPanel
          roadmap={displayRoadmap}
          expanded={expandedSections.roadmap ?? false}
          onToggle={() => toggleSection('roadmap')}
          onViewAffected={(ids) => {
            setActiveBucket('system_gap');
          }}
        />
      )}

      {/* Error */}
      {result.phase === 'error' && (
        <div className="rounded-lg border border-destructive p-4 text-center">
          <p className="text-sm text-destructive">{result.errorMessage}</p>
          <button className="text-xs text-primary hover:underline mt-1" onClick={() => setResult(EMPTY_RESULT)}>Dismiss</button>
        </div>
      )}
    </div>
  );
}
