/**
 * CatchupDashboard — Shows reconciliation run status, phase progress,
 * bucket breakdown, rollout guidance, and trust indicators.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertTriangle, CheckCircle2, Loader2, XCircle, Play, X,
  RotateCcw, Eye, Shield, Zap, FileText, Activity, Ban, Info,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useLibraryCatchup,
  type CatchupPhase,
  type CatchupMode,
} from '@/hooks/useLibraryCatchup';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ── Bucket display config ──────────────────────────────────
const BUCKET_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  no_action: { label: 'No Action', icon: CheckCircle2, color: 'text-emerald-600' },
  needs_enrichment: { label: 'Needs Enrichment', icon: Zap, color: 'text-amber-600' },
  needs_extraction: { label: 'Needs Extraction', icon: FileText, color: 'text-amber-600' },
  needs_activation: { label: 'Needs Activation', icon: Activity, color: 'text-blue-600' },
  needs_re_enrichment: { label: 'Re-Enrich', icon: RotateCcw, color: 'text-orange-600' },
  needs_re_extraction: { label: 'Re-Extract', icon: RotateCcw, color: 'text-orange-600' },
  needs_qa_review: { label: 'QA Review', icon: Eye, color: 'text-purple-600' },
  blocked: { label: 'Blocked', icon: Ban, color: 'text-destructive' },
};

const PHASE_LABELS: Record<CatchupPhase, string> = {
  enrich: 'Enrichment',
  extract: 'Extraction',
  activate: 'Activation',
  surface_to_qa: 'QA Surface',
};

const MODE_LABELS: Record<CatchupMode, { label: string; desc: string }> = {
  dry_run: { label: 'Dry Run', desc: 'Preview only — no changes' },
  safe_auto_fix: { label: 'Safe Auto-Fix', desc: 'Auto-process safe items' },
  force_reprocess: { label: 'Force Reprocess', desc: 'Reprocess all items (use with caution)' },
};

// ── Rollout guidance ───────────────────────────────────────
function getRolloutGuidance(
  mode: CatchupMode,
  status: string,
  lastStep: string,
  snapshot: any
): { text: string; severity: 'info' | 'warning' | 'success' } | null {
  if (status === 'scanned' && mode === 'dry_run') {
    const noAction = snapshot?.buckets?.no_action || 0;
    const total = snapshot?.total_resources || 0;
    const healthPct = total > 0 ? Math.round((noAction / total) * 100) : 0;
    return {
      text: `Dry run complete. ${healthPct}% healthy. Recommended: review buckets, then run safe_auto_fix on enrichment only.`,
      severity: 'info',
    };
  }
  if (status === 'scanned' && mode === 'safe_auto_fix') {
    return {
      text: 'Ready to execute. Start with enrichment phase only. Validate results before adding extraction.',
      severity: 'warning',
    };
  }
  if (status === 'scanned' && mode === 'force_reprocess') {
    return {
      text: '⚠️ Force reprocess will touch all items. Only use after validating with safe_auto_fix first.',
      severity: 'warning',
    };
  }
  if (status === 'completed' && lastStep === 'dry_run') {
    return {
      text: 'Preview complete. Next: switch to safe_auto_fix and run enrichment phase only.',
      severity: 'info',
    };
  }
  if (status === 'completed' && lastStep === 'enrichment') {
    return {
      text: 'Enrichment pass complete. Next: validate enriched resources, then run extraction phase.',
      severity: 'success',
    };
  }
  if (status === 'completed' && lastStep === 'extraction') {
    return {
      text: 'Extraction pass complete. Next: validate KI outputs, then run full catch-up with activation + QA.',
      severity: 'success',
    };
  }
  if (status === 'completed' && lastStep === 'full') {
    return {
      text: 'Full catch-up complete. Review QA-surfaced items and verify control center reflects updated state.',
      severity: 'success',
    };
  }
  return null;
}

export function CatchupDashboard() {
  const {
    status, mode, snapshot, currentPhase, phaseResults, error,
    startScan, executePhases, cancelRun, reset, selectedPhases, setSelectedPhases, lastCompletedStep,
  } = useLibraryCatchup();
  const [selectedMode, setSelectedMode] = React.useState<CatchupMode>('dry_run');

  const togglePhase = (phase: CatchupPhase) => {
    if (selectedPhases.includes(phase)) {
      setSelectedPhases(selectedPhases.filter(p => p !== phase));
    } else {
      setSelectedPhases([...selectedPhases, phase]);
    }
  };

  if (status === 'idle') {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4 px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex-1 min-w-[200px]">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Shield className="h-4 w-4 text-primary" />
                Library Reconciliation
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Evaluate every resource against current standards. Start with a dry run.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Select value={selectedMode} onValueChange={v => setSelectedMode(v as CatchupMode)}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(MODE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>
                      <span className="font-medium">{v.label}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startScan(selectedMode)}>
                <Play className="h-3 w-3" />
                Catch Up Library
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Scanning
  if (status === 'scanning') {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary mb-2" />
          <p className="text-sm font-medium">Scanning library…</p>
          <p className="text-xs text-muted-foreground mt-1">Classifying resources against current standards</p>
        </CardContent>
      </Card>
    );
  }

  // Error
  if (status === 'error') {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
            <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs" onClick={reset}>
              Dismiss
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Scanned / Running / Completed / Cancelled
  const totalNeeds = snapshot ? snapshot.needs_action : 0;
  const isRunning = status === 'running';
  const isDone = status === 'completed' || status === 'cancelled';
  const isScanned = status === 'scanned';

  // Compute global progress
  const totalProcessed = Object.values(phaseResults).reduce((s, p) => s + p.processed, 0);
  const totalItems = Object.values(phaseResults).reduce((s, p) => s + Math.max(p.total, p.processed), 0) || totalNeeds;
  const globalProgress = totalItems > 0 ? Math.round((totalProcessed / totalItems) * 100) : 0;

  // Rollout guidance
  const guidance = getRolloutGuidance(mode, status, lastCompletedStep, snapshot);

  // Trust indicators
  const noAction = snapshot?.buckets?.no_action || 0;
  const totalRes = snapshot?.total_resources || 0;
  const healthPct = totalRes > 0 ? Math.round((noAction / totalRes) * 100) : 0;
  const backfilled = snapshot?.backfilled_content_length || 0;

  return (
    <Card>
      <CardContent className="py-4 px-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <Shield className="h-4 w-4 text-primary" />
              Library Reconciliation
              <Badge variant="outline" className="text-[10px] ml-1">
                {MODE_LABELS[mode].label}
              </Badge>
              {status === 'completed' && (
                <Badge className="text-[10px] ml-1 bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  Complete
                </Badge>
              )}
              {status === 'cancelled' && (
                <Badge variant="destructive" className="text-[10px] ml-1">Cancelled</Badge>
              )}
            </h3>
            {snapshot && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {snapshot.total_resources} scanned · {totalNeeds} need action · {snapshot.qa_flagged} QA flagged
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {isScanned && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => executePhases()}
                disabled={selectedPhases.length === 0}
              >
                <Play className="h-3 w-3" />
                {mode === 'dry_run' ? 'Run Preview' : `Execute ${selectedPhases.length} phase${selectedPhases.length !== 1 ? 's' : ''}`}
              </Button>
            )}
            {isRunning && (
              <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={cancelRun}>
                <X className="h-3 w-3" /> Cancel
              </Button>
            )}
            {isDone && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>
                <X className="h-3 w-3 mr-1" /> Close
              </Button>
            )}
          </div>
        </div>

        {/* Rollout guidance */}
        {guidance && (
          <div className={cn(
            'flex items-start gap-2 text-xs p-2 rounded-md',
            guidance.severity === 'info' && 'bg-blue-500/10 text-blue-700',
            guidance.severity === 'warning' && 'bg-amber-500/10 text-amber-700',
            guidance.severity === 'success' && 'bg-emerald-500/10 text-emerald-700',
          )}>
            <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{guidance.text}</span>
          </div>
        )}

        {/* Phase selection (only when scanned + safe_auto_fix/force) */}
        {isScanned && mode !== 'dry_run' && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Select Phases to Run</p>
            <div className="flex flex-wrap gap-3">
              {(['enrich', 'extract', 'activate', 'surface_to_qa'] as CatchupPhase[]).map(phase => {
                const bucketKeys = phase === 'enrich' ? ['needs_enrichment', 'needs_re_enrichment']
                  : phase === 'extract' ? ['needs_extraction', 'needs_re_extraction']
                  : phase === 'activate' ? ['needs_activation']
                  : ['needs_qa_review', 'blocked'];
                const count = bucketKeys.reduce((s, k) => s + (snapshot?.buckets?.[k] || 0), 0);
                return (
                  <label key={phase} className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <Checkbox
                      checked={selectedPhases.includes(phase)}
                      onCheckedChange={() => togglePhase(phase)}
                    />
                    <span>{PHASE_LABELS[phase]}</span>
                    <span className="text-muted-foreground font-mono">({count})</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Trust indicators */}
        {snapshot && (
          <div className="flex flex-wrap gap-3 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600" />
              {healthPct}% healthy
            </span>
            <span>{Object.keys(snapshot.issue_breakdown).length} issue types</span>
            {backfilled > 0 && (
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" />
                {backfilled} content_length repaired
              </span>
            )}
          </div>
        )}

        {/* Global progress */}
        {(isRunning || isDone) && (
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>Global Progress</span>
              <span>{globalProgress}%</span>
            </div>
            <Progress value={globalProgress} className="h-2" />
          </div>
        )}

        {/* Bucket breakdown */}
        {snapshot && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(snapshot.buckets).map(([bucket, count]) => {
              const config = BUCKET_CONFIG[bucket] || { label: bucket, icon: FileText, color: 'text-muted-foreground' };
              const Icon = config.icon;
              return (
                <div key={bucket} className="flex items-center gap-1.5 text-xs">
                  <Icon className={cn('h-3 w-3 shrink-0', config.color)} />
                  <span className="truncate">{config.label}</span>
                  <span className="ml-auto font-mono font-medium">{count as number}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Phase progress */}
        {(isRunning || isDone) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Phase Progress</p>
            {(['enrich', 'extract', 'activate', 'surface_to_qa'] as CatchupPhase[]).map(phase => {
              const pr = phaseResults[phase];
              const isActive = currentPhase === phase && isRunning;
              const phasePct = pr.total > 0 ? Math.round((pr.processed / pr.total) * 100) : (pr.status === 'complete' ? 100 : 0);
              const wasSkipped = pr.status === 'skipped';
              return (
                <div key={phase} className={cn("flex items-center gap-2", wasSkipped && "opacity-40")}>
                  <div className="w-20 text-xs truncate flex items-center gap-1">
                    {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                    {pr.status === 'complete' && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />}
                    {wasSkipped && <span className="text-[10px] text-muted-foreground">—</span>}
                    {pr.status === 'pending' && <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />}
                    <span className={cn(isActive && 'font-medium text-primary')}>{PHASE_LABELS[phase]}</span>
                  </div>
                  <Progress value={wasSkipped ? 0 : phasePct} className="h-1.5 flex-1" />
                  <span className="text-[10px] font-mono w-16 text-right text-muted-foreground">
                    {wasSkipped ? 'skipped' : `${pr.succeeded}ok ${pr.failed > 0 ? `${pr.failed}❌` : ''}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Issue breakdown */}
        {snapshot && Object.keys(snapshot.issue_breakdown).length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
              Issue breakdown ({Object.keys(snapshot.issue_breakdown).length} types)
            </summary>
            <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {Object.entries(snapshot.issue_breakdown)
                .sort(([, a], [, b]) => (b as number) - (a as number))
                .map(([issue, count]) => (
                  <div key={issue} className="flex justify-between">
                    <span className="text-muted-foreground truncate">{issue.replace(/_/g, ' ')}</span>
                    <span className="font-mono ml-2">{count as number}</span>
                  </div>
                ))}
            </div>
          </details>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
