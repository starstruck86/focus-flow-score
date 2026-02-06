import { 
  Flame, 
  Zap, 
  Target, 
  TrendingUp,
  CheckCircle2,
  XCircle,
  Award,
} from 'lucide-react';
import { RingGauge } from '@/components/RingGauge';
import { cn } from '@/lib/utils';
import type { ActivityTotals, PreparednessInputs, RecoveryJournalInputs } from '@/types/journal';

interface ReviewStepProps {
  activity: ActivityTotals;
  preparedness: PreparednessInputs;
  recovery: RecoveryJournalInputs;
  scores: {
    dailyScore: number;
    salesStrain: number;
    salesRecovery: number;
    salesProductivity: number;
    goalMet: boolean;
  };
}

export function ReviewStep({ activity, preparedness, recovery, scores }: ReviewStepProps) {
  const strainBand = scores.salesStrain <= 6 ? 'low' : scores.salesStrain <= 11 ? 'moderate' : scores.salesStrain <= 16 ? 'high' : 'very-high';
  const recoveryBand = scores.salesRecovery >= 67 ? 'green' : scores.salesRecovery >= 34 ? 'yellow' : 'red';
  
  return (
    <div className="space-y-6">
      {/* Goal Status */}
      <div className={cn(
        "p-4 rounded-xl border-2 text-center",
        scores.goalMet 
          ? "bg-status-green/10 border-status-green/30" 
          : "bg-muted/50 border-border"
      )}>
        <div className="flex items-center justify-center gap-2 mb-2">
          {scores.goalMet ? (
            <CheckCircle2 className="h-6 w-6 text-status-green" />
          ) : (
            <XCircle className="h-6 w-6 text-muted-foreground" />
          )}
          <span className={cn(
            "text-lg font-semibold",
            scores.goalMet ? "text-status-green" : "text-muted-foreground"
          )}>
            {scores.goalMet ? "Goal Met! 🔥" : "Goal Not Met"}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {scores.goalMet 
            ? "Your streak will continue!" 
            : `Daily Score: ${scores.dailyScore}/8 • Productivity: ${scores.salesProductivity}%/75%`
          }
        </p>
      </div>
      
      {/* Score Gauges */}
      <div className="grid grid-cols-3 gap-4">
        <div className="text-center">
          <div className="flex justify-center mb-2">
            <RingGauge
              value={scores.salesStrain}
              max={21}
              type="strain"
              size={90}
            />
          </div>
          <div className="flex items-center justify-center gap-1">
            <Flame className="h-4 w-4 text-strain" />
            <span className="text-sm font-medium">Strain</span>
          </div>
          <span className="text-xs text-muted-foreground capitalize">{strainBand}</span>
        </div>
        
        <div className="text-center">
          <div className="flex justify-center mb-2">
            <RingGauge
              value={scores.salesRecovery}
              max={100}
              type="recovery"
              size={90}
              label="%"
            />
          </div>
          <div className="flex items-center justify-center gap-1">
            <Zap className="h-4 w-4 text-recovery" />
            <span className="text-sm font-medium">Recovery</span>
          </div>
          <span className={cn(
            "text-xs capitalize",
            recoveryBand === 'green' && 'text-status-green',
            recoveryBand === 'yellow' && 'text-status-yellow',
            recoveryBand === 'red' && 'text-status-red',
          )}>{recoveryBand}</span>
        </div>
        
        <div className="text-center">
          <div className="flex justify-center mb-2">
            <RingGauge
              value={scores.salesProductivity}
              max={100}
              type="productivity"
              size={90}
              label="%"
            />
          </div>
          <div className="flex items-center justify-center gap-1">
            <Target className="h-4 w-4 text-productivity" />
            <span className="text-sm font-medium">Productivity</span>
          </div>
        </div>
      </div>
      
      {/* Summary Stats */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Today's Summary
        </h4>
        
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Daily Score</span>
              <span className={cn(
                "font-mono font-bold",
                scores.dailyScore >= 8 ? "text-status-green" : "text-foreground"
              )}>
                {scores.dailyScore}/8
              </span>
            </div>
          </div>
          
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Conversations</span>
              <span className="font-mono font-bold">{activity.conversations}</span>
            </div>
          </div>
          
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Meetings Set</span>
              <span className="font-mono font-bold">{activity.meetingsSet}</span>
            </div>
          </div>
          
          <div className="p-3 bg-secondary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Opps Created</span>
              <span className="font-mono font-bold">{activity.opportunitiesCreated}</span>
            </div>
          </div>
        </div>
        
        {/* Preparedness Summary */}
        <div className="p-3 bg-secondary/30 rounded-lg space-y-2">
          <span className="text-xs text-muted-foreground">Preparedness</span>
          <div className="flex items-center gap-4 text-sm">
            <span>{preparedness.accountsResearched} accounts researched</span>
            <span>{preparedness.contactsPrepped} contacts prepped</span>
          </div>
          {preparedness.preppedForAllCallsTomorrow === false && (
            <p className="text-xs text-amber-500">
              ⚠️ {preparedness.callsNeedPrepCount} calls need prep for tomorrow
            </p>
          )}
        </div>
        
        {/* Recovery Summary */}
        <div className="p-3 bg-secondary/30 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Sleep: {recovery.sleepHours}hrs</span>
            <span className="text-muted-foreground">Energy: {recovery.energy}/5</span>
            <span className="text-muted-foreground">Stress: {recovery.stress}/5</span>
          </div>
        </div>
      </div>
    </div>
  );
}
