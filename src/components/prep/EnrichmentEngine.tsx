/**
 * Enrichment Engine — Integrated execution system for Sales Brain OS
 *
 * Features:
 * - One-click "Run Full Enrichment System"
 * - Run Auto-Fix Only / Re-run Verification buttons
 * - Manual Input Inbox with inline editing
 * - Before/after proof-of-impact dashboard
 * - Delta since last run
 * - System gap roadmap
 */
import { useState, useMemo, useCallback, useRef } from 'react';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Zap, Square, CheckCircle2, AlertTriangle, Clock, FileText,
  Lock, RotateCcw, Ban, Wrench, ExternalLink, ChevronDown, ChevronRight,
  TrendingUp, Loader2, ArrowRight, Copy, Play, Eye, Inbox,
} from 'lucide-react';
import {
  resolveCanonicalState, computeEnrichmentHealth,
  CANONICAL_STATE_LABELS, CANONICAL_STATE_COLORS,
  type CanonicalState, type EnrichmentHealthStats,
} from '@/lib/canonicalResourceState';
import {
  verifyResource, buildVerificationSummary,
  type VerifiedResource, type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import { buildRemediationQueues } from '@/lib/remediationEngine';
import { runAutonomousRemediation, type RemediationCycleState } from '@/lib/autonomousRemediation';
import { analyzeRemediationBatch } from '@/lib/remediationIntelligence';
import { generateProductRoadmap, generateBuildPrompt, type RoadmapSummary, type RoadmapIssue } from '@/lib/systemGapRoadmap';
import { ManualInputInbox, type InboxQueue, type InboxItem } from './ManualInputInbox';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────

interface RunSnapshot {
  timestamp: string;
  total: number;
  complete: number;
  broken: number;
  avgScore: number;
}

interface RunResult {
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

const EMPTY_RESULT: RunResult = {
  phase: 'idle', preSnapshot: null, postSnapshot: null,
  autoResolved: 0, improvedNotComplete: 0, needsManual: 0,
  quarantined: 0, systemGaps: 0,
  remediationState: null, roadmap: null, inboxQueues: [], verifiedResources: [],
};

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
    needs_alternate_source: <ExternalLink className="h-3.5 w-3.5 text-orange-500" />,
    metadata_only_candidate: <Eye className="h-3.5 w-3.5 text-muted-foreground" />,
  };

  const ACTIONS: Record<string, string> = {
    needs_transcript: 'Paste transcript',
    needs_pasted_content: 'Paste content',
    needs_access_auth: 'Provide access or paste',
    needs_alternate_source: 'Provide better URL',
    metadata_only_candidate: 'Accept or improve',
  };

  return MANUAL_STATES
    .filter(s => queueMap.has(s))
    .map(s => ({
      state: s,
      label: CANONICAL_STATE_LABELS[s],
      action: ACTIONS[s] || '',
      icon: ICONS[s] || <FileText className="h-3.5 w-3.5" />,
      items: queueMap.get(s) || [],
    }));
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
  const [expandedSections, setExpanded] = useState<Record<string, boolean>>({});

  const isRunning = !['idle', 'complete', 'error'].includes(result.phase);
  const isLoading = loadingResources || loadingAudio;

  // Compute live health
  const health = useMemo<EnrichmentHealthStats | null>(() => {
    if (!allResources) return null;
    return computeEnrichmentHealth(allResources, audioJobsMap ?? undefined);
  }, [allResources, audioJobsMap]);

  // Live inbox queues (always available, not just after a run)
  const liveInboxQueues = useMemo(() => {
    if (!allResources) return [];
    const audioMap = new Map<string, any>();
    if (audioJobsMap) {
      for (const [k, v] of audioJobsMap) audioMap.set(k, v);
    }
    return buildInboxQueues(allResources as any[], audioMap);
  }, [allResources, audioJobsMap]);

  // ── Run Full System ────────────────────────────────────

  const handleRunFull = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setResult({ ...EMPTY_RESULT, phase: 'scanning' });

    try {
      // 1. Scan
      const { resources, audioMap } = await fetchFreshData();
      if (controller.signal.aborted) return;

      // 2. Pre-verify
      setResult(prev => ({ ...prev, phase: 'verifying' }));
      const preVerified = verifyAll(resources, audioMap);
      const preSnap = buildSnapshot(preVerified);
      const broken = preVerified.filter(v => v.fixabilityBucket !== 'truly_complete');

      setResult(prev => ({ ...prev, phase: 'remediating', preSnapshot: preSnap }));

      // 3. Remediate
      let remState: RemediationCycleState | null = null;
      if (broken.length > 0) {
        const queues = buildRemediationQueues(broken);
        remState = await runAutonomousRemediation(queues, () => {}, controller.signal);
      }
      if (controller.signal.aborted) return;

      // 4. Post-verify
      setResult(prev => ({ ...prev, phase: 'analyzing' }));
      const post = await fetchFreshData();
      const postVerified = verifyAll(post.resources, post.audioMap);
      const postSnap = buildSnapshot(postVerified);
      const stillBroken = postVerified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const analysis = analyzeRemediationBatch(stillBroken);
      const roadmap = generateProductRoadmap(stillBroken);
      const inboxQueues = buildInboxQueues(post.resources, post.audioMap);

      setResult({
        phase: 'complete', preSnapshot: preSnap, postSnapshot: postSnap,
        autoResolved: remState?.resolvedCompleteCount ?? 0,
        improvedNotComplete: (remState?.scoreImprovements ?? 0) - (remState?.resolvedCompleteCount ?? 0),
        needsManual: analysis.manualInput,
        quarantined: remState?.resolvedQuarantinedCount ?? 0,
        systemGaps: analysis.systemGaps.length,
        remediationState: remState, roadmap, inboxQueues,
        verifiedResources: postVerified,
      });
      setLastRun(preSnap);

      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      toast.success(`Done: ${postSnap.complete - preSnap.complete} newly resolved`);
    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
      toast.error(`Failed: ${e.message}`);
    }
  }, [qc]);

  // ── Run Auto-Fix Only ──────────────────────────────────

  const handleAutoFixOnly = useCallback(async () => {
    const controller = new AbortController();
    abortRef.current = controller;
    setResult({ ...EMPTY_RESULT, phase: 'scanning' });

    try {
      const { resources, audioMap } = await fetchFreshData();
      const verified = verifyAll(resources, audioMap);
      const preSnap = buildSnapshot(verified);
      const autoFixable = verified.filter(v =>
        v.fixabilityBucket === 'auto_fix_now' ||
        v.fixabilityBucket === 'retry_different_strategy' ||
        v.fixabilityBucket === 'bad_scoring_state_bug' ||
        v.fixabilityBucket === 'already_fixed_stale_ui'
      );

      if (autoFixable.length === 0) {
        setResult({ ...EMPTY_RESULT, phase: 'complete', preSnapshot: preSnap, postSnapshot: preSnap });
        toast.info('Nothing auto-fixable found');
        return;
      }

      setResult(prev => ({ ...prev, phase: 'remediating', preSnapshot: preSnap }));
      const queues = buildRemediationQueues(autoFixable);
      const remState = await runAutonomousRemediation(queues, () => {}, controller.signal);

      const post = await fetchFreshData();
      const postVerified = verifyAll(post.resources, post.audioMap);
      const postSnap = buildSnapshot(postVerified);

      setResult({
        phase: 'complete', preSnapshot: preSnap, postSnapshot: postSnap,
        autoResolved: remState.resolvedCompleteCount, improvedNotComplete: 0,
        needsManual: 0, quarantined: remState.resolvedQuarantinedCount, systemGaps: 0,
        remediationState: remState, roadmap: null,
        inboxQueues: buildInboxQueues(post.resources, post.audioMap),
        verifiedResources: postVerified,
      });

      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      toast.success(`Auto-fix: ${remState.resolvedCompleteCount} resolved`);
    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
    }
  }, [qc]);

  // ── Re-run Verification Only ───────────────────────────

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

  return (
    <div className="space-y-4">
      {/* ── Health Dashboard ── */}
      {health && <HealthDashboard health={health} lastRun={lastRun} />}

      {/* ── Primary Actions ── */}
      <Card>
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Enrichment Engine</p>
              <p className="text-xs text-muted-foreground">
                Scan → Verify → Auto-fix → Re-verify → Report
              </p>
            </div>
            {!isRunning ? (
              <Button onClick={handleRunFull} disabled={isLoading} className="bg-primary text-primary-foreground font-semibold gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Run Full System
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleStop} className="gap-1.5">
                <Square className="h-3.5 w-3.5" /> Stop ({result.phase})
              </Button>
            )}
          </div>

          {/* Secondary actions */}
          {!isRunning && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleAutoFixOnly} disabled={isLoading}>
                <Play className="h-3 w-3" /> Auto-Fix Only
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleVerifyOnly} disabled={isLoading}>
                <Eye className="h-3 w-3" /> Re-run Verification
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setShowInbox(!showInbox)}>
                <Inbox className="h-3 w-3" /> Manual Inbox
                {liveInboxQueues.reduce((s, q) => s + q.items.length, 0) > 0 && (
                  <Badge variant="secondary" className="text-[9px] ml-1 h-4 px-1">
                    {liveInboxQueues.reduce((s, q) => s + q.items.length, 0)}
                  </Badge>
                )}
              </Button>
            </div>
          )}

          {/* Progress */}
          {isRunning && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {result.phase === 'scanning' && 'Scanning all resources…'}
              {result.phase === 'verifying' && 'Verifying quality & state…'}
              {result.phase === 'remediating' && 'Running autonomous remediation…'}
              {result.phase === 'analyzing' && 'Analyzing results…'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Live Manual Inbox (toggle) ── */}
      {showInbox && !isRunning && (
        <ManualInputInbox queues={liveInboxQueues} onItemResolved={handleInboxResolved} />
      )}

      {/* ── Run Results ── */}
      {result.phase === 'complete' && result.preSnapshot && result.postSnapshot && (
        <>
          {/* Proof of Impact */}
          <ProofOfImpact pre={result.preSnapshot} post={result.postSnapshot} result={result} />

          {/* Post-run Manual Inbox */}
          {result.inboxQueues.length > 0 && (
            <div>
              <button onClick={() => toggleSection('postInbox')} className="flex items-center gap-1.5 mb-2">
                {expandedSections.postInbox ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <Inbox className="h-3.5 w-3.5 text-status-yellow" />
                <span className="text-sm font-semibold text-foreground">Remaining Manual Work</span>
                <Badge variant="outline" className="text-[10px]">
                  {result.inboxQueues.reduce((s, q) => s + q.items.length, 0)}
                </Badge>
              </button>
              {expandedSections.postInbox && (
                <ManualInputInbox queues={result.inboxQueues} onItemResolved={handleInboxResolved} />
              )}
            </div>
          )}

          {/* Remaining non-manual work (ready, retryable, quarantined, system gap) */}
          <RemainingWorkQueues
            verified={result.verifiedResources}
            expanded={expandedSections}
            onToggle={toggleSection}
          />

          {/* Roadmap */}
          {result.roadmap && result.roadmap.issues.length > 0 && (
            <RoadmapSection
              roadmap={result.roadmap}
              expanded={expandedSections.roadmap ?? false}
              onToggle={() => toggleSection('roadmap')}
            />
          )}
        </>
      )}

      {result.phase === 'error' && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
            <p className="text-sm text-destructive">{result.errorMessage}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setResult(EMPTY_RESULT)}>Dismiss</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Health Dashboard ──────────────────────────────────────

function HealthDashboard({ health, lastRun }: { health: EnrichmentHealthStats; lastRun: RunSnapshot | null }) {
  const delta = lastRun ? health.trulyComplete - lastRun.complete : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-foreground">
              {health.completionPct}% Complete
              {delta !== null && delta !== 0 && (
                <span className={cn('ml-1.5 text-[10px]', delta > 0 ? 'text-status-green' : 'text-destructive')}>
                  ({delta > 0 ? '+' : ''}{delta} since last run)
                </span>
              )}
            </span>
            <span className="text-[10px] text-muted-foreground">{health.trulyComplete}/{health.total}</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-status-green rounded-full transition-all duration-500"
              style={{ width: `${health.completionPct}%` }} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        <MiniStat icon={<CheckCircle2 className="h-3 w-3" />} label="Complete" value={health.trulyComplete} color="text-status-green" />
        <MiniStat icon={<Zap className="h-3 w-3" />} label="Auto-fixable" value={health.machinFixable} color="text-primary" />
        <MiniStat icon={<FileText className="h-3 w-3" />} label="Needs Input" value={health.needsInput} color="text-status-yellow" />
        <MiniStat icon={<Clock className="h-3 w-3" />} label="Processing" value={health.enriching} color="text-muted-foreground" />
        <MiniStat icon={<Ban className="h-3 w-3" />} label="Quarantined" value={health.quarantined} color="text-destructive" />
        <MiniStat icon={<Wrench className="h-3 w-3" />} label="System Gap" value={health.systemGap} color="text-destructive" />
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1.5">
      <div className={color}>{icon}</div>
      <div>
        <p className={cn('text-sm font-bold', color)}>{value}</p>
        <p className="text-[9px] text-muted-foreground leading-tight">{label}</p>
      </div>
    </div>
  );
}

// ── Proof of Impact ──────────────────────────────────────

function ProofOfImpact({ pre, post, result }: { pre: RunSnapshot; post: RunSnapshot; result: RunResult }) {
  const improved = post.complete > pre.complete;
  const newlyResolved = post.complete - pre.complete;
  const scoreDelta = post.avgScore - pre.avgScore;

  return (
    <Card className={improved ? 'border-status-green/30' : 'border-border'}>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start gap-3">
          {improved ? (
            <TrendingUp className="h-5 w-5 text-status-green shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-status-yellow shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {improved ? `System Improved — ${newlyResolved} newly resolved` : 'Verification Complete — Blockers Remain'}
            </p>

            {/* Executive summary grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-xs">
              <ProofStat label="Scanned" value={pre.total} />
              <ProofStat label="Under 100 before" value={pre.broken} />
              <ProofStat label="Under 100 after" value={post.broken} color={post.broken < pre.broken ? 'text-status-green' : undefined} />
              <ProofStat label="Newly resolved" value={newlyResolved} color={newlyResolved > 0 ? 'text-status-green' : undefined} />
              <ProofStat label="Auto-resolved" value={result.autoResolved} color="text-status-green" />
              <ProofStat label="Needs input" value={result.needsManual} color="text-status-yellow" />
              <ProofStat label="Quarantined" value={result.quarantined} color="text-destructive" />
              <ProofStat label="System gaps" value={result.systemGaps} color="text-destructive" />
            </div>

            {/* Before → After bar */}
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>Before: {pre.complete}/{pre.total} ({Math.round(pre.complete / pre.total * 100)}%)</span>
              <ArrowRight className="h-3 w-3" />
              <span>After: {post.complete}/{post.total} ({Math.round(post.complete / post.total * 100)}%)</span>
              <span className={cn('font-medium', scoreDelta > 0 ? 'text-status-green' : 'text-muted-foreground')}>
                {scoreDelta > 0 ? '+' : ''}{scoreDelta} avg score
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProofStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <span className="text-muted-foreground">{label}</span>
      <p className={cn('font-bold', color || 'text-foreground')}>{value}</p>
    </div>
  );
}

// ── Remaining Work (non-manual) ──────────────────────────

function RemainingWorkQueues({ verified, expanded, onToggle }: {
  verified: VerifiedResource[];
  expanded: Record<string, boolean>;
  onToggle: (key: string) => void;
}) {
  const groups: { key: string; label: string; color: string; items: VerifiedResource[] }[] = [
    { key: 'ready', label: 'Ready to Enrich', color: 'text-primary', items: verified.filter(v => v.fixabilityBucket === 'auto_fix_now') },
    { key: 'retry', label: 'Retryable', color: 'text-orange-500', items: verified.filter(v => v.fixabilityBucket === 'retry_different_strategy') },
    { key: 'quarantined', label: 'Quarantined', color: 'text-destructive', items: verified.filter(v => v.fixabilityBucket === 'needs_quarantine' || v.quarantined) },
    { key: 'sysgap', label: 'System Gap', color: 'text-destructive', items: verified.filter(v => v.resolutionType === 'system_gap') },
  ].filter(g => g.items.length > 0);

  if (groups.length === 0) return null;

  return (
    <div className="space-y-2">
      {groups.map(group => (
        <Card key={group.key}>
          <button onClick={() => onToggle(group.key)} className="w-full text-left px-4 py-3 flex items-center gap-2">
            {expanded[group.key] ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            <span className={cn('text-sm font-medium', group.color)}>{group.label}</span>
            <Badge variant="outline" className="text-[10px]">{group.items.length}</Badge>
          </button>
          {expanded[group.key] && (
            <CardContent className="pt-0 pb-3">
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-1">
                  {group.items.map(v => (
                    <div key={v.id} className="flex items-start gap-2 rounded px-2 py-1.5 text-xs">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground truncate">{v.title}</p>
                        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                          <span>{v.subtypeLabel}</span>
                          <span>Score: {v.qualityScore}</span>
                          <span>{v.enrichmentStatusLabel}</span>
                        </div>
                        <p className="text-[10px] text-muted-foreground">{v.whyNotComplete}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground shrink-0">{v.recommendedAction}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

// ── Roadmap Section ──────────────────────────────────────

function RoadmapSection({ roadmap, expanded, onToggle }: { roadmap: RoadmapSummary; expanded: boolean; onToggle: () => void }) {
  return (
    <Card className="border-destructive/30">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-2">
        {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <Wrench className="h-3.5 w-3.5 text-destructive" />
        <span className="text-sm font-semibold text-foreground">Product Roadmap</span>
        <Badge variant="destructive" className="text-[10px]">{roadmap.totalSystemGaps} gaps</Badge>
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3">
              {roadmap.issues.map((issue, i) => (
                <RoadmapIssueCard key={i} issue={issue} />
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

function RoadmapIssueCard({ issue }: { issue: RoadmapIssue }) {
  const sevColors: Record<string, string> = {
    critical: 'text-destructive bg-destructive/10',
    high: 'text-orange-500 bg-orange-500/10',
    medium: 'text-status-yellow bg-status-yellow/10',
    low: 'text-muted-foreground bg-muted',
  };

  return (
    <div className="border border-border rounded-md p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Badge className={cn('text-[10px]', sevColors[issue.severity])}>{issue.severity}</Badge>
        <span className="text-xs font-semibold text-foreground">{issue.issueName}</span>
        <span className="text-[10px] text-muted-foreground ml-auto">{issue.affectedResources} resources</span>
      </div>
      <p className="text-[10px] text-muted-foreground">{issue.businessImpact}</p>
      <p className="text-[10px] text-foreground">{issue.requiredBuild.description}</p>
      <div className="flex items-center gap-1.5">
        <Badge variant="outline" className="text-[9px]">{issue.subtypeLabel}</Badge>
        <Badge variant="outline" className="text-[9px]">{issue.requiredBuild.type}</Badge>
        <Button size="sm" variant="ghost" className="h-5 text-[9px] gap-0.5 ml-auto"
          onClick={() => { navigator.clipboard.writeText(generateBuildPrompt(issue)); toast.success('Copied'); }}>
          <Copy className="h-2.5 w-2.5" /> Copy Prompt
        </Button>
      </div>
    </div>
  );
}
