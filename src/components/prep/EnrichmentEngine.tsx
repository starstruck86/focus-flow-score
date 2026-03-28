/**
 * Enrichment Engine — Integrated into Sales Brain OS
 *
 * One-click "Run Full Enrichment System" with:
 * - Success dashboard
 * - Operator work queues
 * - Resource diagnostics
 * - System gap roadmap
 */
import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAllResources, type Resource } from '@/hooks/useResources';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { useAuth } from '@/contexts/AuthContext';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import {
  Zap, Square, CheckCircle2, AlertTriangle, Clock, FileText,
  Lock, RotateCcw, Ban, Wrench, ExternalLink, ChevronDown, ChevronRight,
  TrendingUp, Loader2, ArrowRight, Copy
} from 'lucide-react';
import {
  resolveCanonicalState, computeEnrichmentHealth,
  CANONICAL_STATE_LABELS, CANONICAL_STATE_COLORS,
  type CanonicalState, type CanonicalStateResult, type EnrichmentHealthStats,
} from '@/lib/canonicalResourceState';
import {
  verifyResource, buildVerificationSummary,
  type VerifiedResource, type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import { buildRemediationQueues, type RemediationQueue } from '@/lib/remediationEngine';
import { runAutonomousRemediation, type RemediationCycleState } from '@/lib/autonomousRemediation';
import { analyzeRemediationBatch } from '@/lib/remediationIntelligence';
import { generateProductRoadmap, generateBuildPrompt, type RoadmapSummary, type RoadmapIssue } from '@/lib/systemGapRoadmap';
import { cn } from '@/lib/utils';

// ── Types ──────────────────────────────────────────────────

interface RunResult {
  phase: 'idle' | 'scanning' | 'remediating' | 'analyzing' | 'complete' | 'error';
  totalScanned: number;
  preComplete: number;
  postComplete: number;
  autoResolved: number;
  improvedNotComplete: number;
  needsManual: number;
  quarantined: number;
  systemGaps: number;
  netScoreChange: number;
  remediationState: RemediationCycleState | null;
  roadmap: RoadmapSummary | null;
  workQueues: WorkQueue[];
  errorMessage?: string;
}

interface WorkQueue {
  state: CanonicalState;
  label: string;
  action: string;
  items: WorkQueueItem[];
}

interface WorkQueueItem {
  id: string;
  title: string;
  url: string | null;
  subtypeLabel: string;
  score: number;
  reason: string;
  nextAction: string;
  sourceRouter: string;
}

const EMPTY_RESULT: RunResult = {
  phase: 'idle', totalScanned: 0, preComplete: 0, postComplete: 0,
  autoResolved: 0, improvedNotComplete: 0, needsManual: 0,
  quarantined: 0, systemGaps: 0, netScoreChange: 0,
  remediationState: null, roadmap: null, workQueues: [],
};

// ── Main Component ─────────────────────────────────────────

export function EnrichmentEngine() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: allResources, isLoading: loadingResources } = useAllResources();
  const { data: audioJobsMap, isLoading: loadingAudio } = useAudioJobsMap();
  const [result, setResult] = useState<RunResult>(EMPTY_RESULT);
  const [abort, setAbort] = useState<AbortController | null>(null);
  const [expandedQueues, setExpandedQueues] = useState<Record<string, boolean>>({});

  const isRunning = result.phase !== 'idle' && result.phase !== 'complete' && result.phase !== 'error';

  // Compute live health from canonical state model
  const health = useMemo<EnrichmentHealthStats | null>(() => {
    if (!allResources) return null;
    return computeEnrichmentHealth(allResources, audioJobsMap ?? undefined);
  }, [allResources, audioJobsMap]);

  // ── Run Full Enrichment System ──────────────────────────

  const handleRun = useCallback(async () => {
    const controller = new AbortController();
    setAbort(controller);
    setResult({ ...EMPTY_RESULT, phase: 'scanning' });

    try {
      // Step 1: Scan all resources
      const { data: freshResources } = await supabase.from('resources').select('*').order('created_at', { ascending: false });
      const { data: freshAudioRaw } = await supabase.from('audio_jobs').select('*').order('created_at', { ascending: false }).limit(500);
      const audioMap = new Map<string, any>();
      for (const row of (freshAudioRaw || [])) {
        if (!audioMap.has((row as any).resource_id)) audioMap.set((row as any).resource_id, row);
      }

      const verified: VerifiedResource[] = [];
      for (const resource of (freshResources || []) as any[]) {
        const rawJob = audioMap.get(resource.id);
        const audioJob: AudioJobInfo | null = rawJob ? {
          resourceId: resource.id, stage: rawJob.stage ?? 'unknown',
          failureCode: rawJob.failure_code ?? null, failureReason: rawJob.failure_reason ?? null,
          hasTranscript: rawJob.has_transcript ?? false, transcriptMode: rawJob.transcript_mode ?? null,
          finalResolutionStatus: rawJob.final_resolution_status ?? null,
          transcriptWordCount: rawJob.transcript_word_count ?? null, attemptsCount: rawJob.attempts_count ?? 0,
        } : null;
        verified.push(verifyResource(resource as any, audioJob));
      }

      if (controller.signal.aborted) return;

      const preComplete = verified.filter(v => v.fixabilityBucket === 'truly_complete').length;
      const broken = verified.filter(v => v.fixabilityBucket !== 'truly_complete');

      setResult(prev => ({
        ...prev, phase: 'remediating',
        totalScanned: verified.length,
        preComplete,
      }));

      // Step 2: Remediate
      let remState: RemediationCycleState | null = null;
      if (broken.length > 0) {
        const queues = buildRemediationQueues(broken);
        remState = await runAutonomousRemediation(queues, () => {}, controller.signal);
      }

      if (controller.signal.aborted) return;

      // Step 3: Re-verify + analyze
      setResult(prev => ({ ...prev, phase: 'analyzing' }));

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

      const postComplete = postVerified.filter(v => v.fixabilityBucket === 'truly_complete').length;
      const stillBroken = postVerified.filter(v => v.fixabilityBucket !== 'truly_complete');
      const analysis = analyzeRemediationBatch(stillBroken);

      // Build work queues from canonical states
      const workQueues = buildWorkQueues(postResources as any[], postAudioMap);

      // Generate roadmap
      const roadmap = generateProductRoadmap(stillBroken);

      // Compute score change
      const preAvg = verified.length > 0 ? verified.reduce((s, v) => s + v.qualityScore, 0) / verified.length : 0;
      const postAvg = postVerified.length > 0 ? postVerified.reduce((s, v) => s + v.qualityScore, 0) / postVerified.length : 0;

      setResult({
        phase: 'complete',
        totalScanned: verified.length,
        preComplete,
        postComplete,
        autoResolved: remState?.resolvedCompleteCount ?? 0,
        improvedNotComplete: (remState?.scoreImprovements ?? 0) - (remState?.resolvedCompleteCount ?? 0),
        needsManual: analysis.manualInput,
        quarantined: remState?.resolvedQuarantinedCount ?? 0,
        systemGaps: analysis.systemGaps.length,
        netScoreChange: Math.round(postAvg - preAvg),
        remediationState: remState,
        roadmap,
        workQueues,
      });

      // Refresh queries
      await qc.invalidateQueries({ queryKey: ['resources'] });
      await qc.invalidateQueries({ queryKey: ['all-resources'] });
      toast.success(`Enrichment complete: ${postComplete - preComplete} newly resolved`);

    } catch (e: any) {
      setResult(prev => ({ ...prev, phase: 'error', errorMessage: e.message }));
      toast.error(`Enrichment failed: ${e.message}`);
    }
  }, [qc]);

  const handleStop = useCallback(() => {
    abort?.abort();
    setAbort(null);
    setResult(prev => ({ ...prev, phase: 'idle' }));
  }, [abort]);

  const isLoading = loadingResources || loadingAudio;

  return (
    <div className="space-y-4">
      {/* ── Success Dashboard ── */}
      {health && (
        <HealthDashboard health={health} />
      )}

      {/* ── Primary Action ── */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Run Full Enrichment System</p>
              <p className="text-xs text-muted-foreground">
                Scan → Verify → Remediate → Re-verify → Report
              </p>
            </div>
            {!isRunning ? (
              <Button onClick={handleRun} disabled={isLoading} className="bg-primary text-primary-foreground font-semibold gap-1.5">
                <Zap className="h-3.5 w-3.5" /> Run Full System
              </Button>
            ) : (
              <Button variant="destructive" onClick={handleStop} className="gap-1.5">
                <Square className="h-3.5 w-3.5" /> Stop ({result.phase})
              </Button>
            )}
          </div>

          {/* Progress */}
          {isRunning && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {result.phase === 'scanning' && 'Scanning all resources…'}
              {result.phase === 'remediating' && 'Running autonomous remediation…'}
              {result.phase === 'analyzing' && 'Re-verifying and analyzing results…'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Run Results ── */}
      {result.phase === 'complete' && (
        <>
          <RunResultsSummary result={result} />

          {/* Work Queues */}
          {result.workQueues.filter(q => q.items.length > 0).map(queue => (
            <WorkQueueSection
              key={queue.state}
              queue={queue}
              expanded={expandedQueues[queue.state] ?? false}
              onToggle={() => setExpandedQueues(prev => ({ ...prev, [queue.state]: !prev[queue.state] }))}
              onFix={(id) => navigate(`/prep?manualAssist=${id}`)}
            />
          ))}

          {/* Roadmap */}
          {result.roadmap && result.roadmap.issues.length > 0 && (
            <RoadmapSection roadmap={result.roadmap} />
          )}
        </>
      )}

      {result.phase === 'error' && (
        <Card className="border-destructive">
          <CardContent className="py-4 text-center">
            <AlertTriangle className="h-6 w-6 mx-auto mb-2 text-destructive" />
            <p className="text-sm text-destructive">{result.errorMessage}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setResult(EMPTY_RESULT)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Advanced link */}
      <div className="text-center">
        <Button variant="link" size="sm" onClick={() => navigate('/verify-enrichment')} className="text-xs text-muted-foreground gap-1">
          <ExternalLink className="h-3 w-3" /> Open Advanced Diagnostics
        </Button>
      </div>
    </div>
  );
}

// ── Health Dashboard ──────────────────────────────────────

function HealthDashboard({ health }: { health: EnrichmentHealthStats }) {
  return (
    <div className="space-y-2">
      {/* Completion bar */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-foreground">
              {health.completionPct}% Complete
            </span>
            <span className="text-[10px] text-muted-foreground">
              {health.trulyComplete}/{health.total} resources
            </span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-status-green rounded-full transition-all duration-500"
              style={{ width: `${health.completionPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Stat grid */}
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

// ── Run Results Summary ──────────────────────────────────

function RunResultsSummary({ result }: { result: RunResult }) {
  const improved = result.postComplete > result.preComplete;
  return (
    <Card className={improved ? 'border-status-green/30' : 'border-status-yellow/30'}>
      <CardContent className="py-4">
        <div className="flex items-start gap-3">
          {improved ? (
            <TrendingUp className="h-5 w-5 text-status-green shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-5 w-5 text-status-yellow shrink-0 mt-0.5" />
          )}
          <div className="flex-1 space-y-2">
            <p className="text-sm font-semibold text-foreground">
              {improved ? 'System Improved' : 'Blockers Remain'}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-muted-foreground">Scanned</span>
                <p className="font-bold text-foreground">{result.totalScanned}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Auto-resolved</span>
                <p className="font-bold text-status-green">{result.autoResolved}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Needs Input</span>
                <p className="font-bold text-status-yellow">{result.needsManual}</p>
              </div>
              <div>
                <span className="text-muted-foreground">System Gaps</span>
                <p className="font-bold text-destructive">{result.systemGaps}</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
              <span>Before: {result.preComplete} complete</span>
              <ArrowRight className="h-3 w-3" />
              <span>After: {result.postComplete} complete</span>
              <span className={cn('font-medium', result.netScoreChange > 0 ? 'text-status-green' : 'text-muted-foreground')}>
                {result.netScoreChange > 0 ? '+' : ''}{result.netScoreChange} avg score
              </span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Work Queue Section ───────────────────────────────────

function WorkQueueSection({ queue, expanded, onToggle, onFix }: {
  queue: WorkQueue; expanded: boolean;
  onToggle: () => void; onFix: (id: string) => void;
}) {
  const stateColor = CANONICAL_STATE_COLORS[queue.state] || 'bg-muted text-muted-foreground';

  return (
    <Card>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 flex items-center gap-2">
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
        <Badge className={cn('text-[10px]', stateColor)}>{queue.label}</Badge>
        <span className="text-sm font-medium text-foreground">{queue.items.length} resources</span>
        <span className="text-xs text-muted-foreground ml-auto">{queue.action}</span>
      </button>
      {expanded && (
        <CardContent className="pt-0 pb-3">
          <ScrollArea className="max-h-[300px]">
            <div className="space-y-1">
              {queue.items.map(item => (
                <div key={item.id} className="flex items-start gap-2 rounded px-2 py-1.5 hover:bg-muted/30 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.title}</p>
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{item.subtypeLabel}</span>
                      <span>Score: {item.score}</span>
                      <span className="text-foreground/70">{item.sourceRouter}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{item.reason}</p>
                  </div>
                  <Button
                    size="sm" variant="outline"
                    className="h-6 text-[10px] gap-1 shrink-0"
                    onClick={() => onFix(item.id)}
                  >
                    {item.nextAction.includes('Paste') ? <FileText className="h-2.5 w-2.5" /> :
                     item.nextAction.includes('Auth') ? <Lock className="h-2.5 w-2.5" /> :
                     item.nextAction.includes('Retry') ? <RotateCcw className="h-2.5 w-2.5" /> :
                     <Wrench className="h-2.5 w-2.5" />}
                    {item.nextAction.length > 30 ? item.nextAction.slice(0, 28) + '…' : item.nextAction}
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      )}
    </Card>
  );
}

// ── Roadmap Section ──────────────────────────────────────

function RoadmapSection({ roadmap }: { roadmap: RoadmapSummary }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="border-destructive/30">
      <button onClick={() => setExpanded(!expanded)} className="w-full text-left px-4 py-3 flex items-center gap-2">
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
  const [showPrompt, setShowPrompt] = useState(false);
  const sevColors = {
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
        <Button
          size="sm" variant="ghost"
          className="h-5 text-[9px] gap-0.5 ml-auto"
          onClick={() => {
            const prompt = generateBuildPrompt(issue);
            navigator.clipboard.writeText(prompt);
            toast.success('Build prompt copied');
          }}
        >
          <Copy className="h-2.5 w-2.5" /> Copy Prompt
        </Button>
      </div>
    </div>
  );
}

// ── Build Work Queues ────────────────────────────────────

function buildWorkQueues(resources: Resource[], audioMap: Map<string, any>): WorkQueue[] {
  const queueMap = new Map<CanonicalState, WorkQueueItem[]>();

  for (const resource of resources) {
    const job = audioMap.get(resource.id) ?? null;
    const resolved = resolveCanonicalState(resource, job);

    // Skip complete and enriching
    if (resolved.state === 'truly_complete' || resolved.state === 'enriching') continue;

    if (!queueMap.has(resolved.state)) queueMap.set(resolved.state, []);
    queueMap.get(resolved.state)!.push({
      id: resource.id,
      title: resource.title,
      url: resource.file_url ?? null,
      subtypeLabel: resolved.subtypeLabel,
      score: resolved.qualityScore,
      reason: resolved.description,
      nextAction: resolved.nextAction || 'Review',
      sourceRouter: resolved.sourceRouter,
    });
  }

  const QUEUE_ORDER: CanonicalState[] = [
    'ready_to_enrich', 'retryable_failure',
    'needs_transcript', 'needs_pasted_content',
    'needs_access_auth', 'needs_alternate_source',
    'metadata_only_candidate', 'quarantined', 'system_gap',
  ];

  const QUEUE_ACTIONS: Record<CanonicalState, string> = {
    ready_to_enrich: 'Run enrichment',
    enriching: '',
    retryable_failure: 'Retry extraction',
    needs_transcript: 'Paste transcript',
    needs_pasted_content: 'Paste content',
    needs_access_auth: 'Provide access',
    needs_alternate_source: 'Provide better URL',
    metadata_only_candidate: 'Accept or improve',
    quarantined: 'Manual review',
    truly_complete: '',
    system_gap: 'Requires build',
  };

  return QUEUE_ORDER
    .filter(state => queueMap.has(state))
    .map(state => ({
      state,
      label: CANONICAL_STATE_LABELS[state],
      action: QUEUE_ACTIONS[state],
      items: queueMap.get(state) || [],
    }));
}
