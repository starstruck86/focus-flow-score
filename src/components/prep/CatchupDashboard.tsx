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
import { aggregateRoutes, PIPELINE_LABELS, type Pipeline } from '@/lib/processingRoute';

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

const QUALITY_DISPLAY: Record<RunQuality, { icon: string; label: string; cls: string }> = {
  healthy: { icon: '●', label: 'Healthy', cls: 'bg-emerald-500/20 text-emerald-700 border-emerald-500/30 ring-emerald-500/10' },
  watch: { icon: '◐', label: 'Watch', cls: 'bg-amber-500/20 text-amber-700 border-amber-500/30 ring-amber-500/10' },
  risk: { icon: '▲', label: 'Risk', cls: 'bg-destructive/20 text-destructive border-destructive/30 ring-destructive/10' },
};

// ── Status header config ───────────────────────────────────
function getStatusHeader(
  status: string, mode: CatchupMode, currentPhase: CatchupPhase | null,
  snapshot: any, totalProcessed: number, totalItems: number,
) {
  const totalRes = snapshot?.total_resources || 0;
  const needsAction = snapshot?.needs_action || 0;

  if (status === 'scanning') return { dot: 'bg-primary animate-pulse', bg: 'bg-primary/6', border: 'border-primary/15', title: 'SCANNING LIBRARY', sub: 'Classifying resources against current standards…', activeLine: null };
  if (status === 'scanned' && mode === 'dry_run') return { dot: 'bg-blue-500', bg: 'bg-blue-500/6', border: 'border-blue-500/20', title: 'DRY RUN COMPLETE', sub: `${totalRes} resources scanned · ${needsAction} need action`, activeLine: null };
  if (status === 'scanned') return { dot: 'bg-amber-500', bg: 'bg-amber-500/6', border: 'border-amber-500/20', title: 'READY TO EXECUTE', sub: `${needsAction} resources queued for processing`, activeLine: null };
  if (status === 'running' && currentPhase) {
    const phaseLabel = PHASE_CONFIG[currentPhase].label.toUpperCase();
    return { dot: 'bg-primary animate-pulse', bg: 'bg-primary/6', border: 'border-primary/20', title: `RUNNING — ${phaseLabel}`, sub: `${totalProcessed} / ${totalItems} items processed`, activeLine: `Currently processing: ${PHASE_CONFIG[currentPhase].label}` };
  }
  if (status === 'completed') return { dot: 'bg-emerald-500', bg: 'bg-emerald-500/6', border: 'border-emerald-500/20', title: 'CATCH-UP COMPLETE', sub: `${totalProcessed} items processed across selected phases`, activeLine: null };
  if (status === 'cancelled') return { dot: 'bg-muted-foreground', bg: 'bg-muted/40', border: 'border-border', title: 'RUN CANCELLED', sub: `${totalProcessed} items processed before cancellation`, activeLine: null };
  return { dot: 'bg-muted-foreground', bg: '', border: '', title: 'RECONCILIATION', sub: '', activeLine: null };
}

// ── Next action — directive tone ───────────────────────────
function getNextAction(
  status: string, mode: CatchupMode, lastStep: string,
): { label: string; bold: string; buttonLabel?: string; buttonAction?: 'execute' | 'reset' } | null {
  if (status === 'scanned' && mode === 'dry_run')
    return { bold: 'Review bucket breakdown', label: '— then switch to Safe Auto-Fix and run enrichment only', buttonLabel: 'Run Preview', buttonAction: 'execute' };
  if (status === 'scanned' && mode === 'safe_auto_fix')
    return { bold: 'Run enrichment only', label: '— do not enable extraction until enrichment is validated', buttonAction: 'execute' };
  if (status === 'scanned' && mode === 'force_reprocess')
    return { bold: 'Validate with safe_auto_fix first', label: '— force reprocess should only follow a clean validation pass', buttonAction: 'execute' };
  if (status === 'completed' && lastStep === 'dry_run')
    return { bold: 'Switch to Safe Auto-Fix', label: '— run enrichment phase only', buttonLabel: 'New Run', buttonAction: 'reset' };
  if (status === 'completed' && lastStep === 'enrichment')
    return { bold: 'Validate enriched resources', label: '— before enabling extraction in a new run', buttonLabel: 'New Run', buttonAction: 'reset' };
  if (status === 'completed' && lastStep === 'extraction')
    return { bold: 'Validate KI outputs and readiness', label: '— then enable activation + QA surfacing', buttonLabel: 'New Run', buttonAction: 'reset' };
  if (status === 'completed' && lastStep === 'full')
    return { bold: 'Review QA-surfaced items', label: '— verify control center reflects updated state', buttonLabel: 'Done', buttonAction: 'reset' };
  if (status === 'cancelled')
    return { bold: 'Start a new dry run', label: '— re-assess library state', buttonLabel: 'New Run', buttonAction: 'reset' };
  return null;
}

// ── Phase warnings ─────────────────────────────────────────
function getPhaseWarnings(selected: CatchupPhase[], lastStep: string, mode: CatchupMode): { title: string; desc: string } | null {
  const idx = stepIndex(lastStep);
  if (mode === 'force_reprocess' && lastStep === 'none')
    return { title: 'Force Reprocess without prior validation', desc: 'Data may be overwritten. Run safe_auto_fix first to validate.' };
  if (selected.includes('extract') && idx < 1)
    return { title: 'Extraction before enrichment validation', desc: 'May produce poor KI outputs or mask upstream issues. Run enrichment-only first.' };
  if (selected.includes('activate') && idx < 2)
    return { title: 'Activation before extraction validation', desc: 'Activation without validated KIs may not meaningfully improve readiness.' };
  if (selected.includes('surface_to_qa') && idx < 2)
    return { title: 'QA surfacing selected early', desc: 'Complete enrichment and extraction before surfacing QA items.' };
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
        <CardContent className="py-4 px-4 space-y-3">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <h3 className="text-sm font-bold">Library Reconciliation</h3>
          </div>
          <p className="text-xs text-muted-foreground">
            Evaluate every resource against current standards. Follow the staged rollout:
          </p>
          <div className="flex items-center gap-0.5 text-[10px]">
            {ROLLOUT_STEPS.map((step, i) => (
              <React.Fragment key={step.key}>
                <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground">
                  <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full bg-muted text-[8px] font-bold">{i + 1}</span>
                  {step.label}
                </span>
                {i < ROLLOUT_STEPS.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/30 shrink-0" />}
              </React.Fragment>
            ))}
          </div>
          <div className="flex items-center gap-2">
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

  // ── Scanning ──────────────────────────────────────────────
  if (status === 'scanning') {
    return (
      <Card className="border-primary/20">
        <CardContent className="py-6 text-center space-y-1.5">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-primary" />
          <p className="text-sm font-bold tracking-wide">SCANNING LIBRARY</p>
          <p className="text-xs text-muted-foreground">Classifying every resource against current standards</p>
        </CardContent>
      </Card>
    );
  }

  // ── Error ─────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <Card className="border-destructive/30">
        <CardContent className="py-3 px-4">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-destructive shrink-0" />
            <p className="text-xs text-destructive flex-1">{error}</p>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={reset}>Dismiss</Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ── Active states ─────────────────────────────────────────
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
  const nextAction = getNextAction(status, mode, lastCompletedStep);

  const totalSucceeded = Object.values(phaseResults).reduce((s, p) => s + p.succeeded, 0);
  const totalFailed = Object.values(phaseResults).reduce((s, p) => s + p.failed, 0);

  const allBuckets = snapshot ? Object.entries(snapshot.buckets).filter(([, c]) => (c as number) > 0).sort(([, a], [, b]) => (b as number) - (a as number)) : [];
  const allIssues = snapshot ? Object.entries(snapshot.issue_breakdown).sort(([, a], [, b]) => (b as number) - (a as number)) : [];

  return (
    <Card className="overflow-hidden">
      {/* ═══ 1. STATUS HEADER ═══════════════════════════════════ */}
      <div className={cn(
        'px-4 py-3 border-b-2 transition-colors duration-300',
        statusHeader.bg,
        statusHeader.border,
      )}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {/* Title row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className={cn('h-3 w-3 rounded-full shrink-0 ring-2 ring-offset-1 ring-offset-background', statusHeader.dot,
                isRunning && 'ring-primary/30',
                isDone && status === 'completed' && 'ring-emerald-500/30',
                isDone && status === 'cancelled' && 'ring-muted-foreground/20',
                isScanned && 'ring-blue-500/20',
              )} />
              <h3 className="text-base font-black tracking-wide uppercase leading-none">{statusHeader.title}</h3>
              <Badge variant="outline" className="text-[9px] h-4 font-semibold">{MODE_LABELS[mode].label}</Badge>
            </div>
            {/* Run quality badge — prominent, right after title */}
            {runQuality && (
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={cn(
                  'inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ring-1',
                  QUALITY_DISPLAY[runQuality].cls,
                )}>
                  <span className="text-xs">{QUALITY_DISPLAY[runQuality].icon}</span>
                  {QUALITY_DISPLAY[runQuality].label}
                </span>
              </div>
            )}
            {/* Subtext */}
            <p className="text-[11px] text-muted-foreground leading-snug">{statusHeader.sub}</p>
            {/* Active processing line */}
            {statusHeader.activeLine && (
              <p className="text-xs text-primary font-bold animate-pulse">{statusHeader.activeLine}</p>
            )}
          </div>
          {/* Controls */}
          <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
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
          <div className="mt-2.5">
            <Progress value={globalProgress} className="h-2 transition-all duration-700" />
            <p className="text-[9px] text-muted-foreground mt-0.5 text-right font-mono tabular-nums">{globalProgress}%</p>
          </div>
        )}
      </div>

      <CardContent className="py-2 px-4 space-y-2">
        {/* ═══ 2. ROLLOUT STEP BAR ══════════════════════════════ */}
        <div className="flex items-center gap-0.5 text-[10px] py-0.5">
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
                  'flex items-center gap-1 px-1.5 py-0.5 rounded transition-all duration-300',
                  completed && 'bg-emerald-500/15 text-emerald-700 font-bold',
                  active && 'bg-primary/15 text-primary font-bold ring-1 ring-primary/20',
                  !completed && !active && 'text-muted-foreground/50 bg-muted/15',
                )}>
                  {active ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : completed ? (
                    <CheckCircle2 className="h-3 w-3" />
                  ) : (
                    <Circle className="h-3 w-3 opacity-25" />
                  )}
                  {step.label}
                </span>
                {i < ROLLOUT_STEPS.length - 1 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/20 shrink-0" />}
              </React.Fragment>
            );
          })}
        </div>

        {/* ═══ 3. PRIMARY ACTION BAR ════════════════════════════ */}
        {nextAction && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-primary/8 border border-primary/20 shadow-sm">
            <ArrowRight className="h-4 w-4 text-primary shrink-0" />
            <p className="text-xs flex-1 leading-snug">
              <span className="font-black">{nextAction.bold}</span>{' '}
              <span className="text-muted-foreground">{nextAction.label}</span>
            </p>
            {nextAction.buttonAction === 'execute' && isScanned && (
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5 shrink-0 shadow-md font-bold"
                onClick={() => executePhases()}
                disabled={selectedPhases.length === 0}
              >
                <Play className="h-3 w-3" />
                {mode === 'dry_run' ? 'Preview' : `Run ${selectedPhases.length}`}
              </Button>
            )}
            {nextAction.buttonAction === 'reset' && isDone && (
              <Button size="sm" variant="outline" className="h-8 text-xs shrink-0 font-semibold" onClick={reset}>
                {nextAction.buttonLabel}
              </Button>
            )}
          </div>
        )}

        {/* ═══ PHASE SAFETY WARNING ═════════════════════════════ */}
        {phaseWarning && (
          <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/15 border-2 border-destructive/30 shadow-sm">
            <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-black text-destructive uppercase tracking-wide">{phaseWarning.title}</p>
              <p className="text-[11px] text-destructive/80 mt-0.5 leading-snug">{phaseWarning.desc}</p>
            </div>
          </div>
        )}

        {/* ═══ 4. TRUST / PROGRESS METRICS ══════════════════════ */}
        <div className="flex flex-wrap gap-1.5 text-[10px]">
          <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-700 font-bold border border-emerald-500/15">
            <CheckCircle2 className="h-3 w-3" /> {healthPct}% healthy
          </span>
          {(snapshot?.needs_action || 0) > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-amber-700 font-medium border border-amber-500/15">
              {snapshot.needs_action} need action
            </span>
          )}
          {(snapshot?.qa_flagged || 0) > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-purple-500/10 text-purple-700 font-medium border border-purple-500/15">
              {snapshot.qa_flagged} QA flagged
            </span>
          )}
          {(snapshot?.low_confidence_routes || 0) > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-amber-500/10 text-amber-600 font-medium border border-amber-500/15">
              <AlertTriangle className="h-2.5 w-2.5" /> {snapshot.low_confidence_routes} low-confidence routes
            </span>
          )}
          {backfilled > 0 && (
            <span className="flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-muted-foreground border border-border/50">
              <RotateCcw className="h-2.5 w-2.5" /> {backfilled} repaired
            </span>
          )}
        </div>

        {/* ═══ 5. PHASE EXECUTION VIEW ══════════════════════════ */}
        {isScanned && mode !== 'dry_run' && (
          <div className="space-y-1">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest">Select Phases</p>
            <div className="grid grid-cols-2 gap-1.5">
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
                      'flex items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-pointer transition-all duration-200 text-xs',
                      checked ? 'border-primary/30 bg-primary/5 shadow-sm' : 'border-border/40 hover:bg-muted/30',
                    )}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => togglePhase(phase)} className="h-3.5 w-3.5" />
                    <Icon className={cn('h-3 w-3 shrink-0', pc.color)} />
                    <span className="flex-1 font-medium">{pc.label}</span>
                    <span className="font-mono text-muted-foreground text-[10px]">{count}</span>
                  </label>
                );
              })}
            </div>
          </div>
        )}

        {(isRunning || isDone) && (
          <div className="space-y-0.5">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Phase Progress</p>
            {(['enrich', 'extract', 'activate', 'surface_to_qa'] as CatchupPhase[]).map(phase => {
              const pr = phaseResults[phase];
              const pc = PHASE_CONFIG[phase];
              const Icon = pc.icon;
              const isActive = currentPhase === phase && isRunning;
              const phasePct = pr.total > 0 ? Math.round((pr.processed / pr.total) * 100) : (pr.status === 'complete' ? 100 : 0);
              const wasSkipped = pr.status === 'skipped';
              return (
                <div key={phase} className={cn(
                  'flex items-center gap-1.5 px-2 py-1 rounded transition-all duration-300',
                  isActive && 'bg-primary/8 ring-1 ring-primary/25 shadow-sm',
                  wasSkipped && 'opacity-25',
                )}>
                  <div className="w-[84px] text-[11px] flex items-center gap-1 shrink-0">
                    {isActive ? (
                      <Loader2 className={cn('h-3 w-3 animate-spin', pc.color)} />
                    ) : pr.status === 'complete' ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    ) : wasSkipped ? (
                      <span className="text-[10px]">—</span>
                    ) : (
                      <Circle className="h-3 w-3 opacity-20" />
                    )}
                    <span className={cn('font-semibold', isActive && 'text-primary font-bold')}>{pc.label}</span>
                  </div>
                  <Progress value={wasSkipped ? 0 : phasePct} className="h-1.5 flex-1 transition-all duration-700" />
                  <span className="text-[9px] font-mono w-14 text-right text-muted-foreground shrink-0 tabular-nums">
                    {wasSkipped ? 'skip' : pr.status === 'pending' ? '—' : `${pr.succeeded}ok${pr.failed > 0 ? ` ${pr.failed}✗` : ''}`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ═══ 6. WHAT CHANGED ══════════════════════════════════ */}
        {isDone && status === 'completed' && totalSucceeded > 0 && (
          <div className="p-2.5 rounded-lg bg-emerald-500/8 border border-emerald-500/20">
            <p className="text-[9px] font-black text-emerald-700 uppercase tracking-widest mb-1">What Changed</p>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px]">
              {phaseResults.enrich.succeeded > 0 && <span className="text-emerald-700 font-bold">+{phaseResults.enrich.succeeded} enriched</span>}
              {phaseResults.extract.succeeded > 0 && <span className="text-emerald-700 font-bold">+{phaseResults.extract.succeeded} extracted</span>}
              {phaseResults.activate.succeeded > 0 && <span className="text-emerald-700 font-bold">+{phaseResults.activate.succeeded} activated</span>}
              {phaseResults.surface_to_qa.qa_flagged > 0 && <span className="text-purple-700 font-bold">+{phaseResults.surface_to_qa.qa_flagged} QA surfaced</span>}
              {backfilled > 0 && <span className="text-muted-foreground font-medium">+{backfilled} repaired</span>}
              {totalFailed > 0 && <span className="text-destructive font-bold">{totalFailed} failed</span>}
            </div>
          </div>
        )}

        {/* ═══ 7. EXPANDABLE DETAILS ════════════════════════════ */}
        {snapshot && (allBuckets.length > 0 || allIssues.length > 0) && (
          <details className="text-xs group">
            <summary className="cursor-pointer text-[9px] font-bold text-muted-foreground uppercase tracking-widest hover:text-foreground transition-colors select-none py-0.5">
              Details
            </summary>
            <div className="mt-1 space-y-1.5">
              {/* Pipeline routing breakdown (derived from buckets) */}
              {(() => {
                const b = snapshot.buckets || {};
                const transcriptCount = (b.needs_enrichment || 0);
                const enrichExtract = (b.needs_extraction || 0) + (b.needs_re_extraction || 0);
                const directExtract = (b.needs_activation || 0);
                const manualAssist = (b.blocked || 0) + (b.needs_qa_review || 0);
                const hasPipeline = transcriptCount + enrichExtract + directExtract + manualAssist > 0;
                if (!hasPipeline) return null;
                return (
                  <div>
                    <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Pipeline Routing</p>
                    <div className="grid grid-cols-2 gap-1">
                      {transcriptCount > 0 && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/20 text-[10px]">
                          <Zap className="h-2.5 w-2.5 text-amber-600 shrink-0" />
                          <span className="flex-1">Enrich</span>
                          <span className="font-mono tabular-nums">{transcriptCount}</span>
                        </div>
                      )}
                      {enrichExtract > 0 && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/20 text-[10px]">
                          <FileText className="h-2.5 w-2.5 text-blue-600 shrink-0" />
                          <span className="flex-1">Extract</span>
                          <span className="font-mono tabular-nums">{enrichExtract}</span>
                        </div>
                      )}
                      {directExtract > 0 && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/20 text-[10px]">
                          <Activity className="h-2.5 w-2.5 text-emerald-600 shrink-0" />
                          <span className="flex-1">Activate</span>
                          <span className="font-mono tabular-nums">{directExtract}</span>
                        </div>
                      )}
                      {manualAssist > 0 && (
                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/20 text-[10px]">
                          <Eye className="h-2.5 w-2.5 text-purple-600 shrink-0" />
                          <span className="flex-1">Manual / QA</span>
                          <span className="font-mono tabular-nums">{manualAssist}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
              {allBuckets.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Buckets</p>
                  <div className="grid grid-cols-2 gap-1">
                    {allBuckets.map(([bucket, count]) => {
                      const config = BUCKET_CONFIG[bucket] || { label: bucket, icon: FileText, color: 'text-muted-foreground' };
                      const Icon = config.icon;
                      return (
                        <div key={bucket} className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted/20 text-[10px]">
                          <Icon className={cn('h-2.5 w-2.5 shrink-0', config.color)} />
                          <span className="truncate flex-1">{config.label}</span>
                          <span className="font-mono tabular-nums">{count as number}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {allIssues.length > 0 && (
                <div>
                  <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-0.5">Issues</p>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-0 text-[10px]">
                    {allIssues.map(([issue, count]) => (
                      <div key={issue} className="flex justify-between py-0.5">
                        <span className="text-muted-foreground truncate">{issue.replace(/_/g, ' ')}</span>
                        <span className="font-mono tabular-nums ml-1">{count as number}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </details>
        )}

        {error && (
          <div className="flex items-center gap-1.5 text-xs text-destructive p-2 rounded-md bg-destructive/8 border border-destructive/15">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
