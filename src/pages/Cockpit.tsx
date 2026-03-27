/**
 * Daily Cockpit — Primary operating view.
 * Surfaces the best of existing systems in one glanceable surface.
 * Additive, feature-flagged, reversible.
 */

import { useMemo } from 'react';
import { useStore } from '@/store/useStore';
import { useOperatingState } from '@/hooks/useOperatingState';
import { usePrimaryAction } from '@/hooks/usePrimaryAction';
import { useStaleItems } from '@/hooks/useStaleItems';
import { usePlaybookRecommendation, type WorkflowContext } from '@/hooks/usePlaybookRecommendation';
import { useVoiceOperatingContext } from '@/hooks/useVoiceOperatingContext';
import { getSystemSummary } from '@/lib/systemGovernance';
import { getLedgerMetrics } from '@/lib/recommendationLedger';
import { getFrictionSummary } from '@/lib/frictionSignals';
import { isVoiceOSEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';
import { Zap, AlertTriangle, Radio, Shield, BarChart3, Brain, Mic, ChevronRight, Check, SkipForward, Ban } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useActionMemory } from '@/hooks/useActionMemory';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { Layout } from '@/components/Layout';

// ── Section Components ─────────────────────────────────────

function RightNowSection() {
  const { sentence, band } = useOperatingState();
  const primaryAction = usePrimaryAction();
  const { recordAction } = useActionMemory();
  const { opportunities } = useStore();

  const topDeals = useMemo(() => {
    return opportunities
      .filter(o => o.status === 'active')
      .sort((a, b) => (b.arr || 0) - (a.arr || 0))
      .slice(0, 3);
  }, [opportunities]);

  const BAND_DOT: Record<string, string> = {
    executing: 'bg-status-green',
    'on-pace': 'bg-primary',
    drifting: 'bg-status-yellow',
    reactive: 'bg-destructive',
  };

  const handleDone = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'completed', primaryAction.entityType, primaryAction.entityId);
    toast.success('Done — next action loading');
  };

  const handleSkip = () => {
    if (!primaryAction) return;
    recordAction(primaryAction.id, 'deferred', primaryAction.entityType, primaryAction.entityId);
    toast('Skipped');
  };

  return (
    <section className="space-y-3">
      {/* Operating state */}
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full shrink-0', BAND_DOT[band])} />
        <span className="text-sm font-medium text-foreground">{sentence}</span>
      </div>

      {/* Next best action */}
      {primaryAction && (
        <div className="rounded-lg border border-border/60 bg-card/80 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <Zap className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground leading-tight">{primaryAction.action}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{primaryAction.why}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ChevronRight className="h-3 w-3" />
            <span>{primaryAction.nextStep}</span>
          </div>
          {primaryAction.delayConsequence && (primaryAction.escalation === 'critical' || primaryAction.escalation === 'high') && (
            <p className="text-xs italic text-destructive">⚠ {primaryAction.delayConsequence}</p>
          )}
          <div className="flex gap-1.5 pt-1">
            <Button size="sm" variant="default" className="h-7 text-xs gap-1" onClick={handleDone}>
              <Check className="h-3 w-3" /> Done
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-muted-foreground" onClick={handleSkip}>
              <SkipForward className="h-3 w-3" /> Skip
            </Button>
          </div>
        </div>
      )}

      {/* Top 3 deals */}
      {topDeals.length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Top Deals</p>
          {topDeals.map(d => (
            <div key={d.id} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
              <span className="font-medium text-foreground truncate">{d.name}</span>
              <span className="text-muted-foreground shrink-0 ml-2">
                ${((d.arr || 0) / 1000).toFixed(0)}k · {d.stage || 'No stage'}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PlaybookSection() {
  const ctx: WorkflowContext = { blockType: 'meeting' };
  const rec = usePlaybookRecommendation(ctx);
  const navigate = useNavigate();

  if (!rec) return null;

  return (
    <section className="rounded-lg border border-border/60 bg-card/80 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <Brain className="h-4 w-4 text-primary shrink-0" />
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Recommended Playbook</p>
      </div>
      <p className="text-sm font-semibold text-foreground">{rec.playbook.title}</p>
      <p className="text-xs text-muted-foreground">{rec.reason}</p>
      <div className="flex gap-1.5 pt-1">
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => navigate('/coach')}>
          Practice
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigate('/prep')}>
          Apply
        </Button>
      </div>
    </section>
  );
}

function VoiceStateSection() {
  const { context } = useVoiceOperatingContext();
  const hasState = context.currentDeal || context.currentPlaybook || context.pendingAction || context.chainedWorkflow;

  if (!isVoiceOSEnabled() || !hasState) return null;

  return (
    <section className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
      <div className="flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-primary" />
        <p className="text-[10px] font-medium text-primary/80 uppercase tracking-wider">Dave Active</p>
      </div>
      {context.currentDeal && (
        <p className="text-xs text-foreground">Deal: <span className="font-medium">{context.currentDeal.name}</span></p>
      )}
      {context.currentPlaybook && (
        <p className="text-xs text-foreground">Playbook: <span className="font-medium">{context.currentPlaybook.title}</span></p>
      )}
      {context.pendingAction && (
        <p className="text-xs text-status-yellow">Pending: {context.pendingAction.description}</p>
      )}
      {context.chainedWorkflow && (
        <p className="text-xs text-muted-foreground">
          Step {context.chainedWorkflow.currentStep + 1}/{context.chainedWorkflow.steps.length}
          {context.chainedWorkflow.descriptions?.[context.chainedWorkflow.currentStep]
            ? ` — ${context.chainedWorkflow.descriptions[context.chainedWorkflow.currentStep]}`
            : ''}
        </p>
      )}
    </section>
  );
}

function RiskMonitorSection() {
  const { staleAccounts, oppsNoNextStep, atRiskRenewals } = useStaleItems();
  const friction = getFrictionSummary();

  const risks: { label: string; count: number; severity: 'high' | 'medium' | 'low' }[] = [];
  if (oppsNoNextStep > 0) risks.push({ label: 'Deals missing next step', count: oppsNoNextStep, severity: oppsNoNextStep >= 3 ? 'high' : 'medium' });
  if (atRiskRenewals > 0) risks.push({ label: 'At-risk renewals', count: atRiskRenewals, severity: 'high' });
  if (staleAccounts > 3) risks.push({ label: 'Stale accounts', count: staleAccounts, severity: staleAccounts >= 5 ? 'high' : 'medium' });
  if (friction.shouldReduceNudges) risks.push({ label: 'High friction — nudges suppressed', count: friction.totalFriction, severity: 'medium' });

  if (risks.length === 0) return null;

  const sevColor = { high: 'text-destructive', medium: 'text-status-yellow', low: 'text-muted-foreground' };

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 text-status-yellow shrink-0" />
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Risk Monitor</p>
      </div>
      {risks.map((r, i) => (
        <div key={i} className="flex items-center justify-between text-xs py-1 px-2 rounded bg-muted/30">
          <span className={cn('font-medium', sevColor[r.severity])}>{r.label}</span>
          <span className="text-muted-foreground">{r.count}</span>
        </div>
      ))}
    </section>
  );
}

function SystemStatusSection() {
  const summary = getSystemSummary();

  // Quiet when healthy
  if (summary.health === 'healthy' && summary.activeAlertCount === 0) return null;

  const healthColor = { healthy: 'text-status-green', degraded: 'text-status-yellow', critical: 'text-destructive' };

  return (
    <section className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
      <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs">
          <span className={cn('font-medium capitalize', healthColor[summary.health])}>{summary.health}</span>
          <span className="text-muted-foreground">· confidence {summary.confidence}%</span>
          {summary.mode !== 'normal' && <span className="text-status-yellow">· {summary.mode}</span>}
          {summary.activeAlertCount > 0 && <span className="text-destructive">· {summary.activeAlertCount} alert{summary.activeAlertCount > 1 ? 's' : ''}</span>}
        </div>
        {summary.topIssue && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{summary.topIssue}</p>}
      </div>
    </section>
  );
}

function LedgerSnapshotSection() {
  const metrics = getLedgerMetrics();

  if (metrics.totalEntries === 0) return null;

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <BarChart3 className="h-4 w-4 text-muted-foreground shrink-0" />
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Outcomes</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="text-center p-2 rounded bg-muted/30">
          <p className="text-lg font-bold text-foreground">{(metrics.systemRightRate * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-muted-foreground">Right rate</p>
        </div>
        <div className="text-center p-2 rounded bg-muted/30">
          <p className="text-lg font-bold text-foreground">{(metrics.ignoredHighConfidenceRate * 100).toFixed(0)}%</p>
          <p className="text-[10px] text-muted-foreground">Ignored high</p>
        </div>
        <div className="text-center p-2 rounded bg-muted/30">
          <p className="text-lg font-bold text-foreground">{metrics.totalEntries}</p>
          <p className="text-[10px] text-muted-foreground">Total recs</p>
        </div>
      </div>
    </section>
  );
}

function DaveQuickActions() {
  if (!isVoiceOSEnabled()) return null;

  const prompts = [
    'Walk me through my day',
    'Prep me for my next call',
    'Start a roleplay',
    'Draft my follow-up',
  ];

  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Mic className="h-4 w-4 text-primary shrink-0" />
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quick Voice</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {prompts.map(p => (
          <button
            key={p}
            className="text-xs px-2.5 py-1.5 rounded-full border border-border/60 bg-card/60 text-muted-foreground hover:text-foreground hover:border-primary/30 transition-colors"
            onClick={() => {
              // Dispatch to Dave input if available
              window.dispatchEvent(new CustomEvent('dave-quick-prompt', { detail: p }));
              toast(`Ask Dave: "${p}"`);
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}

// ── Main Cockpit Page ──────────────────────────────────────

export default function Cockpit() {
  return (
    <AppLayout title="Cockpit">
      <div className="max-w-xl mx-auto px-4 pt-2 pb-40 space-y-4">
        <RightNowSection />
        <VoiceStateSection />
        <PlaybookSection />
        <DaveQuickActions />
        <RiskMonitorSection />
        <SystemStatusSection />
        <LedgerSnapshotSection />
      </div>
    </AppLayout>
  );
}
