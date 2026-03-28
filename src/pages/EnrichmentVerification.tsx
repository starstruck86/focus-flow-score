/**
 * Enrichment Verification — Operator-grade diagnostic + autonomous remediation.
 * Two modes: Verification (audit) and Remediation (fix).
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Download, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight,
  Copy, ExternalLink, Search, Filter, History, Zap, ShieldAlert, Lock, FileText,
  Ban, Bug, RotateCcw, Play, Loader2, Square, ArrowRight, Wrench, Eye
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  verifyResource, buildVerificationSummary, sortByPain, FIXABILITY_LABELS, FIXABILITY_COLORS,
  type VerifiedResource, type VerificationSummary, type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import {
  buildRemediationQueues, executeBulkAction, QUEUE_LABELS, QUEUE_DESCRIPTIONS, QUEUE_ACTIONS,
  type RemediationQueue, type BulkActionResult,
} from '@/lib/remediationEngine';
import {
  runAutonomousRemediation, getQueueSummaries, QUEUE_STRATEGIES,
  type RemediationCycleState, type RemediationItem, type RemediationItemStatus,
} from '@/lib/autonomousRemediation';
import {
  runEndToEndValidation,
  type ValidationResult, type ValidationPhase,
} from '@/lib/validationOrchestrator';
import { analyzeRemediationBatch, type RemediationSummary } from '@/lib/remediationIntelligence';
import { generateProductRoadmap, generateBuildPrompt, type RoadmapSummary, type RoadmapIssue, type IssueSeverity } from '@/lib/systemGapRoadmap';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';

// ── Persist ───────────────────────────────────────────────

async function persistRun(userId: string, totalResources: number, summary: VerificationSummary) {
  const totalBroken = summary.totalInScope - (summary.byFixability['truly_complete'] || 0);
  await supabase.from('verification_runs' as any).insert({
    user_id: userId, total_resources: totalResources, total_in_scope: summary.totalInScope,
    total_broken: totalBroken, total_contradictions: summary.totalContradictions,
    by_fixability: summary.byFixability, by_failure_bucket: summary.byFailureBucket,
    by_processing_state: summary.byProcessingState, by_subtype: summary.bySubtype,
    by_score_band: summary.byScoreBand, fix_recommendations: summary.fixRecommendations,
    repeated_patterns: summary.repeatedPatterns,
    summary_snapshot: {
      retryable: summary.byRetryable.retryable, nonRetryable: summary.byRetryable.nonRetryable,
      quarantined: summary.byQuarantined, manualRequired: summary.byManualRequired,
      metadataOnly: summary.byMetadataOnly,
    },
  } as any);
}

function useVerificationHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['verification-runs', user?.id],
    queryFn: async () => {
      const { data } = await supabase.from('verification_runs' as any).select('*').order('run_at', { ascending: false }).limit(10);
      return (data || []) as any[];
    },
    enabled: !!user,
  });
}

// ── Mode ──────────────────────────────────────────────────

type PageMode = 'verify' | 'remediate' | 'validate' | 'gaps' | 'roadmap';

// ── Main ──────────────────────────────────────────────────

export default function EnrichmentVerification() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: allResources, isLoading: loadingResources } = useAllResources();
  const { data: audioJobsMap, isLoading: loadingAudio } = useAudioJobsMap();
  const { data: history } = useVerificationHistory();

  const [mode, setMode] = useState<PageMode>('verify');
  const [hasRun, setHasRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [includeComplete, setIncludeComplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [drawerResource, setDrawerResource] = useState<VerifiedResource | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dashboard: true, fixPlan: true, remediation: true, patterns: false, table: true,
  });
  const [runningQueue, setRunningQueue] = useState<RemediationQueue | null>(null);
  const [lastBulkResult, setLastBulkResult] = useState<BulkActionResult | null>(null);

  // Autonomous remediation state
  const [remediationState, setRemediationState] = useState<RemediationCycleState | null>(null);
  const [remediationAbort, setRemediationAbort] = useState<AbortController | null>(null);
  const [remediationFilter, setRemediationFilter] = useState<string>('all');

  // E2E Validation state
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [validationAbort, setValidationAbort] = useState<AbortController | null>(null);
  const isValidating = validationResult?.phase !== undefined && validationResult.phase !== 'idle' && validationResult.phase !== 'complete' && validationResult.phase !== 'error';

  // Fix Everything state
  type FixEverythingPhase = 'idle' | 'verifying' | 'remediating' | 'analyzing' | 'complete' | 'error';
  const [fixPhase, setFixPhase] = useState<FixEverythingPhase>('idle');
  const [fixSummary, setFixSummary] = useState<{
    fixedAuto: number; needsInput: number; systemGaps: number;
    totalScanned: number; remediationSummary: RemediationSummary | null;
    remediationState: RemediationCycleState | null;
    gapDetails: Array<{ failureType: string; count: number; description: string }>;
    manualGroups: Array<{ bucket: string; count: number; action: string }>;
  } | null>(null);
  const [fixAbort, setFixAbort] = useState<AbortController | null>(null);
  const isFixing = fixPhase !== 'idle' && fixPhase !== 'complete' && fixPhase !== 'error';

  // Verification
  const { verified, summary } = useMemo(() => {
    if (!hasRun || !allResources) return { verified: [], summary: null };
    const audioMap = audioJobsMap ?? new Map();
    const results: VerifiedResource[] = [];
    for (const resource of allResources) {
      const rawJob = audioMap.get(resource.id);
      const audioJob: AudioJobInfo | null = rawJob ? {
        resourceId: resource.id, stage: (rawJob as any).stage ?? 'unknown',
        failureCode: (rawJob as any).failure_code ?? null, failureReason: (rawJob as any).failure_reason ?? null,
        hasTranscript: (rawJob as any).has_transcript ?? false, transcriptMode: (rawJob as any).transcript_mode ?? null,
        finalResolutionStatus: (rawJob as any).final_resolution_status ?? null,
        transcriptWordCount: (rawJob as any).transcript_word_count ?? null, attemptsCount: (rawJob as any).attempts_count ?? 0,
      } : null;
      const v = verifyResource(resource, audioJob);
      if (includeComplete || v.fixabilityBucket !== 'truly_complete') results.push(v);
    }
    results.sort(sortByPain);
    return { verified: results, summary: buildVerificationSummary(results) };
  }, [hasRun, allResources, audioJobsMap, includeComplete]);

  useEffect(() => {
    if (summary && hasRun && user && !saving) {
      setSaving(true);
      persistRun(user.id, allResources?.length ?? 0, summary).then(() => {
        qc.invalidateQueries({ queryKey: ['verification-runs'] });
        setSaving(false);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRun]);

  const bannerStats = useMemo(() => {
    if (!summary) return null;
    const fix = summary.byFixability;
    return {
      totalBroken: summary.totalInScope - (fix['truly_complete'] || 0),
      autoFix: fix['auto_fix_now'] || 0,
      retryable: fix['retry_different_strategy'] || 0,
      needsInput: (fix['needs_transcript'] || 0) + (fix['needs_pasted_content'] || 0) + (fix['needs_alternate_source'] || 0),
      needsAuth: fix['needs_access_auth'] || 0,
      metadataOnly: fix['accept_metadata_only'] || 0,
      quarantined: fix['needs_quarantine'] || 0,
      stateBugs: (fix['bad_scoring_state_bug'] || 0) + (fix['already_fixed_stale_ui'] || 0),
    };
  }, [summary]);

  const filtered = useMemo(() => {
    let list = verified;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(v => v.title.toLowerCase().includes(q) || v.url?.toLowerCase().includes(q) || v.subtypeLabel.toLowerCase().includes(q));
    }
    if (selectedBucket) list = list.filter(v => v.fixabilityBucket === selectedBucket);
    return list;
  }, [verified, searchQuery, selectedBucket]);

  const remediationQueues = useMemo(() => {
    if (!verified.length) return null;
    return buildRemediationQueues(verified);
  }, [verified]);

  const queueSummaries = useMemo(() => {
    if (!remediationQueues) return [];
    return getQueueSummaries(remediationQueues);
  }, [remediationQueues]);

  const handleBulkAction = useCallback(async (queue: RemediationQueue) => {
    if (!remediationQueues) return;
    const resources = remediationQueues[queue];
    if (!resources.length) { toast.info('No resources in this queue'); return; }
    setRunningQueue(queue);
    setLastBulkResult(null);
    try {
      const result = await executeBulkAction(queue, resources);
      setLastBulkResult(result);
      toast[result.failed === 0 ? 'success' : 'warning'](`${QUEUE_LABELS[queue]}: ${result.succeeded} updated${result.failed > 0 ? `, ${result.failed} failed` : ''}`);
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
    } catch (e: any) { toast.error(e.message); }
    finally { setRunningQueue(null); }
  }, [remediationQueues, qc]);

  const handleRun = useCallback(() => {
    setHasRun(false);
    setTimeout(() => setHasRun(true), 0);
  }, []);

  // ── Autonomous remediation ──────────────────────────────

  const isRemediating = remediationState?.status === 'running';

  const handleStartRemediation = useCallback(() => {
    if (!remediationQueues) return;
    const controller = new AbortController();
    setRemediationAbort(controller);
    setRemediationFilter('all');
    runAutonomousRemediation(remediationQueues, (s) => {
      setRemediationState({ ...s });
      if (s.status === 'completed') {
        qc.invalidateQueries({ queryKey: ['resources'] });
        qc.invalidateQueries({ queryKey: ['all-resources'] });
        toast.success(`Remediation complete: ${s.resolvedCompleteCount} resolved, ${s.resolvedQuarantinedCount} quarantined, ${s.awaitingManualCount} awaiting manual`);
      }
    }, controller.signal);
  }, [remediationQueues, qc]);

  const handleStopRemediation = useCallback(() => {
    remediationAbort?.abort();
    setRemediationAbort(null);
  }, [remediationAbort]);

  const handleRunAutoFixQueue = useCallback(() => handleBulkAction('auto_fix_now'), [handleBulkAction]);
  const handleRunRetryQueue = useCallback(() => handleBulkAction('retry_different_strategy'), [handleBulkAction]);
  const handleRunStateBugs = useCallback(() => handleBulkAction('bad_scoring_state_bug'), [handleBulkAction]);

  const toggleSection = (key: string) => setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify({ summary, resources: verified }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `verification-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
  }, [verified, summary]);

  // ── E2E Validation ─────────────────────────────────────
  const handleStartValidation = useCallback(async () => {
    const controller = new AbortController();
    setValidationAbort(controller);
    setMode('validate');

    const fetchRes = async () => {
      const { data } = await supabase.from('resources').select('*').order('created_at', { ascending: false });
      return (data || []) as any as Resource[];
    };
    const fetchAudio = async () => {
      const { data } = await supabase.from('audio_jobs').select('*').order('created_at', { ascending: false }).limit(500);
      const map = new Map<string, any>();
      for (const row of (data || [])) {
        if (!map.has((row as any).resource_id)) map.set((row as any).resource_id, row);
      }
      return map;
    };

    await runEndToEndValidation(fetchRes, fetchAudio, (r) => {
      setValidationResult({ ...r });
      if (r.phase === 'complete') {
        qc.invalidateQueries({ queryKey: ['resources'] });
        qc.invalidateQueries({ queryKey: ['all-resources'] });
      }
    }, controller.signal);
  }, [qc]);

  const handleStopValidation = useCallback(() => {
    validationAbort?.abort();
    setValidationAbort(null);
  }, [validationAbort]);

  // ── Fix Everything ───────────────────────────────────────
  const handleFixEverything = useCallback(async () => {
    const controller = new AbortController();
    setFixAbort(controller);
    setFixSummary(null);
    setFixPhase('verifying');

    try {
      // Step 1: Run verification
      setHasRun(false);
      await new Promise(r => setTimeout(r, 50));
      setHasRun(true);
      await new Promise(r => setTimeout(r, 200)); // let useMemo recompute

      // We need fresh verified data — re-fetch from supabase
      const { data: freshResources } = await supabase.from('resources').select('*').order('created_at', { ascending: false });
      const { data: freshAudioRaw } = await supabase.from('audio_jobs').select('*').order('created_at', { ascending: false }).limit(500);
      const freshAudioMap = new Map<string, any>();
      for (const row of (freshAudioRaw || [])) {
        if (!freshAudioMap.has((row as any).resource_id)) freshAudioMap.set((row as any).resource_id, row);
      }

      const freshVerified: VerifiedResource[] = [];
      for (const resource of (freshResources || []) as any[]) {
        const rawJob = freshAudioMap.get(resource.id);
        const audioJob: AudioJobInfo | null = rawJob ? {
          resourceId: resource.id, stage: rawJob.stage ?? 'unknown',
          failureCode: rawJob.failure_code ?? null, failureReason: rawJob.failure_reason ?? null,
          hasTranscript: rawJob.has_transcript ?? false, transcriptMode: rawJob.transcript_mode ?? null,
          finalResolutionStatus: rawJob.final_resolution_status ?? null,
          transcriptWordCount: rawJob.transcript_word_count ?? null, attemptsCount: rawJob.attempts_count ?? 0,
        } : null;
        freshVerified.push(verifyResource(resource as any, audioJob));
      }

      if (controller.signal.aborted) return;

      // Step 2: Run remediation on broken resources
      setFixPhase('remediating');
      const broken = freshVerified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const queues = buildRemediationQueues(broken);

      let remState: RemediationCycleState | null = null;
      if (broken.length > 0) {
        remState = await runAutonomousRemediation(queues, (s) => {
          setRemediationState({ ...s });
        }, controller.signal);
      }

      if (controller.signal.aborted) return;

      // Step 3: Run remediation intelligence analysis
      setFixPhase('analyzing');

      // Re-verify after remediation
      const { data: postResources } = await supabase.from('resources').select('*').order('created_at', { ascending: false });
      const { data: postAudioRaw } = await supabase.from('audio_jobs').select('*').order('created_at', { ascending: false }).limit(500);
      const postAudioMap = new Map<string, any>();
      for (const row of (postAudioRaw || [])) {
        if (!postAudioMap.has((row as any).resource_id)) postAudioMap.set((row as any).resource_id, row);
      }

      const postVerified: VerifiedResource[] = [];
      for (const resource of (postResources || []) as any[]) {
        const rawJob = postAudioMap.get(resource.id);
        const audioJob: AudioJobInfo | null = rawJob ? {
          resourceId: resource.id, stage: rawJob.stage ?? 'unknown',
          failureCode: rawJob.failure_code ?? null, failureReason: rawJob.failure_reason ?? null,
          hasTranscript: rawJob.has_transcript ?? false, transcriptMode: rawJob.transcript_mode ?? null,
          finalResolutionStatus: rawJob.final_resolution_status ?? null,
          transcriptWordCount: rawJob.transcript_word_count ?? null, attemptsCount: rawJob.attempts_count ?? 0,
        } : null;
        postVerified.push(verifyResource(resource as any, audioJob));
      }

      const stillBroken = postVerified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const analysis = analyzeRemediationBatch(stillBroken);

      const gapDetails = analysis.systemGaps.map(g => ({
        failureType: g.failureType,
        count: g.count,
        description: g.requiredBuild.description,
      }));

      const manualBuckets = ['needs_transcript', 'needs_pasted_content', 'needs_access_auth', 'needs_alternate_source'];
      const manualGroups = manualBuckets
        .map(b => ({
          bucket: b,
          count: stillBroken.filter(v => v.fixabilityBucket === b).length,
          action: QUEUE_ACTIONS[b as RemediationQueue] || 'Provide required input',
        }))
        .filter(g => g.count > 0);

      setFixSummary({
        fixedAuto: remState?.resolvedCompleteCount ?? 0,
        needsInput: analysis.manualInput,
        systemGaps: analysis.systemGaps.length,
        totalScanned: freshVerified.length,
        remediationSummary: analysis,
        remediationState: remState,
        gapDetails,
        manualGroups,
      });

      setFixPhase('complete');
      // Auto-refresh data after completion
      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      await qc.invalidateQueries({ queryKey: ['verification-runs'] });
      // Re-run verification view with fresh data
      setHasRun(false);
      await new Promise(r => setTimeout(r, 100));
      setHasRun(true);
      toast.success('Run Full System complete');
    } catch (e: any) {
      setFixPhase('error');
      toast.error(`Run Full System failed: ${e.message}`);
    }
  }, [qc]);

  const handleStopFix = useCallback(() => {
    fixAbort?.abort();
    setFixAbort(null);
    setFixPhase('idle');
  }, [fixAbort]);

  const isLoading = loadingResources || loadingAudio;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/prep')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Enrichment Verification</h1>
              <p className="text-xs text-muted-foreground">{allResources?.length ?? 0} resources · {mode === 'verify' ? 'Audit Mode' : mode === 'remediate' ? 'Remediation Mode' : mode === 'gaps' ? 'System Gaps' : mode === 'roadmap' ? 'Product Roadmap' : 'Validation Mode'}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            {hasRun && (
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => setMode('verify')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${mode === 'verify' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  <Eye className="h-3 w-3" /> Verify
                </button>
                <button
                  onClick={() => setMode('remediate')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${mode === 'remediate' ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  <Wrench className="h-3 w-3" /> Remediate
                </button>
                <button
                  onClick={() => setMode('gaps')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${mode === 'gaps' ? 'bg-destructive text-destructive-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  <ShieldAlert className="h-3 w-3" /> System Gaps
                </button>
                <button
                  onClick={() => setMode('roadmap')}
                  className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors ${mode === 'roadmap' ? 'bg-destructive text-destructive-foreground' : 'bg-card text-muted-foreground hover:bg-muted'}`}
                >
                  <ArrowRight className="h-3 w-3" /> Roadmap
                </button>
              </div>
            )}

            {hasRun && (
              <Button variant="outline" size="sm" onClick={exportJSON}>
                <Download className="h-3 w-3 mr-1" /> Export
              </Button>
            )}

            {mode === 'remediate' && hasRun && remediationQueues && !isRemediating && (
              <Button size="sm" onClick={handleStartRemediation} disabled={isLoading}
                className="bg-status-green hover:bg-status-green/90 text-status-green-foreground">
                <Zap className="h-3 w-3 mr-1" /> Process All Queues
              </Button>
            )}
            {isRemediating && (
              <Button size="sm" variant="destructive" onClick={handleStopRemediation}>
                <Square className="h-3 w-3 mr-1" /> Stop
              </Button>
            )}

            {/* E2E Validation */}
            {!isValidating && !isRemediating && (
              <Button size="sm" onClick={handleStartValidation} disabled={isLoading || saving}
                className="bg-accent text-accent-foreground hover:bg-accent/90">
                <ShieldAlert className="h-3 w-3 mr-1" /> Run E2E Validation
              </Button>
            )}
            {isValidating && (
              <Button size="sm" variant="destructive" onClick={handleStopValidation}>
                <Square className="h-3 w-3 mr-1" /> Stop Validation
              </Button>
            )}

            {/* Run Full System — primary action */}
            {!isFixing && !isRemediating && !isValidating && (
              <Button size="sm" onClick={handleFixEverything} disabled={isLoading || saving}
                className="bg-primary text-primary-foreground hover:bg-primary/90 font-semibold">
                <Zap className="h-3 w-3 mr-1" /> Run Full System
              </Button>
            )}
            {isFixing && (
              <Button size="sm" variant="destructive" onClick={handleStopFix}>
                <Square className="h-3 w-3 mr-1" /> Stop ({fixPhase})
              </Button>
            )}

            <Button size="sm" onClick={handleRun} disabled={isLoading || saving || isRemediating || isValidating || isFixing}>
              {saving ? 'Saving…' : hasRun ? 'Re-run' : 'Run Verification'}
            </Button>
          </div>
        </div>
      </div>

      {/* Banner */}
      {hasRun && bannerStats && (
        <div className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 py-3">
            <div className="grid grid-cols-4 sm:grid-cols-8 gap-2">
              <BannerStat icon={<AlertTriangle className="h-3.5 w-3.5" />} label="Broken" value={bannerStats.totalBroken} color="text-status-red" />
              <BannerStat icon={<Zap className="h-3.5 w-3.5" />} label="Auto-fix" value={bannerStats.autoFix} color="text-status-green" />
              <BannerStat icon={<RotateCcw className="h-3.5 w-3.5" />} label="Retryable" value={bannerStats.retryable} color="text-status-yellow" />
              <BannerStat icon={<FileText className="h-3.5 w-3.5" />} label="Needs Input" value={bannerStats.needsInput} color="text-primary" />
              <BannerStat icon={<Lock className="h-3.5 w-3.5" />} label="Needs Auth" value={bannerStats.needsAuth} color="text-orange-500" />
              <BannerStat icon={<FileText className="h-3.5 w-3.5" />} label="Meta Only" value={bannerStats.metadataOnly} color="text-muted-foreground" />
              <BannerStat icon={<Ban className="h-3.5 w-3.5" />} label="Quarantined" value={bannerStats.quarantined} color="text-status-red" />
              <BannerStat icon={<Bug className="h-3.5 w-3.5" />} label="State Bugs" value={bannerStats.stateBugs} color="text-status-red" />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {!hasRun && !saving && !isFixing && (
          <div className="rounded-lg border border-border p-8 text-center space-y-4">
            <Zap className="h-10 w-10 text-primary mx-auto" />
            <h2 className="text-xl font-semibold">Run Full System</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Verifies all resources, runs autonomous remediation, re-verifies, and reports remaining work. One click, no decisions.
            </p>
            <Button onClick={handleFixEverything} disabled={isLoading} size="lg" className="bg-primary text-primary-foreground">
              <Zap className="h-4 w-4 mr-2" /> Run Full System
            </Button>
            <div className="text-xs text-muted-foreground">or</div>
            <Button onClick={handleRun} disabled={isLoading} size="lg" variant="outline">
              {isLoading ? 'Loading…' : 'Run Verification Only'}
            </Button>
          </div>
        )}

        {/* Fix Everything progress / summary */}
        {(isFixing || (fixPhase === 'complete' && fixSummary)) && (
          <FixEverythingSummary phase={fixPhase as any} summary={fixSummary} />
        )}

        {hasRun && summary && mode === 'verify' && (
          <>
            <SectionHeader title="Dashboard" sectionKey="dashboard" expanded={expandedSections.dashboard} toggle={toggleSection} />
            {expandedSections.dashboard && <DashboardCards summary={summary} onBucketClick={setSelectedBucket} selectedBucket={selectedBucket} />}

            <SectionHeader title="Fix Plan" sectionKey="fixPlan" expanded={expandedSections.fixPlan} toggle={toggleSection} />
            {expandedSections.fixPlan && <FixPlanSection recommendations={summary.fixRecommendations} />}

            <SectionHeader title="Repeated Patterns" sectionKey="patterns" expanded={expandedSections.patterns} toggle={toggleSection} count={summary.repeatedPatterns.length} />
            {expandedSections.patterns && <PatternsSection patterns={summary.repeatedPatterns} />}

            {/* Controls + Table */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="inc" checked={includeComplete} onCheckedChange={setIncludeComplete} />
                <Label htmlFor="inc" className="text-sm">Include complete</Label>
              </div>
              {selectedBucket && (
                <Button variant="outline" size="sm" onClick={() => setSelectedBucket(null)}>
                  <Filter className="h-3 w-3 mr-1" /> Clear
                </Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">{filtered.length} resources</span>
            </div>
            <ResourceTable resources={filtered} onSelect={setDrawerResource} onFixResource={(r) => {
              // Navigate to resource library with manual assist context
              navigate(`/prep?manualAssist=${r.id}`);
            }} />
          </>
        )}

        {hasRun && summary && mode === 'remediate' && (
          <>
            {/* Remediation Mode */}
            <RemediationDashboard
              queueSummaries={queueSummaries}
              queues={remediationQueues}
              onRunAction={handleBulkAction}
              runningQueue={runningQueue}
              lastResult={lastBulkResult}
              onRunAutoFix={handleRunAutoFixQueue}
              onRunRetry={handleRunRetryQueue}
              onRunStateBugs={handleRunStateBugs}
              onFilterByQueue={(q) => { setMode('verify'); setSelectedBucket(q); }}
            />

            {/* Autonomous remediation results */}
            {remediationState && (
              <RemediationResultsPanel
                state={remediationState}
                filter={remediationFilter}
                onFilterChange={setRemediationFilter}
              />
            )}
          </>
        )}

        {/* E2E Validation Mode */}
        {mode === 'validate' && validationResult && (
          <ValidationResultsView result={validationResult} />
        )}

        {/* System Gaps Mode */}
        {mode === 'gaps' && hasRun && verified.length > 0 && (
          <SystemGapsView resources={verified} onSelect={setDrawerResource} />
        )}

        {/* Product Roadmap Mode */}
        {mode === 'roadmap' && hasRun && verified.length > 0 && (
          <ProductRoadmapView resources={verified} />
        )}
      </div>

      {drawerResource && <ResourceDrawer resource={drawerResource} onClose={() => setDrawerResource(null)} />}
    </div>
  );
}

// ── Banner Stat ───────────────────────────────────────────

function BannerStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <div className={`flex items-center gap-1 ${color}`}>{icon}<span className="text-lg font-bold">{value}</span></div>
      <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
    </div>
  );
}

function SectionHeader({ title, sectionKey, expanded, toggle, count }: {
  title: string; sectionKey: string; expanded: boolean; toggle: (k: string) => void; count?: number;
}) {
  return (
    <button onClick={() => toggle(sectionKey)} className="flex items-center gap-2 w-full text-left py-2">
      {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      <h2 className="text-base font-semibold">{title}</h2>
      {count !== undefined && <Badge variant="secondary" className="text-xs">{count}</Badge>}
    </button>
  );
}

// ── Dashboard Cards ───────────────────────────────────────

function DashboardCards({ summary, onBucketClick, selectedBucket }: {
  summary: VerificationSummary; onBucketClick: (b: string | null) => void; selectedBucket: string | null;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="In Scope" value={summary.totalInScope} />
        <StatCard label="Contradictions" value={summary.totalContradictions} variant={summary.totalContradictions > 0 ? 'danger' : 'success'} />
        <StatCard label="Quarantined" value={summary.byQuarantined} variant={summary.byQuarantined > 0 ? 'warning' : 'muted'} />
        <StatCard label="Manual Required" value={summary.byManualRequired} variant={summary.byManualRequired > 0 ? 'warning' : 'muted'} />
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Score Distribution</h3>
        <div className="grid grid-cols-5 gap-2">
          {Object.entries(summary.byScoreBand).map(([band, count]) => (
            <div key={band} className="rounded-lg border border-border p-3 text-center">
              <div className="text-lg font-bold">{count}</div>
              <div className="text-xs text-muted-foreground">{band}</div>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Fixability</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.byFixability).sort(([, a], [, b]) => b - a).map(([bucket, count]) => (
            <button key={bucket} onClick={() => onBucketClick(selectedBucket === bucket ? null : bucket)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-all ${selectedBucket === bucket ? 'ring-2 ring-primary' : ''} ${FIXABILITY_COLORS[bucket as keyof typeof FIXABILITY_COLORS] || 'bg-muted text-muted-foreground'}`}>
              {FIXABILITY_LABELS[bucket as keyof typeof FIXABILITY_LABELS] || bucket}
              <span className="font-bold">{count}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, variant = 'muted' }: { label: string; value: number; variant?: 'success' | 'danger' | 'warning' | 'muted' }) {
  const colors = { success: 'border-status-green/30 bg-status-green/5', danger: 'border-status-red/30 bg-status-red/5', warning: 'border-status-yellow/30 bg-status-yellow/5', muted: 'border-border bg-card' };
  return (
    <div className={`rounded-lg border p-3 ${colors[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function FixPlanSection({ recommendations }: { recommendations: VerificationSummary['fixRecommendations'] }) {
  if (!recommendations.length) return (
    <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-4 flex items-center gap-2">
      <CheckCircle2 className="h-5 w-5 text-status-green" /><span className="text-sm">No fix recommendations.</span>
    </div>
  );
  const sevColors: Record<string, string> = { critical: 'bg-status-red/20 text-status-red', high: 'bg-orange-500/20 text-orange-600', medium: 'bg-status-yellow/20 text-status-yellow', low: 'bg-muted text-muted-foreground' };
  return (
    <div className="space-y-3">
      {recommendations.map((rec, i) => (
        <div key={i} className="rounded-lg border border-border p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Badge className={sevColors[rec.severity] || ''}>{rec.severity}</Badge>
              <span className="font-medium text-sm">{rec.issueName}</span>
            </div>
            <Badge variant="outline">{rec.affectedCount} affected</Badge>
          </div>
          <p className="text-sm text-muted-foreground">{rec.whyItMatters}</p>
          <p className="text-sm font-medium text-foreground">→ {rec.fix}</p>
        </div>
      ))}
    </div>
  );
}

function PatternsSection({ patterns }: { patterns: Array<{ pattern: string; count: number }> }) {
  if (!patterns.length) return <p className="text-sm text-muted-foreground">No repeated patterns.</p>;
  return (
    <div className="space-y-1">
      {patterns.map((p, i) => (
        <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted/50">
          <span>{p.pattern}</span><Badge variant="secondary">{p.count}×</Badge>
        </div>
      ))}
    </div>
  );
}

// ── Remediation Dashboard ─────────────────────────────────

const QUEUE_ICONS: Record<RemediationQueue, React.ReactNode> = {
  auto_fix_now: <Zap className="h-4 w-4" />, retry_different_strategy: <RotateCcw className="h-4 w-4" />,
  needs_transcript: <FileText className="h-4 w-4" />, needs_pasted_content: <FileText className="h-4 w-4" />,
  needs_access_auth: <Lock className="h-4 w-4" />, needs_alternate_source: <ExternalLink className="h-4 w-4" />,
  accept_metadata_only: <CheckCircle2 className="h-4 w-4" />, needs_quarantine: <Ban className="h-4 w-4" />,
  bad_scoring_state_bug: <Bug className="h-4 w-4" />,
};

const QUEUE_COLORS: Record<RemediationQueue, string> = {
  auto_fix_now: 'border-status-green/40 bg-status-green/5', retry_different_strategy: 'border-status-yellow/40 bg-status-yellow/5',
  needs_transcript: 'border-primary/40 bg-primary/5', needs_pasted_content: 'border-primary/40 bg-primary/5',
  needs_access_auth: 'border-orange-500/40 bg-orange-500/5', needs_alternate_source: 'border-orange-500/40 bg-orange-500/5',
  accept_metadata_only: 'border-border bg-muted/30', needs_quarantine: 'border-status-red/40 bg-status-red/5',
  bad_scoring_state_bug: 'border-status-red/40 bg-status-red/5',
};

function RemediationDashboard({ queueSummaries, queues, onRunAction, runningQueue, lastResult, onRunAutoFix, onRunRetry, onRunStateBugs, onFilterByQueue }: {
  queueSummaries: Array<{ queue: RemediationQueue; count: number; canAutomate: boolean; action: string }>;
  queues: Record<RemediationQueue, VerifiedResource[]> | null;
  onRunAction: (q: RemediationQueue) => void;
  runningQueue: RemediationQueue | null;
  lastResult: BulkActionResult | null;
  onRunAutoFix: () => void;
  onRunRetry: () => void;
  onRunStateBugs: () => void;
  onFilterByQueue: (q: string) => void;
}) {
  if (!queues) return null;

  const autoFixCount = queues.auto_fix_now?.length || 0;
  const retryCount = queues.retry_different_strategy?.length || 0;
  const stateBugCount = queues.bad_scoring_state_bug?.length || 0;

  return (
    <div className="space-y-6">
      {/* Quick actions */}
      <div className="rounded-lg border border-border p-4 space-y-3">
        <h3 className="text-sm font-semibold flex items-center gap-2"><Zap className="h-4 w-4 text-primary" /> Quick Actions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Button variant="default" onClick={onRunAutoFix} disabled={autoFixCount === 0 || runningQueue !== null} className="justify-start gap-2">
            {runningQueue === 'auto_fix_now' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            Run Auto Fix ({autoFixCount})
          </Button>
          <Button variant="outline" onClick={onRunRetry} disabled={retryCount === 0 || runningQueue !== null} className="justify-start gap-2">
            {runningQueue === 'retry_different_strategy' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Retry All Retryable ({retryCount})
          </Button>
          <Button variant="outline" onClick={onRunStateBugs} disabled={stateBugCount === 0 || runningQueue !== null} className="justify-start gap-2">
            {runningQueue === 'bad_scoring_state_bug' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bug className="h-4 w-4" />}
            Resolve State Bugs ({stateBugCount})
          </Button>
        </div>
      </div>

      {lastResult && (
        <div className={`rounded-lg border p-3 text-sm ${lastResult.failed === 0 ? 'border-status-green/30 bg-status-green/5' : 'border-status-yellow/30 bg-status-yellow/5'}`}>
          <span className="font-medium">{QUEUE_LABELS[lastResult.queue]}:</span> {lastResult.succeeded} updated{lastResult.failed > 0 && `, ${lastResult.failed} failed`}
        </div>
      )}

      {/* All queues */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {queueSummaries.map(qs => {
          const resources = queues[qs.queue];
          const isRunning = runningQueue === qs.queue;
          const strategy = QUEUE_STRATEGIES[qs.queue];

          return (
            <div key={qs.queue} className={`rounded-lg border p-4 space-y-3 ${QUEUE_COLORS[qs.queue]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {QUEUE_ICONS[qs.queue]}
                  <div>
                    <div className="font-medium text-sm">{QUEUE_LABELS[qs.queue]}</div>
                    <div className="text-xs text-muted-foreground">{QUEUE_DESCRIPTIONS[qs.queue]}</div>
                  </div>
                </div>
                <Badge variant="secondary" className="font-bold shrink-0">{qs.count}</Badge>
              </div>

              <div className="text-xs border-t border-border/50 pt-2 space-y-1">
                <div><span className="font-medium text-foreground">Next action:</span> {strategy.action}</div>
                {strategy.requiresInput && (
                  <div className="text-orange-500 font-medium">⚠ Requires manual input ({strategy.inputType})</div>
                )}
              </div>

              <div className="flex items-center gap-2">
                {strategy.canAutomate ? (
                  <Button size="sm" variant={qs.queue === 'auto_fix_now' ? 'default' : 'outline'}
                    onClick={() => onRunAction(qs.queue)} disabled={isRunning || runningQueue !== null} className="flex-1">
                    {isRunning ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</> : <><Play className="h-3 w-3 mr-1" /> Process ({qs.count})</>}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => onRunAction(qs.queue)} disabled={isRunning || runningQueue !== null} className="flex-1">
                    {isRunning ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Routing…</> : <><ArrowRight className="h-3 w-3 mr-1" /> Route ({qs.count})</>}
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => onFilterByQueue(qs.queue)}><Search className="h-3 w-3" /></Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Remediation Results Panel ─────────────────────────────

const STATUS_LABELS: Record<RemediationItemStatus, string> = {
  queued: 'Queued', processing: 'Processing…', enriching: 'Enriching…', re_verifying: 'Re-verifying…',
  resolved_complete: '✓ Complete', resolved_metadata_only: '✓ Metadata', resolved_quarantined: '⊘ Quarantined',
  awaiting_manual: '⏳ Manual', escalated: '⬆ Escalated',
};
const STATUS_COLORS: Record<RemediationItemStatus, string> = {
  queued: 'text-muted-foreground', processing: 'text-primary', enriching: 'text-primary', re_verifying: 'text-primary',
  resolved_complete: 'text-status-green', resolved_metadata_only: 'text-muted-foreground',
  resolved_quarantined: 'text-status-red', awaiting_manual: 'text-status-yellow', escalated: 'text-orange-500',
};

function RemediationResultsPanel({ state, filter, onFilterChange }: {
  state: RemediationCycleState; filter: string; onFilterChange: (f: string) => void;
}) {
  const progress = state.totalItems > 0 ? Math.round((state.processedCount / state.totalItems) * 100) : 0;
  const isRunning = state.status === 'running';
  const isComplete = state.status === 'completed';

  const resolved = state.items.filter(i => i.isResolved);
  const unresolved = state.items.filter(i => !i.isResolved && !['queued'].includes(i.status));
  const improved = state.items.filter(i => i.afterScore !== null && i.afterScore > i.beforeScore);
  const manual = state.items.filter(i => i.status === 'awaiting_manual');
  const escalated = state.items.filter(i => i.status === 'escalated');

  const filteredItems = filter === 'all' ? state.items :
    filter === 'resolved' ? resolved :
    filter === 'unresolved' ? unresolved :
    filter === 'improved' ? improved :
    filter === 'manual' ? manual :
    filter === 'escalated' ? escalated :
    state.items;

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Wrench className="h-4 w-4 text-primary" />}
          <h3 className="font-semibold text-sm">Autonomous Remediation — {isComplete ? 'Results' : isRunning ? 'Processing' : state.status}</h3>
        </div>
        <span className="text-sm font-mono text-muted-foreground">{state.processedCount}/{state.totalItems}</span>
      </div>

      {/* Progress */}
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        {[
          { v: state.resolvedCompleteCount, l: 'Complete', c: 'text-status-green' },
          { v: state.resolvedMetadataCount, l: 'Metadata', c: 'text-muted-foreground' },
          { v: state.resolvedQuarantinedCount, l: 'Quarantined', c: 'text-status-red' },
          { v: state.awaitingManualCount, l: 'Manual', c: 'text-status-yellow' },
          { v: state.escalatedCount, l: 'Escalated', c: 'text-orange-500' },
          { v: state.scoreImprovements, l: 'Score ↑', c: 'text-primary' },
        ].map(s => (
          <div key={s.l} className="rounded-lg border border-border p-2">
            <div className={`text-lg font-bold ${s.c}`}>{s.v}</div>
            <div className="text-[10px] text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>

      {/* Proof of impact */}
      {isComplete && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Proof of Impact</h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><span className="text-muted-foreground">Resolved:</span> <span className={`ml-1 font-bold ${resolved.length > 0 ? 'text-status-green' : 'text-muted-foreground'}`}>{resolved.length}</span></div>
            <div><span className="text-muted-foreground">Still Broken:</span> <span className={`ml-1 font-bold ${unresolved.length > 0 ? 'text-status-red' : 'text-status-green'}`}>{unresolved.length}</span></div>
            <div><span className="text-muted-foreground">Score Improved:</span> <span className="ml-1 font-bold text-primary">{improved.length}</span></div>
            <div><span className="text-muted-foreground">State Changed:</span> <span className="ml-1 font-bold text-primary">{state.stateChanges}</span></div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-1 flex-wrap">
        {[
          { key: 'all', label: `All (${state.items.length})` },
          { key: 'resolved', label: `Resolved (${resolved.length})` },
          { key: 'unresolved', label: `Unresolved (${unresolved.length})` },
          { key: 'improved', label: `Score ↑ (${improved.length})` },
          { key: 'manual', label: `Manual (${manual.length})` },
          { key: 'escalated', label: `Escalated (${escalated.length})` },
        ].map(tab => (
          <button key={tab.key} onClick={() => onFilterChange(tab.key)}
            className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${filter === tab.key ? 'bg-primary text-primary-foreground border-primary' : 'bg-card text-muted-foreground border-border hover:bg-muted'}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results table */}
      <ScrollArea className="max-h-[500px] rounded-lg border border-border">
        <div className="min-w-[700px]">
          <div className="grid grid-cols-[1fr_60px_60px_80px_80px_120px_70px] gap-1 px-3 py-2 border-b border-border bg-muted/30 text-[10px] font-medium text-muted-foreground sticky top-0 z-10">
            <span>Resource</span>
            <span className="text-center">Before</span>
            <span className="text-center">After</span>
            <span>Old State</span>
            <span>New State</span>
            <span>What To Do</span>
            <span className="text-right">Status</span>
          </div>
          {filteredItems.map(item => {
            const scoreDelta = item.afterScore !== null ? item.afterScore - item.beforeScore : null;
            return (
              <div key={item.id} className={`grid grid-cols-[1fr_60px_60px_80px_80px_120px_70px] gap-1 px-3 py-2 border-b border-border items-center text-sm ${item.id === state.currentItemId ? 'bg-primary/10' : ''}`}>
                {/* Title */}
                <div className="min-w-0">
                  <div className="font-medium truncate text-xs">{item.title}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {item.strategyUsed || QUEUE_LABELS[item.queue]}
                    {item.whyFailed && <span className="ml-1 text-status-red">— {item.whyFailed}</span>}
                  </div>
                </div>

                {/* Score Before */}
                <div className={`text-center font-mono text-xs ${item.beforeScore >= 70 ? 'text-status-green' : item.beforeScore >= 40 ? 'text-status-yellow' : 'text-status-red'}`}>
                  {item.beforeScore}
                </div>

                {/* Score After */}
                <div className="text-center font-mono text-xs">
                  {item.afterScore !== null ? (
                    <span className={item.afterScore >= 70 ? 'text-status-green' : item.afterScore >= 40 ? 'text-status-yellow' : 'text-status-red'}>
                      {item.afterScore}
                      {scoreDelta !== null && scoreDelta !== 0 && (
                        <span className={`ml-0.5 text-[10px] ${scoreDelta > 0 ? 'text-status-green' : 'text-status-red'}`}>
                          {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta}
                        </span>
                      )}
                    </span>
                  ) : <span className="text-muted-foreground">—</span>}
                </div>

                {/* Old State */}
                <div className="text-[10px]"><Badge variant="outline" className="text-[9px] px-1">{item.beforeState}</Badge></div>

                {/* New State */}
                <div className="text-[10px]">
                  {item.afterState ? (
                    <Badge variant="outline" className={`text-[9px] px-1 ${item.afterState !== item.beforeState ? 'border-primary text-primary' : ''}`}>
                      {item.afterState}{item.afterState !== item.beforeState && ' ⚡'}
                    </Badge>
                  ) : <span className="text-muted-foreground">—</span>}
                </div>

                {/* What to do next */}
                <div className="text-[10px] text-muted-foreground truncate" title={item.whatToDoNext || item.terminalReason || ''}>
                  {item.whatToDoNext || item.terminalReason || '—'}
                </div>

                {/* Status */}
                <div className="text-right">
                  {item.isResolved ? (
                    <span className="inline-flex items-center gap-0.5 text-status-green text-xs font-medium">
                      <CheckCircle2 className="h-3 w-3" /> Done
                    </span>
                  ) : ['queued', 'processing', 'enriching', 're_verifying'].includes(item.status) ? (
                    <Loader2 className="h-3 w-3 animate-spin text-primary inline" />
                  ) : (
                    <span className={`text-xs font-medium ${STATUS_COLORS[item.status]}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

// ── Bucket action labels ──────────────────────────────────
const BUCKET_ACTION_LABELS: Record<string, { label: string; icon: React.ReactNode }> = {
  needs_transcript: { label: 'Paste Transcript', icon: <FileText className="h-3 w-3" /> },
  needs_pasted_content: { label: 'Paste Content', icon: <FileText className="h-3 w-3" /> },
  needs_access_auth: { label: 'Provide Access', icon: <Lock className="h-3 w-3" /> },
  needs_alternate_source: { label: 'Provide Better URL', icon: <ExternalLink className="h-3 w-3" /> },
  accept_metadata_only: { label: 'Accept or Improve', icon: <CheckCircle2 className="h-3 w-3" /> },
  auto_fix_now: { label: 'Auto Fix', icon: <Zap className="h-3 w-3" /> },
  retry_different_strategy: { label: 'Retry', icon: <RotateCcw className="h-3 w-3" /> },
  bad_scoring_state_bug: { label: 'Reconcile', icon: <Bug className="h-3 w-3" /> },
  needs_quarantine: { label: 'Quarantined', icon: <Ban className="h-3 w-3" /> },
};

function ResourceTable({ resources, onSelect, onFixResource }: {
  resources: VerifiedResource[];
  onSelect: (r: VerifiedResource) => void;
  onFixResource?: (r: VerifiedResource) => void;
}) {
  if (!resources.length) return <p className="text-sm text-muted-foreground text-center py-8">No resources match filters.</p>;
  return (
    <ScrollArea className="rounded-lg border border-border">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[1fr_100px_60px_120px_100px_30px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground sticky top-0">
          <span>Title</span><span>Status</span><span>Score</span><span>Fixability</span><span>Next Action</span><span></span>
        </div>
        {resources.map(v => {
          const action = BUCKET_ACTION_LABELS[v.fixabilityBucket];
          return (
            <div key={v.id} className="grid grid-cols-[1fr_100px_60px_120px_100px_30px] gap-2 px-4 py-2.5 border-b border-border hover:bg-muted/30 items-center">
              <button onClick={() => onSelect(v)} className="min-w-0 text-left">
                <div className="text-sm font-medium truncate">{v.title}</div>
                <div className="text-xs text-muted-foreground truncate">{v.subtypeLabel}</div>
              </button>
              <div><Badge variant="outline" className="text-xs whitespace-nowrap">{v.enrichmentStatusLabel}</Badge></div>
              <div className={`text-sm font-mono font-bold ${v.qualityScore >= 70 ? 'text-status-green' : v.qualityScore >= 40 ? 'text-status-yellow' : 'text-status-red'}`}>{v.qualityScore}</div>
              <div><span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FIXABILITY_COLORS[v.fixabilityBucket]}`}>{FIXABILITY_LABELS[v.fixabilityBucket]}</span></div>
              <div>
                {v.fixabilityBucket !== 'truly_complete' && action && onFixResource ? (
                  <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1 px-2"
                    onClick={(e) => { e.stopPropagation(); onFixResource(v); }}>
                    {action.icon} {action.label}
                  </Button>
                ) : v.fixabilityBucket === 'truly_complete' ? (
                  <span className="text-xs text-status-green font-medium">✓ Complete</span>
                ) : null}
              </div>
              <div className="flex items-center">{v.contradictions.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-status-red" />}</div>
            </div>
          );
        })}
      </div>
    </ScrollArea>
  );
}

// ── Resource Drawer ───────────────────────────────────────

function ResourceDrawer({ resource: v, onClose, onFix }: { resource: VerifiedResource; onClose: () => void; onFix?: (r: VerifiedResource) => void }) {
  const copyId = () => { navigator.clipboard.writeText(v.id); toast.success('Copied ID'); };
  const action = BUCKET_ACTION_LABELS[v.fixabilityBucket];
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-card border-l border-border h-full overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 bg-card z-10 px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="font-semibold text-sm truncate">{v.title}</h3>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        <div className="p-4 space-y-6">
          <Section title="Identity">
            <Field label="ID" value={v.id} copyable onCopy={copyId} />
            <Field label="URL" value={v.url || 'None'} link={v.url ?? undefined} />
            <Field label="Subtype" value={v.subtypeLabel} />
          </Section>

          <Section title="Quality">
            <Field label="Score" value={`${v.qualityScore}/100`} />
            <Field label="Tier" value={v.qualityTier} />
            <Field label="Content Length" value={`${v.contentLength.toLocaleString()} chars`} />
          </Section>

          <Section title="Status">
            <Field label="Enrichment Status" value={v.enrichmentStatusLabel} />
            <Field label="Failure Bucket" value={v.failureBucket || 'None'} />
            <Field label="Failure Reason" value={v.failureReason || 'None'} />
            <Field label="Retry Eligible" value={v.retryEligible ? 'Yes' : 'No'} />
            <Field label="Failure Count" value={String(v.failureCount)} />
          </Section>

          <Section title="Diagnosis">
            <Field label="Fixability" value={FIXABILITY_LABELS[v.fixabilityBucket]} />
            <Field label="Root Cause" value={v.rootCauseCategory} />
            <Field label="Why Not Complete" value={v.whyNotComplete} />
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <div className="text-xs font-semibold text-primary mb-1">Next Action</div>
              <div className="text-sm font-medium">{v.recommendedAction}</div>
            </div>
          </Section>

          {/* Why This Failed */}
          {v.fixabilityBucket !== 'truly_complete' && (
            <Section title="Why This Failed">
              <Field label="Root Cause" value={v.rootCause || v.rootCauseCategory} />
              <Field label="Failure Type" value={v.resolutionType === 'system_gap' ? 'System Gap' : v.failureBucket || 'None'} />
              <Field label="Resolution Type" value={
                v.resolutionType === 'auto_fix' ? '⚡ Auto Fix' :
                v.resolutionType === 'manual_input' ? '✋ Manual Input' :
                v.resolutionType === 'system_gap' ? '🔧 System Gap' : v.resolutionType
              } />
              <Field label="Recommended Action" value={v.recommendedAction} />
            </Section>
          )}

          {/* What Needs To Happen */}
          {v.fixabilityBucket !== 'truly_complete' && (
            <>
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">What Needs To Happen</h4>
                {v.resolutionType === 'auto_fix' && (
                  <div className="rounded-lg border border-status-green/30 bg-status-green/10 p-3">
                    <div className="text-xs font-semibold text-status-green mb-1">⚡ Automatic Resolution</div>
                    <div className="text-sm font-medium">This will be fixed automatically. {v.recommendedAction}</div>
                  </div>
                )}
                {v.resolutionType === 'manual_input' && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="text-xs font-semibold text-primary mb-1">✋ Manual Input Required</div>
                    <div className="text-sm font-medium">{v.recommendedAction}</div>
                  </div>
                )}
                {v.resolutionType === 'system_gap' && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                    <div className="text-xs font-bold text-destructive uppercase tracking-wide">⚠ System Limitation Detected</div>
                    <div className="text-sm font-medium text-destructive">{v.rootCause}</div>
                    {v.requiredBuild && (
                      <div className="mt-2 space-y-1 border-t border-destructive/20 pt-2">
                        <div className="text-xs font-semibold text-destructive/80">Required Build:</div>
                        <Field label="Type" value={v.requiredBuild.type} />
                        <Field label="Description" value={v.requiredBuild.description} />
                        <div className="text-xs text-muted-foreground mt-1">
                          <span className="font-semibold">Suggested Fix: </span>
                          {v.requiredBuild.suggestedImplementation}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {action && onFix && v.fixabilityBucket !== 'needs_quarantine' && (
                <Button className="w-full" onClick={() => onFix(v)}>
                  {action.icon} <span className="ml-2">{action.label}</span>
                </Button>
              )}
            </>
          )}

          {v.contradictions.length > 0 && (
            <Section title={`Contradictions (${v.contradictions.length})`}>
              {v.contradictions.map((c, i) => (
                <div key={i} className="rounded border border-status-red/30 bg-status-red/5 p-2 text-sm">
                  <Badge className="text-[10px] mb-1" variant="outline">{c.severity}</Badge>
                  <div>{c.description}</div>
                </div>
              ))}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, value, copyable, onCopy, link }: {
  label: string; value: string; copyable?: boolean; onCopy?: () => void; link?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-sm font-medium text-right truncate">{value}</span>
        {copyable && <button onClick={onCopy}><Copy className="h-3 w-3 text-muted-foreground" /></button>}
        {link && <a href={link} target="_blank" rel="noopener"><ExternalLink className="h-3 w-3 text-muted-foreground" /></a>}
      </div>
    </div>
  );
}

// ── Fix Everything Summary ────────────────────────────────

function FixEverythingSummary({ phase, summary }: {
  phase: 'verifying' | 'remediating' | 'analyzing' | 'complete' | 'error';
  summary: {
    fixedAuto: number; needsInput: number; systemGaps: number;
    totalScanned: number; remediationSummary: RemediationSummary | null;
    remediationState: RemediationCycleState | null;
    gapDetails: Array<{ failureType: string; count: number; description: string }>;
    manualGroups: Array<{ bucket: string; count: number; action: string }>;
  } | null;
}) {
  if (phase !== 'complete' || !summary) {
    const phaseLabels = { verifying: 'Verifying all resources…', remediating: 'Running auto-remediation…', analyzing: 'Analyzing remaining gaps…', error: 'Error occurred', complete: '' };
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-6 text-center space-y-3">
        <Loader2 className="h-8 w-8 text-primary mx-auto animate-spin" />
        <div className="font-semibold text-primary">{phaseLabels[phase]}</div>
        <div className="text-sm text-muted-foreground">This may take a few minutes. Do not navigate away.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-status-green/30 bg-status-green/10 p-4 text-center">
          <div className="text-3xl font-bold text-status-green">{summary.fixedAuto}</div>
          <div className="text-sm font-medium text-status-green mt-1">Fixed Automatically</div>
          <div className="text-xs text-muted-foreground mt-0.5">No action needed</div>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-4 text-center">
          <div className="text-3xl font-bold text-primary">{summary.needsInput}</div>
          <div className="text-sm font-medium text-primary mt-1">Needs Your Input</div>
          <div className="text-xs text-muted-foreground mt-0.5">Manual content or access required</div>
        </div>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center">
          <div className="text-3xl font-bold text-destructive">{summary.systemGaps}</div>
          <div className="text-sm font-medium text-destructive mt-1">Requires System Build</div>
          <div className="text-xs text-muted-foreground mt-0.5">Code changes needed</div>
        </div>
      </div>

      <div className="text-sm text-muted-foreground text-center">
        Scanned <span className="font-semibold text-foreground">{summary.totalScanned}</span> resources total
      </div>

      {/* Manual input groups */}
      {summary.manualGroups.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" /> Resources Needing Your Input
          </h4>
          <div className="space-y-2">
            {summary.manualGroups.map(g => (
              <div key={g.bucket} className="flex items-center justify-between py-2 px-3 rounded bg-muted/30">
                <div>
                  <div className="text-sm font-medium">{QUEUE_LABELS[g.bucket as RemediationQueue] || g.bucket}</div>
                  <div className="text-xs text-muted-foreground">{g.action}</div>
                </div>
                <Badge variant="secondary" className="font-bold">{g.count}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* System gaps */}
      {summary.gapDetails.length > 0 && (
        <div className="rounded-lg border border-destructive/30 bg-card p-4 space-y-3">
          <h4 className="text-sm font-semibold flex items-center gap-2 text-destructive">
            <ShieldAlert className="h-4 w-4" /> System Gaps Requiring Code Changes
          </h4>
          <div className="space-y-2">
            {summary.gapDetails.map((g, i) => (
              <div key={i} className="rounded border border-destructive/20 bg-destructive/5 p-3">
                <div className="flex items-center justify-between mb-1">
                  <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">{g.failureType}</Badge>
                  <span className="text-sm font-bold text-destructive">{g.count} resources</span>
                </div>
                <div className="text-sm">{g.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All clear */}
      {summary.needsInput === 0 && summary.systemGaps === 0 && (
        <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-status-green mx-auto mb-2" />
          <div className="font-semibold text-status-green">All Resources Resolved</div>
        </div>
      )}
    </div>
  );
}

// ── System Gaps View ──────────────────────────────────────

interface GapGroup {
  key: string;
  failureType: string;
  subtype: string;
  subtypeLabel: string;
  summary: string;
  count: number;
  requiredBuild: { type: string; description: string; suggestedImplementation: string } | null;
  resourceIds: string[];
  resources: VerifiedResource[];
}

function SystemGapsView({ resources, onSelect }: { resources: VerifiedResource[]; onSelect: (v: VerifiedResource) => void }) {
  const gaps = useMemo(() => {
    const gapResources = resources.filter(r => r.resolutionType === 'system_gap');
    const groupMap = new Map<string, GapGroup>();

    for (const r of gapResources) {
      const failureType = r.requiredBuild?.type || 'unknown';
      const key = `${failureType}::${r.subtype}`;
      const existing = groupMap.get(key);
      if (existing) {
        existing.count++;
        existing.resourceIds.push(r.id);
        existing.resources.push(r);
      } else {
        groupMap.set(key, {
          key,
          failureType,
          subtype: r.subtype,
          subtypeLabel: r.subtypeLabel,
          summary: r.rootCause || r.rootCauseCategory,
          count: 1,
          requiredBuild: r.requiredBuild,
          resourceIds: [r.id],
          resources: [r],
        });
      }
    }

    return Array.from(groupMap.values()).sort((a, b) => b.count - a.count);
  }, [resources]);

  const totalGapResources = gaps.reduce((s, g) => s + g.count, 0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  if (gaps.length === 0) {
    return (
      <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-status-green mx-auto mb-2" />
        <div className="font-semibold text-status-green">No System Gaps Detected</div>
        <div className="text-sm text-muted-foreground mt-1">All failures are either auto-fixable or require manual input — no missing platform support.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header banner */}
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          <span className="font-bold text-destructive">System Gaps Detected</span>
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{gaps.length}</span> distinct system gaps affecting{' '}
          <span className="font-semibold text-foreground">{totalGapResources}</span> resources.
          These require code changes — they cannot be resolved by retrying or manual input alone.
        </div>
      </div>

      {/* Gap cards */}
      {gaps.map(g => {
        const isExpanded = expandedKey === g.key;
        return (
          <div key={g.key} className="rounded-lg border border-destructive/30 bg-card overflow-hidden">
            <button
              onClick={() => setExpandedKey(isExpanded ? null : g.key)}
              className="w-full px-4 py-3 flex items-start gap-3 text-left hover:bg-muted/30 transition-colors"
            >
              <div className="mt-0.5">
                {isExpanded ? <ChevronDown className="h-4 w-4 text-destructive" /> : <ChevronRight className="h-4 w-4 text-destructive" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{g.summary}</div>
                <div className="flex flex-wrap gap-2 mt-1">
                  <Badge variant="outline" className="text-[10px] border-destructive/30 text-destructive">{g.subtypeLabel}</Badge>
                  <Badge variant="outline" className="text-[10px]">{g.failureType}</Badge>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold text-destructive">{g.count}</div>
                <div className="text-[10px] text-muted-foreground">resources</div>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-border px-4 py-3 space-y-3">
                {g.requiredBuild && (
                  <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3 space-y-2">
                    <div className="text-xs font-bold text-destructive uppercase tracking-wide">Required Build</div>
                    <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                      <span className="text-muted-foreground">Type:</span>
                      <span className="font-medium">{g.requiredBuild.type}</span>
                      <span className="text-muted-foreground">Description:</span>
                      <span className="font-medium">{g.requiredBuild.description}</span>
                      <span className="text-muted-foreground">Suggested Fix:</span>
                      <span>{g.requiredBuild.suggestedImplementation}</span>
                    </div>
                  </div>
                )}

                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Affected Resources</div>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {g.resources.map(r => (
                    <button
                      key={r.id}
                      onClick={() => onSelect(r)}
                      className="w-full text-left px-2 py-1.5 rounded hover:bg-muted/50 transition-colors flex items-center gap-2 text-sm"
                    >
                      <span className="truncate flex-1">{r.title}</span>
                      <span className="text-xs text-muted-foreground shrink-0">{r.qualityScore}/100</span>
                      <ExternalLink className="h-3 w-3 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>

                <Button size="sm" variant="destructive" className="w-full" onClick={() => toast.info(`System gap "${g.failureType}" flagged for engineering`)}>
                  <Bug className="h-3 w-3 mr-1" /> Fix this system gap
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── E2E Validation Results View ───────────────────────────

const PHASE_LABELS: Record<ValidationPhase, string> = {
  idle: 'Ready',
  initial_verify: 'Running initial verification…',
  remediating: 'Running autonomous remediation…',
  post_verify: 'Re-verifying after remediation…',
  complete: 'Validation Complete',
  error: 'Validation Error',
};

function ValidationResultsView({ result }: { result: ValidationResult }) {
  const isComplete = result.phase === 'complete';
  const isRunning = !['complete', 'error', 'idle'].includes(result.phase);
  const progress = result.phase === 'initial_verify' ? 20 :
    result.phase === 'remediating' ? 40 + (result.remediationState ?
      Math.round((result.remediationState.processedCount / Math.max(result.remediationState.totalItems, 1)) * 40) : 0) :
    result.phase === 'post_verify' ? 90 : result.phase === 'complete' ? 100 : 0;

  return (
    <div className="space-y-6">
      {/* System Proven Banner */}
      {isComplete && (
        <div className={`rounded-xl border-2 p-6 text-center space-y-3 ${
          result.systemProven
            ? 'border-status-green bg-status-green/10'
            : 'border-status-red bg-status-red/10'
        }`}>
          <div className="flex items-center justify-center gap-3">
            {result.systemProven
              ? <CheckCircle2 className="h-8 w-8 text-status-green" />
              : <ShieldAlert className="h-8 w-8 text-status-red" />}
            <h2 className="text-2xl font-bold">
              {result.systemProven ? 'System Proven ✓' : 'System Not Yet Proven'}
            </h2>
          </div>
          {!result.systemProven && result.blockers.length > 0 && (
            <div className="space-y-1 text-sm text-status-red">
              <p className="font-semibold">Blockers:</p>
              {result.blockers.map((b, i) => <p key={i}>• {b}</p>)}
            </div>
          )}
          {result.systemProven && (
            <p className="text-sm text-status-green font-medium">
              Non-complete resources decreased from {result.preBrokenCount} → {result.postBrokenCount}. 
              {result.totalAutoResolved} auto-resolved. Average score {result.netScoreChange >= 0 ? '+' : ''}{result.netScoreChange}.
            </p>
          )}
        </div>
      )}

      {/* Progress */}
      {isRunning && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <span className="font-semibold text-sm">{PHASE_LABELS[result.phase]}</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          {result.remediationState && result.phase === 'remediating' && (
            <p className="text-xs text-muted-foreground">
              {result.remediationState.processedCount}/{result.remediationState.totalItems} resources processed
            </p>
          )}
        </div>
      )}

      {/* Final Summary */}
      {isComplete && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-4">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" /> Final Results Summary
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <SummaryCard label="Total Scanned" value={result.totalScanned} />
            <SummaryCard label="Below 100 at Start" value={result.totalBelowHundredAtStart} variant={result.totalBelowHundredAtStart > 0 ? 'danger' : 'success'} />
            <SummaryCard label="Auto-Resolved" value={result.totalAutoResolved} variant={result.totalAutoResolved > 0 ? 'success' : 'muted'} />
            <SummaryCard label="Improved (Not Resolved)" value={result.totalImprovedNotResolved} variant={result.totalImprovedNotResolved > 0 ? 'warning' : 'muted'} />
            <SummaryCard label="Needs Manual Input" value={result.totalNeedsManualInput} variant={result.totalNeedsManualInput > 0 ? 'warning' : 'muted'} />
            <SummaryCard label="Quarantined" value={result.totalQuarantined} variant={result.totalQuarantined > 0 ? 'danger' : 'muted'} />
            <SummaryCard label="Net Score Change" value={`${result.netScoreChange >= 0 ? '+' : ''}${result.netScoreChange}`} variant={result.netScoreChange > 0 ? 'success' : result.netScoreChange < 0 ? 'danger' : 'muted'} />
            <SummaryCard label="Still Not at 100" value={result.totalRemainingNotHundred} variant={result.totalRemainingNotHundred > 0 ? 'danger' : 'success'} />
          </div>
        </div>
      )}

      {/* Queue Effectiveness */}
      {isComplete && result.queueEffectiveness.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm">Queue Effectiveness</h3>
          <div className="space-y-2">
            {result.queueEffectiveness.map(q => (
              <div key={q.queue} className="flex items-center gap-3 text-sm py-1.5 border-b border-border last:border-0">
                <span className="font-medium min-w-[160px]">{QUEUE_LABELS[q.queue as RemediationQueue] || q.queue}</span>
                <span className="text-muted-foreground">{q.inputCount} in</span>
                <span className="text-status-green font-medium">{q.resolvedCount} resolved</span>
                <span className="text-primary">{q.improvedCount} improved</span>
                <span className="text-muted-foreground">{q.unchangedCount} unchanged</span>
                <span className="ml-auto font-mono text-xs">
                  <span className={q.effectivenessRate > 50 ? 'text-status-green' : q.effectivenessRate > 0 ? 'text-status-yellow' : 'text-status-red'}>
                    {q.effectivenessRate}%
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Repeated Failure Patterns */}
      {isComplete && result.repeatedFailurePatterns.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="font-semibold text-sm">Top Repeated Remaining Failure Patterns</h3>
          <div className="space-y-1">
            {result.repeatedFailurePatterns.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted/50">
                <span>{p.pattern}</span>
                <Badge variant="secondary">{p.count}×</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Remaining Work */}
      {isComplete && result.remainingWork.length > 0 && (
        <div className="space-y-4">
          <h3 className="font-semibold text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-status-yellow" />
            Remaining Work ({result.totalRemainingNotHundred} resources)
          </h3>
          {result.remainingWork.map(group => (
            <div key={group.bucket} className="rounded-lg border border-border overflow-hidden">
              <div className="bg-muted/30 px-4 py-2.5 border-b border-border flex items-center justify-between">
                <span className="font-medium text-sm">{group.label}</span>
                <Badge variant="secondary">{group.resources.length}</Badge>
              </div>
              <ScrollArea className="max-h-[300px]">
                <div className="min-w-[700px]">
                  <div className="grid grid-cols-[1fr_100px_50px_100px_1fr_1fr] gap-2 px-4 py-1.5 border-b border-border bg-muted/20 text-[10px] font-medium text-muted-foreground">
                    <span>Title</span><span>Subtype</span><span>Score</span><span>Status</span><span>Reason</span><span>Next Action</span>
                  </div>
                  {group.resources.map(r => (
                    <div key={r.id} className="grid grid-cols-[1fr_100px_50px_100px_1fr_1fr] gap-2 px-4 py-2 border-b border-border items-center text-xs">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{r.title}</div>
                        {r.url && <a href={r.url} target="_blank" rel="noopener" className="text-primary truncate block text-[10px]">{r.url}</a>}
                      </div>
                      <span className="text-muted-foreground truncate">{r.subtypeLabel}</span>
                      <span className={`font-mono font-bold ${r.score >= 70 ? 'text-status-green' : r.score >= 40 ? 'text-status-yellow' : 'text-status-red'}`}>{r.score}</span>
                      <Badge variant="outline" className="text-[9px] px-1">{r.status}</Badge>
                      <span className="text-muted-foreground truncate" title={r.reasonNotComplete}>{r.reasonNotComplete}</span>
                      <span className="text-primary font-medium truncate" title={r.nextAction}>{r.nextAction}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          ))}
        </div>
      )}

      {/* Action Log */}
      {isComplete && result.actionLog.length > 0 && (
        <details className="rounded-lg border border-border overflow-hidden">
          <summary className="px-4 py-3 bg-muted/30 font-semibold text-sm cursor-pointer hover:bg-muted/50">
            Remediation Action Log ({result.actionLog.length} actions)
          </summary>
          <ScrollArea className="max-h-[400px]">
            <div className="min-w-[600px]">
              {result.actionLog.map((log, i) => (
                <div key={i} className="grid grid-cols-[1fr_80px_50px_50px_1fr] gap-2 px-4 py-1.5 border-b border-border text-xs items-center">
                  <span className="truncate font-medium">{log.title}</span>
                  <span className="text-muted-foreground">{QUEUE_LABELS[log.queue as RemediationQueue] || log.queue}</span>
                  <span className="font-mono text-status-red">{log.beforeScore}</span>
                  <span className={`font-mono ${log.afterScore !== null && log.afterScore > log.beforeScore ? 'text-status-green' : 'text-muted-foreground'}`}>
                    {log.afterScore ?? '—'}
                  </span>
                  <span className="text-muted-foreground truncate">{log.outcome}</span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </details>
      )}

      {/* Error */}
      {result.error && (
        <div className="rounded-lg border border-status-red/30 bg-status-red/5 p-4 text-sm text-status-red">
          <strong>Error:</strong> {result.error}
        </div>
      )}
    </div>
  );
}

// ── Product Roadmap View ──────────────────────────────────

function ProductRoadmapView({ resources }: { resources: VerifiedResource[] }) {
  const roadmap = useMemo(() => generateProductRoadmap(resources), [resources]);
  const [buildModal, setBuildModal] = useState<RoadmapIssue | null>(null);
  const [copied, setCopied] = useState(false);

  const severityColors: Record<IssueSeverity, string> = {
    critical: 'border-destructive/50 bg-destructive/10 text-destructive',
    high: 'border-orange-500/50 bg-orange-500/10 text-orange-600 dark:text-orange-400',
    medium: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    low: 'border-muted-foreground/30 bg-muted/30 text-muted-foreground',
  };

  const severityBadgeColors: Record<IssueSeverity, string> = {
    critical: 'bg-destructive text-destructive-foreground',
    high: 'bg-orange-500 text-white',
    medium: 'bg-yellow-500 text-white',
    low: 'bg-muted text-muted-foreground',
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('Build prompt copied to clipboard');
    setTimeout(() => setCopied(false), 2000);
  };

  if (roadmap.issues.length === 0) {
    return (
      <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-status-green mx-auto mb-2" />
        <div className="font-semibold text-status-green">No System Gaps — No Roadmap Needed</div>
        <div className="text-sm text-muted-foreground mt-1">All failures are either auto-fixable or require manual input.</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Header */}
      <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 p-5">
        <h2 className="text-lg font-bold flex items-center gap-2 mb-3">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          Product Roadmap (Derived from Real Failures)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{roadmap.totalSystemGaps}</div>
            <div className="text-xs text-muted-foreground">Total System Gaps</div>
          </div>
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
            <div className="text-2xl font-bold text-destructive">{roadmap.criticalIssues}</div>
            <div className="text-xs text-muted-foreground">Critical Issues</div>
          </div>
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-center">
            <div className="text-2xl font-bold text-orange-600 dark:text-orange-400">{roadmap.highIssues}</div>
            <div className="text-xs text-muted-foreground">High Priority</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-3 text-center">
            <div className="text-2xl font-bold text-foreground">{roadmap.pctFailuresCausedBySystem}%</div>
            <div className="text-xs text-muted-foreground">Failures from System Gaps</div>
          </div>
        </div>
      </div>

      {/* Issue Cards */}
      {roadmap.issues.map((issue, idx) => (
        <div key={issue.groupKey} className={`rounded-lg border-2 overflow-hidden ${severityColors[issue.severity]}`}>
          <div className="p-4 space-y-3">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${severityBadgeColors[issue.severity]}`}>
                    {issue.severity}
                  </span>
                  <Badge variant="outline" className="text-[10px]">{issue.requiredBuild.type}</Badge>
                  <Badge variant="outline" className="text-[10px]">{issue.subtypeLabel}</Badge>
                </div>
                <h3 className="font-semibold text-sm text-foreground">{issue.issueName}</h3>
              </div>
              <div className="text-right shrink-0">
                <div className="text-lg font-bold">{issue.affectedResources}</div>
                <div className="text-[10px] text-muted-foreground">resources</div>
              </div>
            </div>

            {/* Root Cause */}
            <div className="text-sm">
              <span className="text-muted-foreground font-medium">Root Cause: </span>
              <span className="text-foreground">{issue.rootCauseSummary}</span>
            </div>

            {/* Business Impact */}
            <div className="text-sm">
              <span className="text-muted-foreground font-medium">Impact: </span>
              <span className="text-foreground">{issue.businessImpact}</span>
            </div>

            {/* Required Build */}
            <div className="rounded-lg border border-border bg-background/60 p-3 space-y-1.5">
              <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Required Build</div>
              <div className="text-sm">
                <span className="text-muted-foreground">Description: </span>
                <span className="text-foreground">{issue.requiredBuild.description}</span>
              </div>
              <div className="text-sm">
                <span className="text-muted-foreground">Suggested Fix: </span>
                <span className="text-foreground">{issue.requiredBuild.suggestedImplementation}</span>
              </div>
            </div>

            {/* Example Resources */}
            {issue.exampleResources.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Example Resources</div>
                {issue.exampleResources.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="truncate flex-1 text-foreground">{r.title}</span>
                    {r.url && (
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline shrink-0">
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* CTA */}
            <Button
              size="sm"
              variant="destructive"
              className="w-full"
              onClick={() => setBuildModal(issue)}
            >
              <Wrench className="h-3 w-3 mr-1" /> Fix This Issue
            </Button>
          </div>
        </div>
      ))}

      {/* Build Prompt Modal */}
      <Dialog open={!!buildModal} onOpenChange={(open) => !open && setBuildModal(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Wrench className="h-5 w-5 text-destructive" />
              Build Prompt: {buildModal?.issueName}
            </DialogTitle>
            <DialogDescription>
              Copy this prompt to start fixing this system gap.
            </DialogDescription>
          </DialogHeader>
          {buildModal && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${severityBadgeColors[buildModal.severity]}`}>
                  {buildModal.severity}
                </span>
                <span className="text-sm text-muted-foreground">{buildModal.affectedResources} affected resources</span>
              </div>
              <pre className="bg-muted rounded-lg p-4 text-xs whitespace-pre-wrap font-mono overflow-y-auto max-h-[40vh] border border-border">
                {generateBuildPrompt(buildModal)}
              </pre>
              <Button
                className="w-full"
                onClick={() => handleCopy(generateBuildPrompt(buildModal))}
              >
                <Copy className="h-3 w-3 mr-1" /> {copied ? 'Copied!' : 'Copy Build Prompt'}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, variant = 'muted' }: { label: string; value: number | string; variant?: 'success' | 'danger' | 'warning' | 'muted' }) {
  const colors = {
    success: 'border-status-green/30 bg-status-green/5 text-status-green',
    danger: 'border-status-red/30 bg-status-red/5 text-status-red',
    warning: 'border-status-yellow/30 bg-status-yellow/5 text-status-yellow',
    muted: 'border-border bg-card text-foreground',
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}
