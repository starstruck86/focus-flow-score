/**
 * CatchupDashboard — Mission-control panel for library reconciliation.
 * Operator-instant: status, phase, health, next action — all within 3 seconds.
 */
import React from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertTriangle, CheckCircle2, Loader2, XCircle, Play, X,
  RotateCcw, Eye, Shield, Zap, FileText, Activity, Ban,
  ArrowRight, ShieldAlert, ChevronRight, Circle,
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

// ── Constants ──────────────────────────────────────────────
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

const PHASE_CONFIG: Record<CatchupPhase, { label: string; icon: React.ElementType; color: string }> = {
  enrich: { label: 'Enrichment', icon: Zap, color: 'text-amber-600' },
  extract: { label: 'Extraction', icon: FileText, color: 'text-blue-600' },
  activate: { label: 'Activation', icon: Activity, color: 'text-emerald-600' },
  surface_to_qa: { label: 'QA Surface', icon: Eye, color: 'text-purple-600' },
};

const MODE_LABELS: Record<CatchupMode, { label: string }> = {
  dry_run: { label: 'Dry Run' },
  safe_auto_fix: { label: 'Safe Auto-Fix' },
  force_reprocess: { label: 'Force Reprocess' },
};

const ROLLOUT_STEPS = [
  { key: 'dry_run', label: 'Dry Run' },
  { key: 'enrichment', label: 'Enrichment' },
  { key: 'extraction', label: 'Extraction' },
  { key: 'full', label: 'Activate + QA' },
] as const;

function stepIndex(step: string): number {
  return ROLLOUT_STEPS.findIndex(s => s.key === step);
}

// ── Run quality heuristic ──────────────────────────────────
type RunQuality = 'healthy' | 'watch' | 'risk';
function computeRunQuality(
  phaseResults: Record<CatchupPhase, { succeeded: number; failed: number; qa_flagged: number }>,
  snapshot: any,
  phaseWarning: string | null,
): RunQuality {
  const totalFailed = Object.values(phaseResults).reduce((s, p) => s + p.failed, 0);
  const totalSucceeded = Object.values(phaseResults).reduce((s, p) => s + p.succeeded, 0);
  const qaFlagged = snapshot?.qa_flagged || 0;
  if (phaseWarning || totalFailed > 5) return 'risk';
  if (totalFailed > 0 || qaFlagged > 10 || (totalSucceeded > 0 && totalFailed / (totalSucceeded + totalFailed) > 0.1)) return 'watch';
  return 'healthy';
}

const QUALITY_DISPLAY: Record<RunQuality, { label: string; color: string; bg: string }> = {
  healthy: { label: 'Healthy', color: 'text-emerald-700', bg: 'bg-emerald-500/10' },
  watch: { label: 'Watch', color: 'text-amber-700', bg: 'bg-amber-500/10' },
  risk: { label: 'Risk', color: 'text-destructive', bg: 'bg-destructive/10' },
};

// ── Status header config ───────────────────────────────────
function getStatusHeader(
  status: string, mode: CatchupMode, currentPhase: CatchupPhase | null,
  snapshot: any, totalProcessed: number, totalItems: number,
) {
  const totalRes = snapshot?.total_resources || 0;
  const needsAction = snapshot?.needs_action || 0;

  if (status === 'scanning') {
    return { dot: 'bg-primary animate-pulse', title: 'SCANNING LIBRARY', sub: 'Classifying resources against current standards…' };
  }
  if (status === 'scanned' && mode === 'dry_run') {
    return { dot: 'bg-blue-500', title: 'DRY RUN COMPLETE', sub: `${totalRes} resources scanned · ${needsAction} need action` };
  }
  if (status === 'scanned') {
    return { dot: 'bg-amber-500', title: 'READY TO EXECUTE', sub: `${needsAction} resources queued for processing` };
  }
  if (status === 'running' && currentPhase) {
    const phaseLabel = PHASE_CONFIG[currentPhase].label.toUpperCase();
    return { dot: 'bg-primary animate-pulse', title: `RUNNING — ${phaseLabel}`, sub: `Processing ${totalProcessed}/${totalItems} items` };
  }
  if (status === 'completed') {
    return { dot: 'bg-emerald-500', title: 'CATCH-UP COMPLETE', sub: `${totalProcessed} items processed across selected phases` };
  }
  if (status === 'cancelled') {
    return { dot: 'bg-muted-foreground', title: 'RUN CANCELLED', sub: `${totalProcessed} items were processed before cancellation` };
  }
  return { dot: 'bg-muted-foreground', title: 'RECONCILIATION', sub: '' };
}

// ── Next action recommendation ─────────────────────────────
function getNextAction(
  status: string, mode: CatchupMode, lastStep: string, snapshot: any,
): { label: string; buttonLabel?: string; buttonAction?: 'execute' | 'reset' } | null {
  if (status === 'scanned' && mode === 'dry_run') {
    return { label: 'Review buckets below, then switch to Safe Auto-Fix and run enrichment only.', buttonLabel: 'Run Preview', buttonAction: 'execute' };
  }
  if (status === 'scanned' && mode === 'safe_auto_fix') {
    return { label: 'Start with enrichment only. Do not enable extraction until enrichment is validated.', buttonAction: 'execute' };
  }
  if (status === 'scanned' && mode === 'force_reprocess') {
    return { label: 'Only use after safe_auto_fix has been validated. Consider enrichment-only first.', buttonAction: 'execute' };
  }
  if (status === 'completed' && lastStep === 'dry_run') {
    return { label: 'Close this run. Switch to Safe Auto-Fix and run enrichment phase only.', buttonLabel: 'Start New Run', buttonAction: 'reset' };
  }
  if (status === 'completed' && lastStep === 'enrichment') {
    return { label: 'Validate enriched resources in the control center. Then run a new dry run and enable extraction.', buttonLabel: 'Start New Run', buttonAction: 'reset' };
  }
  if (status === 'completed' && lastStep === 'extraction') {
    return { label: 'Validate KI outputs and readiness changes. Then enable activation + QA surfacing.', buttonLabel: 'Start New Run', buttonAction: 'reset' };
  }
  if (status === 'completed' && lastStep === 'full') {
    return { label: 'Review QA-surfaced items. Verify the control center reflects updated state.', buttonLabel: 'Done', buttonAction: 'reset' };
  }
  if (status === 'cancelled') {
    return { label: 'Run was cancelled. Start a new dry run to re-assess.', buttonLabel: 'Start New Run', buttonAction: 'reset' };
  }
  return null;
}

// ── Phase warnings ─────────────────────────────────────────
function getPhaseWarnings(selected: CatchupPhase[], lastStep: string, mode: CatchupMode): { title: string; desc: string } | null {
  const idx = stepIndex(lastStep);
  if (mode === 'force_reprocess' && lastStep === 'none') {
    return { title: 'Force Reprocess without prior validation', desc: 'Data may be overwritten. Run safe_auto_fix first to validate.' };
  }
  if (selected.includes('extract') && idx < 1) {
    return { title: 'Extraction before enrichment validation', desc: 'This may produce poor KI outputs or mask upstream issues. Run enrichment-only first.' };
  }
  if (selected.includes('activate') && idx < 2) {
    return { title: 'Activation before extraction validation', desc: 'Activation without validated KIs may not meaningfully improve readiness.' };
  }
  if (selected.includes('surface_to_qa') && idx < 2) {
    return { title: 'QA surfacing selected early', desc: 'Consider completing enrichment and extraction before surfacing QA items.' };
  }
  return null;
}

// ── Component ──────────────────────────────────────────────
export function CatchupDashboard() {
  const {
    status, mode, snapshot, currentPhase, phaseResults, error,
    startScan, executePhases, cancelRun, reset, selectedPhases, setSelectedPhases, lastCompletedStep,
  } = useLibraryCatchup();
  const [selectedMode, setSelectedMode] = React.useState<CatchupMode>('dry_run');

  const togglePhase = (phase: CatchupPhase) => {
    setSelectedPhases(
      selectedPhases.includes(phase)
        ? selectedPhases.filter(p => p !== phase)
        : [...selectedPhases, phase]
    );
  };

  // ── Idle state ────────────────────────────────────────────
  if (status === 'idle') {
    return (
      <Card className="border-dashed">
        <CardContent className="py-5 px-4 space-y-4">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold">Library Reconciliation</h3>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Evaluate every resource against current enrichment, extraction, and readiness standards.
            Follow the staged rollout below.
          </p>
          {/* Idle roadmap */}
          <div className="flex items-center gap-0.5 text-[10px]">
            {ROLLOUT_STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted/50 text-muted-foreground">
                  <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-muted text-[9px] font-bold">{i + 1}</span>
                  {step.label}
                </span>
                {i < ROLLOUT_STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />}
              </React.Fragment>
            ))}
          </div>
          {/* Launch */}
          <div className="flex items-center gap-2 pt-1">
            <Select value={selectedMode} onValueChange={v => setSelectedMode(v as CatchupMode)}>
              <SelectTrigger className="h-8 w-[150px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(MODE_LABELS).map(([k, v]) => (
                  <SelectItem key={k} value={k}><span className="font-medium">{v.label}</span></SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => startScan(selectedMode)}>
              <Play className="h-3 w-3" />
              {selectedMode === 'dry_run' ? 'Start Dry Run' : 'Start Catch-Up'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Scanning state ────────────────────────────────────────
  if (status === 'scanning') {
    return (
      <Card>
        <CardContent className="py-8 text-center space-y-2">
          <Loader2 className="h-7 w-7 animate-spin mx-auto text-primary" />
          <p className="text-sm font-semibold">Scanning Library…</p>
          <p className="text-xs text-muted-foreground">Classifying every resource against current standards</p>
        </CardContent>
      </Card>
    );
  }

  // ── Error state ───────────────────────────────────────────
  if (status === 'error') {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-4 px-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-sm text-destructive flex-1">{error}</p>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>Dismiss</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Active states (scanned / running / completed / cancelled) ──
  const isRunning = status === 'running';
  const isDone = status === 'completed' || status === 'cancelled';
  const isScanned = status === 'scanned';

  const totalProcessed = Object.values(phaseResults).reduce((s, p) => s + p.processed, 0);
  const totalItems = Object.values(phaseResults).reduce((s, p) => s + Math.max(p.total, p.processed), 0) || (snapshot?.needs_action || 0);
  const globalProgress = totalItems > 0 ? Math.round((totalProcessed / totalItems) * 100) : 0;

  const currentStepIdx = stepIndex(lastCompletedStep);
  const noAction = snapshot?.buckets?.no_action || 0;
  const totalRes = snapshot?.total_resources || 0;
  const healthPct = totalRes > 0 ? Math.round((noAction / totalRes) * 100) : 0;
  const backfilled = snapshot?.backfilled_content_length || 0;

  const phaseWarning = (isScanned && mode !== 'dry_run') ? getPhaseWarnings(selectedPhases, lastCompletedStep, mode) : null;
  const runQuality = (isRunning || isDone) ? computeRunQuality(phaseResults, snapshot, phaseWarning?.title || null) : null;
  const statusHeader = getStatusHeader(status, mode, currentPhase, snapshot, totalProcessed, totalItems);
  const nextAction = getNextAction(status, mode, lastCompletedStep, snapshot);

  // What Changed summary
  const totalSucceeded = Object.values(phaseResults).reduce((s, p) => s + p.succeeded, 0);
  const totalFailed = Object.values(phaseResults).reduce((s, p) => s + p.failed, 0);
  const totalQa = Object.values(phaseResults).reduce((s, p) => s + p.qa_flagged, 0);

  return (
    <Card className="overflow-hidden">
      {/* ── 1. STATUS HEADER ─────────────────────────────────── */}
      <div className={cn(
        'px-4 py-3 border-b',
        isRunning && 'bg-primary/5',
        isDone && status === 'completed' && 'bg-emerald-500/5',
        isDone && status === 'cancelled' && 'bg-muted/50',
        isScanned && mode === 'dry_run' && 'bg-blue-500/5',
        isScanned && mode !== 'dry_run' && 'bg-amber-500/5',
      )}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', statusHeader.dot)} />
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-xs font-bold tracking-wide uppercase">{statusHeader.title}</h3>
                <Badge variant="outline" className="text-[9px] h-4">{MODE_LABELS[mode].label}</Badge>
                {runQuality && (
                  <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded-full', QUALITY_DISPLAY[runQuality].bg, QUALITY_DISPLAY[runQuality].color)}>
                    {runQuality === 'healthy' ? '●' : runQuality === 'watch' ? '◐' : '▲'} {QUALITY_DISPLAY[runQuality].label}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">{statusHeader.sub}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
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
        {/* Global progress bar during run */}
        {isRunning && (
          <div className="mt-2">
            <Progress value={globalProgress} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-0.5 text-right">{globalProgress}%</p>
          </div>
        )}
      </div>

      <CardContent className="py-3 px-4 space-y-3">
        {/* ── 2. ROLLOUT STEP BAR ──────────────────────────────── */}
        <div className="flex items-center gap-0.5 text-[10px]">
          {ROLLOUT_STEPS.map((step, i) => {
            const completed = i <= currentStepIdx;
            const active = isRunning && (
              (step.key === 'enrichment' && currentPhase === 'enrich') ||
              (step.key === 'extraction' && currentPhase === 'extract') ||
              (step.key === 'full' && (currentPhase === 'activate' || currentPhase === 'surface_to_qa'))
            );
            return (
              <React.Fragment key={step.key}>
                <span className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md transition-colors',
                  completed && 'bg-emerald-500/10 text-emerald-700 font-semibold',
                  active && 'bg-primary/10 text-primary font-semibold',
                  !completed && !active && 'text-muted-foreground bg-muted/30',
                )}>
                  {active ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : completed ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3 opacity-40" />
                  )}
                  {step.label}
                </span>
                {i < ROLLOUT_STEPS.length - 1 && <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* ── 3. PRIMARY ACTION BAR ────────────────────────────── */}
        {nextAction && (
          <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted/40 border border-border/50">
            <ArrowRight className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-xs flex-1">{nextAction.label}</span>
            {nextAction.buttonAction === 'execute' && isScanned && (
              <Button
                size="sm"
                className="h-7 text-xs gap-1 shrink-0"
                onClick={() => executePhases()}
                disabled={selectedPhases.length === 0}
              >
                <Play className="h-3 w-3" />
                {mode === 'dry_run' ? 'Preview' : `Run ${selectedPhases.length} Phase${selectedPhases.length !== 1 ? 's' : ''}`}
              </Button>
            )}
            {nextAction.buttonAction === 'reset' && isDone && (
              <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={reset}>
                {nextAction.buttonLabel}
              </Button>
            )}
          </div>
        )}

        {/* ── PHASE SAFETY WARNING ─────────────────────────────── */}
        {phaseWarning && (
          <div className="flex items-start gap-2 p-2.5 rounded-md bg-destructive/10 border border-destructive/20">
            <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold text-destructive">{phaseWarning.title}</p>
              <p className="text-[11px] text-destructive/80 mt-0.5">{phaseWarning.desc}</p>
            </div>
          </div>
        )}

        {/* ── 4. TRUST / PROGRESS METRICS ──────────────────────── */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" />
            <span className="font-medium text-foreground">{healthPct}%</span> healthy
          </span>
          {(snapshot?.needs_action || 0) > 0 && (
            <span>{snapshot.needs_action} need action</span>
          )}
          {(snapshot?.qa_flagged || 0) > 0 && (
            <span>{snapshot.qa_flagged} QA flagged</span>
          )}
          {backfilled > 0 && (
            <span className="flex items-center gap-1">
              <RotateCcw className="h-2.5 w-2.5" /> {backfilled} repaired
            </span>
          )}
          {Object.keys(snapshot?.issue_breakdown || {}).length > 0 && (
            <span>{Object.keys(snapshot.issue_breakdown).length} issue types</span>
          )}
        </div>

        {/* ── 5. PHASE EXECUTION VIEW ──────────────────────────── */}
        {/* Phase selection (scanned + not dry_run) */}
        {isScanned && mode !== 'dry_run' && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Select Phases</p>
            <div className="grid grid-cols-2 gap-2">
              {(['enrich', 'extract', 'activate', 'surface_to_qa'] as CatchupPhase[]).map(phase => {
                const pc = PHASE_CONFIG[phase];
                const Icon = pc.icon;
                const bucketKeys = phase === 'enrich' ? ['needs_enrichment', 'needs_re_enrichment']
                  : phase === 'extract' ? ['needs_extraction', 'needs_re_extraction']
                  : phase === 'activate' ? ['needs_activation']
                  : ['needs_qa_review', 'blocked'];
                const count = bucketKeys.reduce((s, k) => s + (snapshot?.buckets?.[k] || 0), 0);
                const checked = selectedPhases.includes(phase);
                return (
                  <label
                    key={phase}
                    className={cn(
                      'flex items-center gap-2 px-2.5 py-2 rounded-md border cursor-pointer transition-colors text-xs',
                      checked ? 'border-primary/30 bg-primary/5' : 'border-border/50 bg-background hover:bg-muted/30',
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => togglePhase(phase)} />
                    <Icon className={cn('h-3.5 w-3.5 shrink-0', pc.color)} />
                    <span className="flex-1 font-medium">{pc.label}</span>
                    <span className="font-mono text-muted-foreground">{count}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {/* Phase progress (running / done) */}
        {(isRunning || isDone) && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Phase Progress</p>
            {(['enrich', 'extract', 'activate', 'surface_to_qa'] as CatchupPhase[]).map(phase => {
              const pr = phaseResults[phase];
              const pc = PHASE_CONFIG[phase];
              const Icon = pc.icon;
              const isActive = currentPhase === phase && isRunning;
              const phasePct = pr.total > 0 ? Math.round((pr.processed / pr.total) * 100) : (pr.status === 'complete' ? 100 : 0);
              const wasSkipped = pr.status === 'skipped';
              return (
                <div key={phase} className={cn(
                  'flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors',
                  isActive && 'bg-primary/5 border border-primary/20',
                  wasSkipped && 'opacity-35',
                )}>
                  <div className="w-24 text-xs flex items-center gap-1.5 shrink-0">
                    {isActive ? (
                      <Loader2 className={cn('h-3 w-3 animate-spin', pc.color)} />
                    ) : pr.status === 'complete' ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ) : wasSkipped ? (
                      <span className="text-[10px]">—</span>
                    ) : (
                      <Circle className="h-3 w-3 opacity-30" />
                    )}
                    <span className={cn('font-medium', isActive && 'text-primary')}>{pc.label}</span>
                  </div>
                  <Progress value={wasSkipped ? 0 : phasePct} className="h-1.5 flex-1" />
                  <span className="text-[10px] font-mono w-20 text-right text-muted-foreground shrink-0">
                    {wasSkipped ? 'skipped' : pr.status === 'pending' ? '—' : `${pr.succeeded} ok${pr.failed > 0 ? ` · ${pr.failed}✗` : ''}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── WHAT CHANGED (completion summary) ────────────────── */}
        {isDone && status === 'completed' && totalSucceeded > 0 && (
          <div className="p-2.5 rounded-md bg-emerald-500/5 border border-emerald-500/15 space-y-1">
            <p className="text-[10px] font-semibold text-emerald-700 uppercase tracking-wider">What Changed</p>
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
              {phaseResults.enrich.succeeded > 0 && (
                <span className="text-emerald-700">+{phaseResults.enrich.succeeded} enriched</span>
              )}
              {phaseResults.extract.succeeded > 0 && (
                <span className="text-emerald-700">+{phaseResults.extract.succeeded} extracted</span>
              )}
              {phaseResults.activate.succeeded > 0 && (
                <span className="text-emerald-700">+{phaseResults.activate.succeeded} activated</span>
              )}
              {phaseResults.surface_to_qa.qa_flagged > 0 && (
                <span className="text-purple-700">+{phaseResults.surface_to_qa.qa_flagged} surfaced to QA</span>
              )}
              {backfilled > 0 && (
                <span className="text-muted-foreground">+{backfilled} content_length repaired</span>
              )}
              {totalFailed > 0 && (
                <span className="text-destructive">{totalFailed} failed</span>
              )}
            </div>
          </div>
        )}

        {/* ── 6. EXPANDABLE DETAILS ────────────────────────────── */}
        {snapshot && (
          <details className="text-xs group">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground text-[10px] font-medium uppercase tracking-wider">
              Bucket & Issue Details
            </summary>
            <div className="mt-2 space-y-3">
              {/* Bucket breakdown */}
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(snapshot.buckets).map(([bucket, count]) => {
                  const config = BUCKET_CONFIG[bucket] || { label: bucket, icon: FileText, color: 'text-muted-foreground' };
                  const Icon = config.icon;
                  return (
                    <div key={bucket} className="flex items-center gap-1.5 px-2 py-1 rounded bg-muted/30">
                      <Icon className={cn('h-3 w-3 shrink-0', config.color)} />
                      <span className="truncate flex-1">{config.label}</span>
                      <span className="font-mono font-medium">{count as number}</span>
                    </div>
                  );
                })}
              </div>
              {/* Issue breakdown */}
              {Object.keys(snapshot.issue_breakdown).length > 0 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {Object.entries(snapshot.issue_breakdown)
                    .sort(([, a], [, b]) => (b as number) - (a as number))
                    .map(([issue, count]) => (
                      <div key={issue} className="flex justify-between">
                        <span className="text-muted-foreground truncate">{issue.replace(/_/g, ' ')}</span>
                        <span className="font-mono ml-2">{count as number}</span>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </details>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive p-2 rounded-md bg-destructive/5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}