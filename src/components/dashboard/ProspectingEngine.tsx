/**
 * ProspectingEngine — step-driven execution widget.
 * Centers on ONE "Next Action" card. Shows cycle progress, tier tracking,
 * and step breadcrumbs. Never a blank state.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Zap, Check, ChevronRight, AlertTriangle, ArrowRight,
  Target, TrendingUp, Flame, MessageCircle,
} from 'lucide-react';
import { useProspectingEngine } from '@/hooks/useProspectingEngine';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TierLevel, ProspectingStep, DailyTierTargets } from '@/lib/prospectingEngine';

const TIER_LABEL: Record<TierLevel, { text: string; color: string }> = {
  floor: { text: 'Must Do', color: 'text-status-yellow' },
  target: { text: 'Target', color: 'text-primary' },
  stretch: { text: 'Stretch', color: 'text-status-green' },
};

export function ProspectingEngine() {
  const {
    state, plan, tierStatus, nextAction, completeStep,
    currentCycle, cyclesCompleted, steps,
  } = useProspectingEngine();
  const [showDetail, setShowDetail] = useState(false);

  const { actuals } = state;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card p-4 space-y-3"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Prospecting Engine</h3>
        </div>
        <div className="flex items-center gap-1.5">
          {cyclesCompleted > 0 && (
            <Badge variant="secondary" className="text-[10px] h-5">
              {cyclesCompleted} cycle{cyclesCompleted !== 1 ? 's' : ''} ✓
            </Badge>
          )}
          {tierStatus.currentTier !== 'none' && (
            <Badge variant="outline" className={cn('text-[10px] h-5', TIER_LABEL[tierStatus.currentTier].color)}>
              {TIER_LABEL[tierStatus.currentTier].text}
            </Badge>
          )}
        </div>
      </div>

      {/* Adjustment / Risk */}
      {plan.adjustmentReason && (
        <p className="text-[11px] text-muted-foreground italic bg-muted/50 rounded-md px-2 py-1">
          ⚡ {plan.adjustmentReason}
        </p>
      )}
      {plan.riskAlerts.length > 0 && (
        <div className="space-y-1">
          {plan.riskAlerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-1.5 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
              <span>{alert}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── NEXT ACTION CARD (hero) ── */}
      <AnimatePresence mode="wait">
        <motion.div
          key={nextAction.step.id + '-' + nextAction.cycleIndex}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 8 }}
          className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2"
        >
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ArrowRight className="h-3 w-3" />
            <span>{nextAction.contextMessage}</span>
          </div>

          <p className="text-sm font-semibold text-foreground leading-tight">
            {nextAction.step.verb}
          </p>
          <p className="text-xs text-muted-foreground">
            {nextAction.step.description}
          </p>

          {/* Dave hint */}
          <div className="flex items-start gap-1.5 text-[10px] text-primary/70">
            <MessageCircle className="h-3 w-3 mt-0.5 shrink-0" />
            <span>{nextAction.step.daveHint}</span>
          </div>

          {/* Time estimate + Action button */}
          <div className="flex items-center justify-between pt-1">
            <span className="text-[10px] text-muted-foreground">
              ~{nextAction.step.estimateMinutes} min
            </span>
            <Button
              size="sm"
              className="h-7 text-xs gap-1"
              onClick={() => completeStep(nextAction.step.id, nextAction.accountName)}
            >
              <Check className="h-3 w-3" /> Done
            </Button>
          </div>
        </motion.div>
      </AnimatePresence>

      {/* ── CYCLE STEP BREADCRUMBS ── */}
      <div className="flex items-center gap-1 flex-wrap">
        {steps.map((step, i) => {
          const done = currentCycle?.completedSteps.includes(step.id) ?? false;
          const isCurrent = nextAction.step.id === step.id;
          return (
            <div key={step.id} className="flex items-center gap-1">
              <div
                className={cn(
                  'w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-medium border transition-colors',
                  done
                    ? 'bg-status-green/20 border-status-green text-status-green'
                    : isCurrent
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground',
                )}
                title={step.label}
              >
                {done ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className={cn('w-3 h-px', done ? 'bg-status-green/40' : 'bg-border')} />
              )}
            </div>
          );
        })}
        {currentCycle?.accountName && (
          <span className="text-[10px] text-muted-foreground ml-1 truncate max-w-[120px]">
            {currentCycle.accountName}
          </span>
        )}
      </div>

      {/* ── COMPACT PROGRESS ── */}
      <button
        onClick={() => setShowDetail(d => !d)}
        className="w-full flex items-center justify-between text-[10px] text-muted-foreground hover:text-foreground transition-colors pt-1"
      >
        <span>{state.totalStepsCompleted} steps today</span>
        <div className="flex items-center gap-2">
          <MetricChip label="Accts" val={actuals.accountsWorked} target={plan.target.accountsToWork} />
          <MetricChip label="Contacts" val={actuals.contactsAdded} target={plan.target.contactsToAdd} />
          <MetricChip label="Cadences" val={actuals.cadencesLaunched} target={plan.target.cadencesToLaunch} />
          <MetricChip label="Calls" val={actuals.callsMade} target={plan.target.callsToMake} />
          <ChevronRight className={cn('h-3 w-3 transition-transform', showDetail && 'rotate-90')} />
        </div>
      </button>

      {/* ── EXPANDED DETAIL ── */}
      <AnimatePresence>
        {showDetail && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden space-y-2"
          >
            {/* Tier targets */}
            <div className="space-y-1">
              {(['floor', 'target', 'stretch'] as TierLevel[]).map(tier => (
                <TierRow key={tier} tier={tier} targets={plan[tier]} active={tierStatus.currentTier === tier} />
              ))}
            </div>

            {/* Progress bars */}
            <div className="space-y-1.5">
              <ProgressBar label="Accounts" current={actuals.accountsWorked} target={plan.target.accountsToWork} />
              <ProgressBar label="Contacts" current={actuals.contactsAdded} target={plan.target.contactsToAdd} />
              <ProgressBar label="Cadences" current={actuals.cadencesLaunched} target={plan.target.cadencesToLaunch} />
              <ProgressBar label="Calls" current={actuals.callsMade} target={plan.target.callsToMake} />
            </div>

            {/* Weekly */}
            <div className="grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2">
              <span>Week: {plan.weeklyProgress.accountsAdded}/{plan.weeklyProgress.weeklyAccountTarget} accts</span>
              <span>{plan.weeklyProgress.contactsAdded}/{plan.weeklyProgress.weeklyContactTarget} contacts</span>
              <span>{plan.weeklyProgress.cadencesLaunched}/{plan.weeklyProgress.weeklyCadenceTarget} cadences</span>
              <span>{plan.weeklyProgress.daysRemaining} days left</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function MetricChip({ label, val, target }: { label: string; val: number; target: number }) {
  const done = val >= target && target > 0;
  return (
    <span className={cn('font-medium', done ? 'text-status-green' : '')}>
      {val}/{target}
    </span>
  );
}

function TierRow({ tier, targets, active }: { tier: TierLevel; targets: DailyTierTargets; active: boolean }) {
  const cfg = TIER_LABEL[tier];
  const Icon = tier === 'floor' ? Target : tier === 'target' ? TrendingUp : Flame;
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md px-2 py-1 text-[10px] border transition-colors',
      active ? 'border-primary/20 bg-primary/5' : 'border-transparent',
    )}>
      <Icon className={cn('h-3 w-3 shrink-0', cfg.color)} />
      <span className={cn('font-semibold w-12', cfg.color)}>{cfg.text}</span>
      <span className="text-muted-foreground">{targets.accountsToWork}a · {targets.contactsToAdd}c · {targets.cadencesToLaunch}cd · {targets.callsToMake}cl</span>
    </div>
  );
}

function ProgressBar({ label, current, target }: { label: string; current: number; target: number }) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{current}/{target}</span>
      </div>
      <Progress value={pct} className="h-1.5" />
    </div>
  );
}
