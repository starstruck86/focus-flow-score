/**
 * ProspectingEngine — daily prospecting execution widget.
 * Shows floor/target/stretch tiers, step-based workflow, risk alerts, and progress.
 */
import { motion } from 'framer-motion';
import { Target, TrendingUp, AlertTriangle, ChevronRight, Check, Zap, Flame } from 'lucide-react';
import { useProspectingEngine } from '@/hooks/useProspectingEngine';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { TierLevel, DailyTierTargets, ProspectingStep, ProspectingStepId } from '@/lib/prospectingEngine';

const TIER_CONFIG: Record<TierLevel, { label: string; icon: typeof Target; color: string }> = {
  floor: { label: 'Must Do', icon: Target, color: 'text-status-yellow' },
  target: { label: 'Target', icon: TrendingUp, color: 'text-primary' },
  stretch: { label: 'Stretch', icon: Flame, color: 'text-status-green' },
};

function TierRow({ level, targets, isActive }: { level: TierLevel; targets: DailyTierTargets; isActive: boolean }) {
  const config = TIER_CONFIG[level];
  const Icon = config.icon;
  return (
    <div className={cn(
      'flex items-center gap-3 rounded-lg px-3 py-2 border transition-colors',
      isActive ? 'border-primary/30 bg-primary/5' : 'border-border/30 bg-card/40',
    )}>
      <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
      <span className={cn('text-xs font-semibold w-16', config.color)}>{config.label}</span>
      <div className="flex-1 grid grid-cols-4 gap-2 text-xs text-muted-foreground">
        <span>{targets.accountsToWork} accts</span>
        <span>{targets.contactsToAdd} contacts</span>
        <span>{targets.cadencesToLaunch} cadences</span>
        <span>{targets.callsToMake} calls</span>
      </div>
      {isActive && <Badge variant="secondary" className="text-[10px] h-5">Current</Badge>}
    </div>
  );
}

function StepItem({ step, completed, isCurrent, onComplete }: {
  step: ProspectingStep;
  completed: boolean;
  isCurrent: boolean;
  onComplete: () => void;
}) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-all',
      isCurrent && 'bg-primary/10 border border-primary/20',
      completed && 'opacity-60',
    )}>
      <div className={cn(
        'w-5 h-5 rounded-full flex items-center justify-center shrink-0 border',
        completed ? 'bg-status-green/20 border-status-green text-status-green' : isCurrent ? 'border-primary text-primary' : 'border-border text-muted-foreground',
      )}>
        {completed ? <Check className="h-3 w-3" /> : <span className="text-[10px]">{step.order}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <span className={cn('font-medium', completed && 'line-through')}>{step.label}</span>
      </div>
      {isCurrent && !completed && (
        <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1 text-primary" onClick={onComplete}>
          Done <ChevronRight className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}

function MetricBar({ label, current, target, color }: { label: string; current: number; target: number; color: string }) {
  const pct = Math.min(100, target > 0 ? (current / target) * 100 : 0);
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{current}/{target}</span>
      </div>
      <Progress value={pct} className={cn('h-1.5', color)} />
    </div>
  );
}

export function ProspectingEngine() {
  const { plan, actuals, tierStatus, completeStep, steps } = useProspectingEngine();

  const tierOrder: TierLevel[] = ['floor', 'target', 'stretch'];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-border/50 bg-card p-4 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Prospecting Engine</h3>
        </div>
        {tierStatus.currentTier !== 'none' && (
          <Badge variant="outline" className={cn('text-[10px]', TIER_CONFIG[tierStatus.currentTier].color)}>
            {TIER_CONFIG[tierStatus.currentTier].label} hit
          </Badge>
        )}
      </div>

      {/* Adjustment reason */}
      {plan.adjustmentReason && (
        <p className="text-[11px] text-muted-foreground italic bg-muted/50 rounded-md px-2 py-1">
          ⚡ {plan.adjustmentReason}
        </p>
      )}

      {/* Risk Alerts */}
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

      {/* Tier Targets */}
      <div className="space-y-1.5">
        {tierOrder.map(tier => (
          <TierRow
            key={tier}
            level={tier}
            targets={plan[tier]}
            isActive={tierStatus.currentTier === tier}
          />
        ))}
      </div>

      {/* Progress Bars */}
      <div className="space-y-2 pt-1">
        <MetricBar label="Accounts" current={actuals.accountsWorked} target={plan.target.accountsToWork} color="" />
        <MetricBar label="Contacts" current={actuals.contactsAdded} target={plan.target.contactsToAdd} color="" />
        <MetricBar label="Cadences" current={actuals.cadencesLaunched} target={plan.target.cadencesToLaunch} color="" />
        <MetricBar label="Calls" current={actuals.callsMade} target={plan.target.callsToMake} color="" />
      </div>

      {/* Next Step Workflow */}
      <div className="space-y-1 pt-1">
        <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Next Step</p>
        {steps.map(step => (
          <StepItem
            key={step.id}
            step={step}
            completed={actuals.stepsCompleted.includes(step.id)}
            isCurrent={plan.nextAction.id === step.id}
            onComplete={() => completeStep(step.id as ProspectingStepId)}
          />
        ))}
      </div>

      {/* Weekly Summary */}
      <div className="grid grid-cols-2 gap-2 pt-1 text-[10px] text-muted-foreground bg-muted/30 rounded-md p-2">
        <span>Week: {plan.weeklyProgress.accountsAdded}/{plan.weeklyProgress.weeklyAccountTarget} accts</span>
        <span>{plan.weeklyProgress.contactsAdded}/{plan.weeklyProgress.weeklyContactTarget} contacts</span>
        <span>{plan.weeklyProgress.cadencesLaunched}/{plan.weeklyProgress.weeklyCadenceTarget} cadences</span>
        <span>{plan.weeklyProgress.daysRemaining} days left</span>
      </div>
    </motion.div>
  );
}
