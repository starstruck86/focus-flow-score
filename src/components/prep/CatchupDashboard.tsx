/**
 * CatchupDashboard — Shows reconciliation run status, phase progress,
 * bucket breakdown, and final report inline in the control center.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertTriangle, CheckCircle2, Loader2, XCircle, Play, X,
  RotateCcw, Eye, Shield, Zap, FileText, Activity, Ban,
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
  force_reprocess: { label: 'Force Reprocess', desc: 'Reprocess all items' },
};

export function CatchupDashboard() {
  const {
    status, mode, snapshot, currentPhase, phaseResults, error,
    startScan, executePhases, cancelRun, reset,
  } = useLibraryCatchup();
  const [selectedMode, setSelectedMode] = React.useState<CatchupMode>('dry_run');

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
                Evaluate every resource against current standards and bring the library up to date.
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

  // Compute global progress
  const totalProcessed = Object.values(phaseResults).reduce((s, p) => s + p.processed, 0);
  const totalItems = Object.values(phaseResults).reduce((s, p) => s + Math.max(p.total, p.processed), 0) || totalNeeds;
  const globalProgress = totalItems > 0 ? Math.round((totalProcessed / totalItems) * 100) : 0;

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
                {snapshot.total_resources} resources scanned · {totalNeeds} need action · {snapshot.qa_flagged} flagged for QA
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {status === 'scanned' && (
              <Button size="sm" className="h-7 text-xs gap-1" onClick={executePhases}>
                <Play className="h-3 w-3" />
                {mode === 'dry_run' ? 'Run Preview' : 'Execute'}
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
              return (
                <div key={phase} className="flex items-center gap-2">
                  <div className="w-20 text-xs truncate flex items-center gap-1">
                    {isActive && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
                    {pr.status === 'complete' && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />}
                    {pr.status === 'pending' && <div className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />}
                    <span className={cn(isActive && 'font-medium text-primary')}>{PHASE_LABELS[phase]}</span>
                  </div>
                  <Progress value={phasePct} className="h-1.5 flex-1" />
                  <span className="text-[10px] font-mono w-16 text-right text-muted-foreground">
                    {pr.succeeded}ok {pr.failed > 0 ? `${pr.failed}❌` : ''}
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
