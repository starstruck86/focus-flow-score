/**
 * ExecutionHUD — Compact operator strip for active execution context.
 *
 * Always-useful, calm summary: active account, mode, discipline,
 * last outcome, next action, ready count, carry-forward, momentum, score.
 */

import { useExecutionSession, evaluatePrepActionEnforcement, type ExecutionMode, type MomentumPace } from '@/lib/executionSession';
import { isExecutionSessionLayerEnabled, isExecutionMomentumEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';
import {
  Target, Phone, PhoneOff, Voicemail, Calendar,
  ArrowRight, Users, Zap, Pause, Lock, Play,
  TrendingUp, AlertTriangle,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const MODE_LABELS: Record<ExecutionMode, { label: string; color: string }> = {
  prep: { label: 'Prep', color: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  action: { label: 'Action', color: 'bg-primary/15 text-primary border-primary/30' },
  follow_up: { label: 'Follow-up', color: 'bg-status-yellow/15 text-status-yellow border-status-yellow/30' },
  roleplay: { label: 'Roleplay', color: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  idle: { label: 'Idle', color: 'bg-muted text-muted-foreground border-border' },
};

const PACE_LABELS: Record<MomentumPace, { label: string; color: string }> = {
  fast: { label: '🔥 Fast', color: 'text-status-green' },
  normal: { label: '→ Normal', color: 'text-muted-foreground' },
  slow: { label: '⏳ Slow', color: 'text-status-yellow' },
  stalled: { label: '⛔ Stalled', color: 'text-destructive' },
};

const OUTCOME_ICONS: Record<string, typeof Phone> = {
  no_answer: PhoneOff,
  voicemail: Voicemail,
  connected: Phone,
  meeting_booked: Calendar,
  follow_up_needed: ArrowRight,
};

export function ExecutionHUD() {
  if (!isExecutionSessionLayerEnabled()) return null;

  const { activeSession, mode, disciplineMode, scorecard, momentum } = useExecutionSession();
  const modeInfo = MODE_LABELS[mode];
  const hasSession = !!activeSession;
  const enforcement = evaluatePrepActionEnforcement();
  const showMomentum = isExecutionMomentumEnabled();

  return (
    <div className="flex items-center gap-2 flex-wrap text-[11px]">
      {/* Mode badge */}
      <Badge variant="outline" className={cn('h-5 px-1.5 text-[10px] font-semibold border', modeInfo.color)}>
        {modeInfo.label}
      </Badge>

      {/* Strict mode indicator */}
      {disciplineMode === 'strict' && (
        <Badge variant="outline" className="h-5 px-1.5 text-[10px] font-semibold border border-destructive/30 bg-destructive/10 text-destructive">
          <Lock className="h-2.5 w-2.5 mr-0.5" />
          Strict
        </Badge>
      )}

      {/* Active account */}
      {hasSession && (
        <span className="font-medium text-foreground truncate max-w-[120px]">
          {activeSession.accountName}
        </span>
      )}

      {/* Last outcome */}
      {hasSession && activeSession.latestOutcome && (() => {
        const Icon = OUTCOME_ICONS[activeSession.latestOutcome] || Zap;
        return (
          <span className="flex items-center gap-0.5 text-muted-foreground">
            <Icon className="h-3 w-3" />
            <span>{activeSession.latestOutcome.replace(/_/g, ' ')}</span>
          </span>
        );
      })()}

      {/* Post-action recommendation */}
      {hasSession && activeSession.postActionRecommendation && (
        <span className="text-muted-foreground">
          → {activeSession.postActionRecommendation.decision.replace(/_/g, ' ')}
        </span>
      )}

      {/* Prep/Action enforcement nudge */}
      {!hasSession && enforcement.shouldBeInPrep && mode !== 'prep' && mode !== 'roleplay' && (
        <span className="flex items-center gap-0.5 text-status-yellow">
          <AlertTriangle className="h-3 w-3" />
          <span>No ready accounts — prep first</span>
        </span>
      )}

      {/* Separator */}
      <span className="text-border">|</span>

      {/* Momentum */}
      {showMomentum && mode === 'action' && (
        <>
          <span className={cn('text-[10px] font-medium', PACE_LABELS[momentum.pace].color)}>
            {PACE_LABELS[momentum.pace].label}
          </span>
          <span className="text-border">|</span>
        </>
      )}

      {/* Scorecard compact */}
      <span className="flex items-center gap-2 text-muted-foreground">
        <span className="flex items-center gap-0.5">
          <Users className="h-3 w-3" />
          <span className="font-mono">{scorecard.accountsWorked}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <Phone className="h-3 w-3" />
          <span className="font-mono">{scorecard.connects}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <Calendar className="h-3 w-3" />
          <span className="font-mono">{scorecard.meetingsBooked}</span>
        </span>
        <span className="flex items-center gap-0.5">
          <Target className="h-3 w-3" />
          <span className="font-mono">{scorecard.readyRemaining}</span>
          <span className="text-[9px]">left</span>
        </span>
        {scorecard.carryForwardCreated > 0 && (
          <span className="flex items-center gap-0.5 text-status-yellow">
            <Pause className="h-3 w-3" />
            <span className="font-mono">{scorecard.carryForwardCreated}</span>
          </span>
        )}
      </span>
    </div>
  );
}
