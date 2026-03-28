/**
 * Enrichment Verification — Operator-grade diagnostic page.
 * Queries REAL resources + audio_jobs, evaluates every non-100 resource,
 * surfaces contradictions, failure patterns, and a fix plan.
 * Persists each run to verification_runs for comparison over time.
 * Includes Remediation Engine with action queues and bulk actions.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { useAllResources } from '@/hooks/useResources';
import { useAudioJobsMap } from '@/hooks/useAudioJobs';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Download, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Copy, ExternalLink, Search, Filter, History, Zap, ShieldAlert, Lock, FileText, Ban, Bug, RotateCcw, Play, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  verifyResource,
  buildVerificationSummary,
  sortByPain,
  FIXABILITY_LABELS,
  FIXABILITY_COLORS,
  type VerifiedResource,
  type VerificationSummary,
  type AudioJobInfo,
} from '@/lib/enrichmentVerification';
import {
  buildRemediationQueues,
  executeBulkAction,
  QUEUE_LABELS,
  QUEUE_DESCRIPTIONS,
  QUEUE_ACTIONS,
  type RemediationQueue,
  type BulkActionResult,
} from '@/lib/remediationEngine';
import {
  runFixBrokenResources,
  type FixRunState,
  type FixItem,
  type FixItemStatus,
} from '@/lib/fixBrokenResources';

// ── Persist run to DB ──────────────────────────────────────

async function persistRun(userId: string, totalResources: number, summary: VerificationSummary) {
  const totalBroken = summary.totalInScope - (summary.byFixability['truly_complete'] || 0);
  const { error } = await supabase.from('verification_runs' as any).insert({
    user_id: userId,
    total_resources: totalResources,
    total_in_scope: summary.totalInScope,
    total_broken: totalBroken,
    total_contradictions: summary.totalContradictions,
    by_fixability: summary.byFixability,
    by_failure_bucket: summary.byFailureBucket,
    by_processing_state: summary.byProcessingState,
    by_subtype: summary.bySubtype,
    by_score_band: summary.byScoreBand,
    fix_recommendations: summary.fixRecommendations,
    repeated_patterns: summary.repeatedPatterns,
    summary_snapshot: {
      retryable: summary.byRetryable.retryable,
      nonRetryable: summary.byRetryable.nonRetryable,
      quarantined: summary.byQuarantined,
      manualRequired: summary.byManualRequired,
      metadataOnly: summary.byMetadataOnly,
    },
  } as any);
  if (error) console.error('Failed to persist verification run:', error);
  return !error;
}

function useVerificationHistory() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['verification-runs', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('verification_runs' as any)
        .select('*')
        .order('run_at', { ascending: false })
        .limit(10);
      if (error) throw error;
      return (data || []) as any[];
    },
    enabled: !!user,
  });
}

// ── Main Page ──────────────────────────────────────────────

export default function EnrichmentVerification() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data: allResources, isLoading: loadingResources } = useAllResources();
  const { data: audioJobsMap, isLoading: loadingAudio } = useAudioJobsMap();
  const { data: history } = useVerificationHistory();

  const [hasRun, setHasRun] = useState(false);
  const [saving, setSaving] = useState(false);
  const [includeComplete, setIncludeComplete] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBucket, setSelectedBucket] = useState<string | null>(null);
  const [drawerResource, setDrawerResource] = useState<VerifiedResource | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    dashboard: true,
    fixPlan: true,
    remediation: true,
    patterns: false,
    table: true,
  });
  const [runningQueue, setRunningQueue] = useState<RemediationQueue | null>(null);
  const [lastBulkResult, setLastBulkResult] = useState<BulkActionResult | null>(null);
  const [fixRunState, setFixRunState] = useState<FixRunState | null>(null);
  const [fixAbortController, setFixAbortController] = useState<AbortController | null>(null);

  // Run verification against real data
  const { verified, summary } = useMemo(() => {
    if (!hasRun || !allResources) return { verified: [], summary: null };

    const audioMap = audioJobsMap ?? new Map();
    const results: VerifiedResource[] = [];

    for (const resource of allResources) {
      const rawJob = audioMap.get(resource.id);
      const audioJob: AudioJobInfo | null = rawJob ? {
        resourceId: resource.id,
        stage: (rawJob as any).stage ?? 'unknown',
        failureCode: (rawJob as any).failure_code ?? null,
        failureReason: (rawJob as any).failure_reason ?? null,
        hasTranscript: (rawJob as any).has_transcript ?? false,
        transcriptMode: (rawJob as any).transcript_mode ?? null,
        finalResolutionStatus: (rawJob as any).final_resolution_status ?? null,
        transcriptWordCount: (rawJob as any).transcript_word_count ?? null,
        attemptsCount: (rawJob as any).attempts_count ?? 0,
      } : null;

      const v = verifyResource(resource, audioJob);
      if (includeComplete || v.fixabilityBucket !== 'truly_complete') {
        results.push(v);
      }
    }

    results.sort(sortByPain);
    const summary = buildVerificationSummary(results);
    return { verified: results, summary };
  }, [hasRun, allResources, audioJobsMap, includeComplete]);

  // Persist on first run
  useEffect(() => {
    if (summary && hasRun && user && !saving) {
      setSaving(true);
      persistRun(user.id, allResources?.length ?? 0, summary).then((ok) => {
        if (ok) {
          qc.invalidateQueries({ queryKey: ['verification-runs'] });
          toast.success('Verification run saved');
        }
        setSaving(false);
      });
    }
    // Only run when hasRun transitions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRun]);

  // Derived banner numbers
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
      list = list.filter(v =>
        v.title.toLowerCase().includes(q) ||
        v.url?.toLowerCase().includes(q) ||
        v.subtypeLabel.toLowerCase().includes(q) ||
        v.fixabilityBucket.includes(q)
      );
    }
    if (selectedBucket) {
      list = list.filter(v => v.fixabilityBucket === selectedBucket);
    }
    return list;
  }, [verified, searchQuery, selectedBucket]);

  // Build remediation queues from verified resources
  const remediationQueues = useMemo(() => {
    if (!verified.length) return null;
    return buildRemediationQueues(verified);
  }, [verified]);

  const handleBulkAction = useCallback(async (queue: RemediationQueue) => {
    if (!remediationQueues) return;
    const resources = remediationQueues[queue];
    if (!resources.length) {
      toast.info('No resources in this queue');
      return;
    }
    setRunningQueue(queue);
    setLastBulkResult(null);
    try {
      const result = await executeBulkAction(queue, resources);
      setLastBulkResult(result);
      if (result.failed === 0) {
        toast.success(`${QUEUE_LABELS[queue]}: ${result.succeeded} resources updated`);
      } else {
        toast.warning(`${QUEUE_LABELS[queue]}: ${result.succeeded} succeeded, ${result.failed} failed`);
      }
      // Invalidate resources to refresh data
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['all-resources'] });
    } catch (e: any) {
      toast.error(`Bulk action failed: ${e.message}`);
    } finally {
      setRunningQueue(null);
    }
  }, [remediationQueues, qc]);

  const toggleSection = (key: string) =>
    setExpandedSections(prev => ({ ...prev, [key]: !prev[key] }));

  const exportJSON = useCallback(() => {
    const blob = new Blob([JSON.stringify({ summary, resources: verified }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `enrichment-verification-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Exported verification results');
  }, [verified, summary]);

  const exportCSV = useCallback(() => {
    if (!verified.length) return;
    const headers = ['ID', 'Title', 'URL', 'Subtype', 'Status', 'Score', 'Tier', 'Failure Bucket', 'Fixability', 'Contradictions', 'Root Cause', 'Action'];
    const rows = verified.map(v => [
      v.id, v.title, v.url || '', v.subtypeLabel, v.enrichmentStatusLabel,
      v.qualityScore, v.qualityTier, v.failureBucket || '', FIXABILITY_LABELS[v.fixabilityBucket],
      v.contradictions.length, v.rootCauseCategory, v.recommendedAction,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `enrichment-verification-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success('Exported CSV');
  }, [verified]);

  const handleRun = useCallback(() => {
    setHasRun(false);
    // Force re-run by toggling off then on in next tick
    setTimeout(() => setHasRun(true), 0);
  }, []);

  const handleStartFix = useCallback(() => {
    if (!remediationQueues) return;
    const controller = new AbortController();
    setFixAbortController(controller);
    runFixBrokenResources(remediationQueues, (state) => {
      setFixRunState({ ...state });
      if (state.status === 'completed') {
        qc.invalidateQueries({ queryKey: ['resources'] });
        qc.invalidateQueries({ queryKey: ['all-resources'] });
        toast.success(`Fix run complete: ${state.resolvedCount} resolved, ${state.quarantinedCount} quarantined, ${state.manualRequiredCount} manual`);
      }
    }, controller.signal);
  }, [remediationQueues, qc]);

  const handleStopFix = useCallback(() => {
    fixAbortController?.abort();
    setFixAbortController(null);
  }, [fixAbortController]);

  const isFixRunning = fixRunState?.status === 'running';

  const isLoading = loadingResources || loadingAudio;

  return (
    <div className="min-h-screen bg-background">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/prep')}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold">Enrichment Verification</h1>
              <p className="text-xs text-muted-foreground">Real data · {allResources?.length ?? 0} total resources</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {history && history.length > 0 && (
              <Button variant="ghost" size="sm" onClick={() => setShowHistory(!showHistory)}>
                <History className="h-3.5 w-3.5 mr-1" /> History
              </Button>
            )}
            {hasRun && (
              <>
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <Download className="h-3 w-3 mr-1" /> CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportJSON}>
                  <Download className="h-3 w-3 mr-1" /> JSON
                </Button>
              </>
            )}
            {hasRun && remediationQueues && !isFixRunning && (
              <Button size="sm" variant="default" onClick={handleStartFix} disabled={isLoading || saving || isFixRunning}
                className="bg-status-green hover:bg-status-green/90 text-status-green-foreground">
                <Zap className="h-3 w-3 mr-1" /> Fix Broken Resources
              </Button>
            )}
            {isFixRunning && (
              <Button size="sm" variant="destructive" onClick={handleStopFix}>
                <Ban className="h-3 w-3 mr-1" /> Stop Fix
              </Button>
            )}
            <Button size="sm" onClick={handleRun} disabled={isLoading || saving || isFixRunning}>
              {saving ? 'Saving…' : hasRun ? 'Re-run Verification' : 'Run Verification Against Real Data'}
            </Button>
          </div>
        </div>
      </div>

      {/* Summary Banner — always visible after a run */}
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
        {/* Run History */}
        {showHistory && history && history.length > 0 && (
          <RunHistory runs={history} />
        )}

        {!hasRun && !saving && (
          <div className="rounded-lg border border-border p-8 text-center space-y-4">
            <AlertTriangle className="h-10 w-10 text-status-yellow mx-auto" />
            <h2 className="text-xl font-semibold">Ready to Verify</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              This will evaluate every resource in your database against the enrichment system.
              No mocked data — real records only.
            </p>
            <Button onClick={handleRun} disabled={isLoading} size="lg">
              {isLoading ? 'Loading resources…' : 'Run Verification Against Real Data'}
            </Button>
          </div>
        )}

        {hasRun && summary && (
          <>
            {/* Dashboard */}
            <SectionHeader title="Dashboard" sectionKey="dashboard" expanded={expandedSections.dashboard} toggle={toggleSection} />
            {expandedSections.dashboard && <DashboardCards summary={summary} onBucketClick={setSelectedBucket} selectedBucket={selectedBucket} />}

            {/* Fix Plan */}
            <SectionHeader title="What Needs to Be Fixed" sectionKey="fixPlan" expanded={expandedSections.fixPlan} toggle={toggleSection} />
            {expandedSections.fixPlan && <FixPlanSection recommendations={summary.fixRecommendations} />}

            {/* Remediation Queues */}
            <SectionHeader title="Recovery Queues" sectionKey="remediation" expanded={expandedSections.remediation} toggle={toggleSection} />
            {expandedSections.remediation && remediationQueues && (
              <RemediationQueuesSection
                queues={remediationQueues}
                onRunAction={handleBulkAction}
                runningQueue={runningQueue}
                lastResult={lastBulkResult}
                onFilterByQueue={(q) => setSelectedBucket(q)}
              />
            )}

            {/* Fix Broken Resources Panel */}
            {fixRunState && <FixRunPanel state={fixRunState} />}

            {/* Repeated Patterns */}
            <SectionHeader title="Repeated Failure Patterns" sectionKey="patterns" expanded={expandedSections.patterns} toggle={toggleSection} count={summary.repeatedPatterns.length} />
            {expandedSections.patterns && <PatternsSection patterns={summary.repeatedPatterns} />}

            {/* Controls */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search resources…" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9" />
              </div>
              <div className="flex items-center gap-2">
                <Switch id="include-complete" checked={includeComplete} onCheckedChange={setIncludeComplete} />
                <Label htmlFor="include-complete" className="text-sm">Include complete</Label>
              </div>
              {selectedBucket && (
                <Button variant="outline" size="sm" onClick={() => setSelectedBucket(null)}>
                  <Filter className="h-3 w-3 mr-1" /> Clear: {FIXABILITY_LABELS[selectedBucket as keyof typeof FIXABILITY_LABELS] || selectedBucket}
                </Button>
              )}
              <span className="text-sm text-muted-foreground ml-auto">{filtered.length} resources</span>
            </div>

            {/* Table */}
            <SectionHeader title="Resources" sectionKey="table" expanded={expandedSections.table} toggle={toggleSection} count={filtered.length} />
            {expandedSections.table && <ResourceTable resources={filtered} onSelect={setDrawerResource} />}
          </>
        )}
      </div>

      {/* Drawer */}
      {drawerResource && <ResourceDrawer resource={drawerResource} onClose={() => setDrawerResource(null)} />}
    </div>
  );
}

// ── Banner Stat ────────────────────────────────────────────

function BannerStat({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 py-1">
      <div className={`flex items-center gap-1 ${color}`}>
        {icon}
        <span className="text-lg font-bold">{value}</span>
      </div>
      <span className="text-[10px] text-muted-foreground leading-tight">{label}</span>
    </div>
  );
}

// ── Run History ────────────────────────────────────────────

function RunHistory({ runs }: { runs: any[] }) {
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <h3 className="text-sm font-semibold flex items-center gap-2"><History className="h-4 w-4" /> Previous Runs</h3>
      <div className="space-y-2">
        {runs.map((run: any) => {
          const snap = run.summary_snapshot || {};
          return (
            <div key={run.id} className="flex items-center justify-between text-sm py-2 px-3 rounded-lg border border-border bg-muted/20">
              <div className="flex items-center gap-3">
                <span className="text-muted-foreground font-mono text-xs">
                  {new Date(run.run_at).toLocaleDateString()} {new Date(run.run_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <Badge variant="outline">{run.total_resources} total</Badge>
              </div>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-status-red font-medium">{run.total_broken} broken</span>
                <span className="text-muted-foreground">{run.total_contradictions} contradictions</span>
                <span className="text-muted-foreground">Q:{snap.quarantined ?? 0}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────────

function SectionHeader({ title, sectionKey, expanded, toggle, count }: {
  title: string; sectionKey: string; expanded: boolean;
  toggle: (key: string) => void; count?: number;
}) {
  return (
    <button onClick={() => toggle(sectionKey)} className="flex items-center gap-2 w-full text-left py-2 group">
      {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
      <h2 className="text-base font-semibold">{title}</h2>
      {count !== undefined && <Badge variant="secondary" className="text-xs">{count}</Badge>}
    </button>
  );
}

// ── Dashboard Cards ────────────────────────────────────────

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
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Quality Score Distribution</h3>
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
        <h3 className="text-sm font-medium text-muted-foreground mb-2">Fixability Breakdown</h3>
        <div className="flex flex-wrap gap-2">
          {Object.entries(summary.byFixability)
            .sort(([, a], [, b]) => b - a)
            .map(([bucket, count]) => (
              <button
                key={bucket}
                onClick={() => onBucketClick(selectedBucket === bucket ? null : bucket)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-all ${
                  selectedBucket === bucket ? 'ring-2 ring-primary' : ''
                } ${FIXABILITY_COLORS[bucket as keyof typeof FIXABILITY_COLORS] || 'bg-muted text-muted-foreground'}`}
              >
                {FIXABILITY_LABELS[bucket as keyof typeof FIXABILITY_LABELS] || bucket}
                <span className="font-bold">{count}</span>
              </button>
            ))}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">By Subtype</h3>
          <div className="space-y-1">
            {Object.entries(summary.bySubtype).sort(([, a], [, b]) => b - a).map(([sub, count]) => (
              <div key={sub} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-foreground">{sub}</span>
                <span className="font-mono text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-2">By Status</h3>
          <div className="space-y-1">
            {Object.entries(summary.byProcessingState).sort(([, a], [, b]) => b - a).map(([state, count]) => (
              <div key={state} className="flex items-center justify-between text-sm py-0.5">
                <span className="text-foreground">{state}</span>
                <span className="font-mono text-muted-foreground">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, variant = 'muted' }: { label: string; value: number; variant?: 'success' | 'danger' | 'warning' | 'muted' }) {
  const colors = {
    success: 'border-status-green/30 bg-status-green/5',
    danger: 'border-status-red/30 bg-status-red/5',
    warning: 'border-status-yellow/30 bg-status-yellow/5',
    muted: 'border-border bg-card',
  };
  return (
    <div className={`rounded-lg border p-3 ${colors[variant]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

// ── Fix Plan Section ───────────────────────────────────────

function FixPlanSection({ recommendations }: { recommendations: VerificationSummary['fixRecommendations'] }) {
  if (!recommendations.length) {
    return (
      <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-4 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-status-green" />
        <span className="text-sm">No fix recommendations — system is clean.</span>
      </div>
    );
  }

  const sevColors: Record<string, string> = {
    critical: 'bg-status-red/20 text-status-red',
    high: 'bg-orange-500/20 text-orange-600',
    medium: 'bg-status-yellow/20 text-status-yellow',
    low: 'bg-muted text-muted-foreground',
  };

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

// ── Remediation Queues Section ─────────────────────────────

const QUEUE_ICONS: Record<RemediationQueue, React.ReactNode> = {
  auto_fix_now: <Zap className="h-4 w-4" />,
  retry_different_strategy: <RotateCcw className="h-4 w-4" />,
  needs_transcript: <FileText className="h-4 w-4" />,
  needs_pasted_content: <FileText className="h-4 w-4" />,
  needs_access_auth: <Lock className="h-4 w-4" />,
  needs_alternate_source: <ExternalLink className="h-4 w-4" />,
  accept_metadata_only: <CheckCircle2 className="h-4 w-4" />,
  needs_quarantine: <Ban className="h-4 w-4" />,
  bad_scoring_state_bug: <Bug className="h-4 w-4" />,
};

const QUEUE_COLORS: Record<RemediationQueue, string> = {
  auto_fix_now: 'border-status-green/40 bg-status-green/5',
  retry_different_strategy: 'border-status-yellow/40 bg-status-yellow/5',
  needs_transcript: 'border-primary/40 bg-primary/5',
  needs_pasted_content: 'border-primary/40 bg-primary/5',
  needs_access_auth: 'border-orange-500/40 bg-orange-500/5',
  needs_alternate_source: 'border-orange-500/40 bg-orange-500/5',
  accept_metadata_only: 'border-border bg-muted/30',
  needs_quarantine: 'border-status-red/40 bg-status-red/5',
  bad_scoring_state_bug: 'border-status-red/40 bg-status-red/5',
};

function RemediationQueuesSection({
  queues,
  onRunAction,
  runningQueue,
  lastResult,
  onFilterByQueue,
}: {
  queues: Record<RemediationQueue, VerifiedResource[]>;
  onRunAction: (q: RemediationQueue) => void;
  runningQueue: RemediationQueue | null;
  lastResult: BulkActionResult | null;
  onFilterByQueue: (q: string) => void;
}) {
  const orderedQueues: RemediationQueue[] = [
    'auto_fix_now',
    'bad_scoring_state_bug',
    'retry_different_strategy',
    'needs_transcript',
    'needs_pasted_content',
    'needs_access_auth',
    'needs_alternate_source',
    'accept_metadata_only',
    'needs_quarantine',
  ];

  const nonEmptyQueues = orderedQueues.filter(q => queues[q].length > 0);

  if (nonEmptyQueues.length === 0) {
    return (
      <div className="rounded-lg border border-status-green/30 bg-status-green/5 p-4 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-status-green" />
        <span className="text-sm">All resources are in a final state — no recovery actions needed.</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {lastResult && (
        <div className={`rounded-lg border p-3 text-sm ${
          lastResult.failed === 0 ? 'border-status-green/30 bg-status-green/5' : 'border-status-yellow/30 bg-status-yellow/5'
        }`}>
          <span className="font-medium">{QUEUE_LABELS[lastResult.queue]}:</span>{' '}
          {lastResult.succeeded} updated{lastResult.failed > 0 && `, ${lastResult.failed} failed`}
          {lastResult.errors.length > 0 && (
            <div className="mt-1 text-xs text-muted-foreground">
              {lastResult.errors.slice(0, 3).map((e, i) => (
                <div key={i}>{e.title}: {e.error}</div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {nonEmptyQueues.map(queue => {
          const resources = queues[queue];
          const isRunning = runningQueue === queue;
          const isAutomatic = queue === 'auto_fix_now' || queue === 'retry_different_strategy' || queue === 'bad_scoring_state_bug' || queue === 'accept_metadata_only' || queue === 'needs_quarantine';

          return (
            <div key={queue} className={`rounded-lg border p-4 space-y-3 ${QUEUE_COLORS[queue]}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  {QUEUE_ICONS[queue]}
                  <div>
                    <div className="font-medium text-sm">{QUEUE_LABELS[queue]}</div>
                    <div className="text-xs text-muted-foreground">{QUEUE_DESCRIPTIONS[queue]}</div>
                  </div>
                </div>
                <Badge variant="secondary" className="font-bold shrink-0">{resources.length}</Badge>
              </div>

              <div className="text-xs text-muted-foreground border-t border-border/50 pt-2">
                <span className="font-medium">Action:</span> {QUEUE_ACTIONS[queue]}
              </div>

              <div className="flex items-center gap-2">
                {isAutomatic ? (
                  <Button
                    size="sm"
                    variant={queue === 'auto_fix_now' ? 'default' : 'outline'}
                    onClick={() => onRunAction(queue)}
                    disabled={isRunning || runningQueue !== null}
                    className="flex-1"
                  >
                    {isRunning ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</>
                    ) : (
                      <><Play className="h-3 w-3 mr-1" /> Run ({resources.length})</>
                    )}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onRunAction(queue)}
                    disabled={isRunning || runningQueue !== null}
                    className="flex-1"
                  >
                    {isRunning ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Running…</>
                    ) : (
                      <><Play className="h-3 w-3 mr-1" /> Route ({resources.length})</>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => onFilterByQueue(queue)}
                >
                  <Search className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const FIX_STATUS_LABELS: Record<FixItemStatus, string> = { pending: 'Pending', processing: 'Processing', enriching: 'Enriching…', re_scoring: 'Re-scoring…', resolved_complete: '✓ Complete', resolved_metadata_only: '✓ Metadata', resolved_quarantined: '⊘ Quarantined', awaiting_manual: '⏳ Manual', failed_retry_exhausted: '✗ Failed', skipped: '—' };
const FIX_STATUS_COLORS: Record<FixItemStatus, string> = { pending: 'text-muted-foreground', processing: 'text-primary', enriching: 'text-primary', re_scoring: 'text-primary', resolved_complete: 'text-status-green', resolved_metadata_only: 'text-muted-foreground', resolved_quarantined: 'text-status-red', awaiting_manual: 'text-status-yellow', failed_retry_exhausted: 'text-status-red', skipped: 'text-muted-foreground' };

function FixRunPanel({ state }: { state: FixRunState }) {
  const progress = state.totalItems > 0 ? Math.round((state.processedCount / state.totalItems) * 100) : 0;
  const isRunning = state.status === 'running';
  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isRunning ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : <Zap className="h-4 w-4 text-primary" />}
          <h3 className="font-semibold text-sm">Fix Broken Resources</h3>
          <Badge variant="outline">{state.status}</Badge>
        </div>
        <span className="text-sm font-mono text-muted-foreground">{state.processedCount}/{state.totalItems}</span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
        {[
          { v: state.resolvedCount, l: 'Resolved', c: 'text-status-green' },
          { v: state.quarantinedCount, l: 'Quarantined', c: 'text-status-red' },
          { v: state.metadataOnlyCount, l: 'Metadata', c: 'text-muted-foreground' },
          { v: state.manualRequiredCount, l: 'Manual', c: 'text-status-yellow' },
          { v: state.failedCount, l: 'Failed', c: 'text-status-red' },
          { v: state.skippedCount, l: 'Skipped', c: 'text-muted-foreground' },
        ].map(s => (
          <div key={s.l} className="rounded-lg border border-border p-2">
            <div className={`text-lg font-bold ${s.c}`}>{s.v}</div>
            <div className="text-[10px] text-muted-foreground">{s.l}</div>
          </div>
        ))}
      </div>
      <ScrollArea className="max-h-[300px] rounded-lg border border-border">
        <div className="divide-y divide-border">
          {state.items.map(item => (
            <div key={item.id} className={`flex items-center gap-3 px-3 py-2 text-sm ${item.id === state.currentItemId ? 'bg-primary/10' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{item.title}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {item.subtypeLabel} · {QUEUE_LABELS[item.queue]}
                  {item.terminalReason && <span className="ml-1">— {item.terminalReason}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {item.currentScore !== null && <span className="text-xs font-mono">{item.previousScore}→{item.currentScore}</span>}
                <span className={`text-xs font-medium ${FIX_STATUS_COLORS[item.status]}`}>{FIX_STATUS_LABELS[item.status]}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function PatternsSection({ patterns }: { patterns: Array<{ pattern: string; count: number }> }) {
  if (!patterns.length) return <p className="text-sm text-muted-foreground">No repeated patterns detected.</p>;
  return (
    <div className="space-y-1">
      {patterns.map((p, i) => (
        <div key={i} className="flex items-center justify-between text-sm py-1 px-2 rounded hover:bg-muted/50">
          <span>{p.pattern}</span>
          <Badge variant="secondary">{p.count}×</Badge>
        </div>
      ))}
    </div>
  );
}

// ── Resource Table ─────────────────────────────────────────

function ResourceTable({ resources, onSelect }: { resources: VerifiedResource[]; onSelect: (r: VerifiedResource) => void }) {
  if (!resources.length) return <p className="text-sm text-muted-foreground text-center py-8">No resources match the current filters.</p>;

  return (
    <ScrollArea className="rounded-lg border border-border">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[1fr_100px_60px_120px_140px_30px] gap-2 px-4 py-2 border-b border-border bg-muted/30 text-xs font-medium text-muted-foreground sticky top-0">
          <span>Title</span>
          <span>Status</span>
          <span>Score</span>
          <span>Fixability</span>
          <span>Root Cause</span>
          <span></span>
        </div>
        {resources.map(v => (
          <button
            key={v.id}
            onClick={() => onSelect(v)}
            className="grid grid-cols-[1fr_100px_60px_120px_140px_30px] gap-2 px-4 py-2.5 border-b border-border hover:bg-muted/30 w-full text-left items-center"
          >
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{v.title}</div>
              <div className="text-xs text-muted-foreground truncate">{v.subtypeLabel}</div>
            </div>
            <div><Badge variant="outline" className="text-xs whitespace-nowrap">{v.enrichmentStatusLabel}</Badge></div>
            <div className={`text-sm font-mono font-bold ${v.qualityScore >= 70 ? 'text-status-green' : v.qualityScore >= 40 ? 'text-status-yellow' : 'text-status-red'}`}>
              {v.qualityScore}
            </div>
            <div>
              <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${FIXABILITY_COLORS[v.fixabilityBucket]}`}>
                {FIXABILITY_LABELS[v.fixabilityBucket]}
              </span>
            </div>
            <div className="text-xs text-muted-foreground truncate">{v.rootCauseCategory}</div>
            <div className="flex items-center">
              {v.contradictions.length > 0 && <AlertTriangle className="h-3.5 w-3.5 text-status-red" />}
            </div>
          </button>
        ))}
      </div>
    </ScrollArea>
  );
}

// ── Resource Drawer ────────────────────────────────────────

function ResourceDrawer({ resource: v, onClose }: { resource: VerifiedResource; onClose: () => void }) {
  const copyId = () => { navigator.clipboard.writeText(v.id); toast.success('Copied ID'); };

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
            <Field label="Enrichability" value={v.enrichability} />
          </Section>

          <Section title="Current State">
            <Field label="Enrichment Status" value={v.enrichmentStatusLabel} />
            <Field label="Quality Score" value={`${v.qualityScore}/100`} />
            <Field label="Quality Tier" value={v.qualityTier} />
            <Field label="Content Length" value={`${v.contentLength.toLocaleString()} chars`} />
            <Field label="Enrichment Version" value={`v${v.enrichmentVersion}`} />
            <Field label="Enriched At" value={v.enrichedAt || 'Never'} />
            <Field label="Last Attempt" value={v.lastAttemptAt || 'Never'} />
          </Section>

          <Section title="Failure Info">
            <Field label="Failure Bucket" value={v.failureBucket || 'None'} />
            <Field label="Failure Reason" value={v.failureReason || 'None'} />
            <Field label="Failure Count" value={String(v.failureCount)} />
            <Field label="Retry Eligible" value={v.retryEligible ? 'Yes' : 'No'} />
            <Field label="Quarantined" value={v.quarantined ? 'Yes' : 'No'} />
          </Section>

          {v.audioJobStatus && (
            <Section title="Audio Job">
              <Field label="Stage" value={v.audioJobStatus} />
              <Field label="Transcript Mode" value={v.transcriptMode || 'N/A'} />
              <Field label="Final Resolution" value={v.finalResolutionStatus || 'N/A'} />
              <Field label="Has Transcript" value={v.hasTranscript ? 'Yes' : 'No'} />
            </Section>
          )}

          <Section title={`Contradictions (${v.contradictions.length})`}>
            {v.contradictions.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-status-green">
                <CheckCircle2 className="h-4 w-4" /> No contradictions
              </div>
            ) : (
              <div className="space-y-2">
                {v.contradictions.map((c, i) => (
                  <div key={i} className={`rounded p-2 text-sm ${
                    c.severity === 'critical' ? 'bg-status-red/10 border border-status-red/30' :
                    c.severity === 'warning' ? 'bg-status-yellow/10 border border-status-yellow/30' :
                    'bg-muted border border-border'
                  }`}>
                    <div className="font-medium">{c.type}</div>
                    <div className="text-muted-foreground">{c.description}</div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Diagnosis">
            <Field label="Fixability" value={FIXABILITY_LABELS[v.fixabilityBucket]} />
            <Field label="Root Cause" value={v.rootCauseCategory} />
            <Field label="Why Not Complete" value={v.whyNotComplete} />
            <Field label="Recommended Action" value={v.recommendedAction} />
            <Field label="System Correct" value={v.isSystemBehaviorCorrect ? '✓ Yes' : '✗ No'} />
            <Field label="Misclassified" value={v.isMisclassified ? '✗ Yes' : '✓ No'} />
            <Field label="Stuck Wrong Queue" value={v.isStuckInWrongQueue ? '✗ Yes' : '✓ No'} />
            <Field label="Score/Status Contradict" value={v.scoreStatusContradict ? '✗ Yes' : '✓ No'} />
          </Section>
        </div>
      </div>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function Field({ label, value, copyable, onCopy, link }: {
  label: string; value: string; copyable?: boolean; onCopy?: () => void; link?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-2 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <span className="text-foreground text-right truncate">{value}</span>
        {copyable && onCopy && (
          <button onClick={onCopy} className="text-muted-foreground hover:text-foreground shrink-0">
            <Copy className="h-3 w-3" />
          </button>
        )}
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground shrink-0">
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}
