/**
 * System Debug Panel — lightweight operator inspection surface
 *
 * Shows full execution session state, flags, momentum, autopilot,
 * strict mode, prep/action enforcement, and fallback matrix.
 */

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Bug, RefreshCw } from 'lucide-react';
import { captureDebugSnapshot, type SystemDebugSnapshot } from '@/lib/loopRuntime';
import {
  isLoopNativeSchedulerEnabled,
  isRoleplayGroundingEnabled,
  isAccountExecutionModelEnabled,
  isAccountCentricExecutionEnabled,
  isExecutionSessionLayerEnabled,
  isStrictExecutionModeEnabled,
  isSessionAutopilotEnabled,
  isExecutionMomentumEnabled,
} from '@/lib/featureFlags';
import { getDoctrineGovernanceStats, getLegacyHydratedCount } from '@/lib/salesBrain';
import { getActualUsageCounts } from '@/lib/salesBrain/doctrineUsage';
import { getAudioPipelineHealth } from '@/lib/salesBrain/audioPipeline';
import { loadMeasurementEvents } from '@/lib/accountPostAction';
import {
  useExecutionSession,
  buildScorecard,
  getNextBestAccounts,
  evaluatePrepActionEnforcement,
  FALLBACK_MATRIX,
} from '@/lib/executionSession';

export function SystemDebugPanel() {
  const [snapshot, setSnapshot] = useState<SystemDebugSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    try {
      const today = new Date().toISOString().split('T')[0];
      let planBlocks: any[] | undefined;
      let serverMeta: any[] | undefined;
      try {
        const planKey = `daily-plan-blocks-${today}`;
        const raw = localStorage.getItem(planKey);
        planBlocks = raw ? JSON.parse(raw) : undefined;
      } catch {}
      try {
        const metaKey = `loop-server-meta-${today}`;
        const raw = localStorage.getItem(metaKey);
        serverMeta = raw ? JSON.parse(raw) : undefined;
      } catch {}
      setSnapshot(captureDebugSnapshot(planBlocks, serverMeta));
    } catch {
      setSnapshot(captureDebugSnapshot());
    }
  }, []);

  const toggle = useCallback(() => {
    setOpen(v => {
      if (!v) refresh();
      return !v;
    });
  }, [refresh]);

  // Flags
  const loopEnabled = isLoopNativeSchedulerEnabled();
  const groundingEnabled = isRoleplayGroundingEnabled();
  const acctEnabled = isAccountExecutionModelEnabled();
  const acctCentricEnabled = isAccountCentricExecutionEnabled();
  const sessionEnabled = isExecutionSessionLayerEnabled();
  const strictEnabled = isStrictExecutionModeEnabled();
  const autopilotEnabled = isSessionAutopilotEnabled();
  const momentumEnabled = isExecutionMomentumEnabled();
  const measurementCount = loadMeasurementEvents().length;
  const brainStats = getDoctrineGovernanceStats();
  const legacyCount = getLegacyHydratedCount();
  const actualUsage = getActualUsageCounts();
  const audioHealth = getAudioPipelineHealth();
  const { activeSession, mode, disciplineMode, scorecard, momentum, autopilotLog, overrides } = useExecutionSession();
  const nextCandidates = sessionEnabled ? getNextBestAccounts() : [];
  const enforcement = sessionEnabled ? evaluatePrepActionEnforcement() : null;

  return (
    <div>
      <button
        onClick={toggle}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <Bug className="h-3 w-3" />
        {open ? 'Hide Debug' : 'Debug'}
      </button>

      {open && snapshot && (
        <div className="mt-2 p-2 rounded bg-muted/40 border border-border/30 space-y-1.5 text-[10px]">
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-muted-foreground uppercase tracking-wider">System State</span>
            <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={refresh}>
              <RefreshCw className="h-2.5 w-2.5" />
            </Button>
          </div>

          {/* Flags */}
          <Row label="Loop scheduler" value={loopEnabled ? 'on' : 'off'} />
          <Row label="Roleplay grounding" value={groundingEnabled ? 'on' : 'off'} />
          <Row label="Account model" value={acctEnabled ? 'on' : 'off'} />
          <Row label="Acct-centric" value={acctCentricEnabled ? 'on' : 'off'} />
          <Row label="Exec session" value={sessionEnabled ? 'on' : 'off'} />
          <Row label="Strict mode flag" value={strictEnabled ? 'on' : 'off'} />
          <Row label="Autopilot flag" value={autopilotEnabled ? 'on' : 'off'} />
          <Row label="Momentum flag" value={momentumEnabled ? 'on' : 'off'} />

          {/* Loop state */}
          <div className="border-t border-border/20 pt-1 mt-1" />
          <Row label="Loop source" value={snapshot.loopSource} />
          <Row label="Loop count" value={String(snapshot.loopCount)} />
          <Row label="Current loop" value={snapshot.currentLoopStatus || 'none'} />
          <Row label="Carry-forward" value={String(snapshot.carryForwardCount)} />

          {/* Account execution truth */}
          {snapshot.accountTruthEnabled && (
            <>
              <div className="border-t border-border/20 pt-1 mt-1" />
              <Row label="Acct prepped" value={String(snapshot.accountPreppedCount)} />
              <Row label="Acct worked" value={String(snapshot.accountWorkedCount)} />
              <Row label="Acct ready" value={String(snapshot.accountReadyToCallCount)} />
              <Row label="Acct unworked" value={String(snapshot.accountUnworkedPreppedCount)} />
              <Row label="Acct carry-fwd" value={String(snapshot.accountCarryForwardCount)} />
              <Row label="Acct source" value={snapshot.accountSourceOfTruth} />
              {snapshot.recentOutcomes.length > 0 && (
                <Row label="Outcomes" value={snapshot.recentOutcomes.slice(0, 3).join(', ')} />
              )}
              <Row label="Measurements" value={String(measurementCount)} />
            </>
          )}

          {/* Execution session */}
          {sessionEnabled && (
            <>
              <div className="border-t border-border/20 pt-1 mt-1" />
              <Row label="Session mode" value={mode} />
              <Row label="Discipline" value={disciplineMode} />
              <Row label="Active acct" value={activeSession?.accountName || 'none'} />
              <Row label="Last outcome" value={activeSession?.latestOutcome?.replace(/_/g, ' ') || 'none'} />
              <Row label="Post-action" value={activeSession?.postActionRecommendation?.decision?.replace(/_/g, ' ') || 'none'} />
              <Row label="Worked" value={String(scorecard.accountsWorked)} />
              <Row label="Connects" value={String(scorecard.connects)} />
              <Row label="Meetings" value={String(scorecard.meetingsBooked)} />
              <Row label="Ready left" value={String(scorecard.readyRemaining)} />
              <Row label="Next-best" value={nextCandidates[0]?.accountName || 'none'} />
              <Row label="Routing src" value={nextCandidates[0] ? 'account_truth' : 'none'} />

              {/* Prep/Action enforcement */}
              {enforcement && (
                <Row label="Prep/Action" value={enforcement.reason} />
              )}

              {/* Momentum */}
              {momentumEnabled && (
                <>
                  <div className="border-t border-border/20 pt-1 mt-1" />
                  <Row label="Pace" value={momentum.pace} />
                  <Row label="Actions/block" value={String(momentum.actionsThisBlock)} />
                  <Row label="Roleplay first" value={momentum.roleplayCompletedBeforeAction ? 'yes' : 'no'} />
                  <Row label="Prep→1st attempt" value={momentum.prepToFirstAttemptMs ? `${Math.round(momentum.prepToFirstAttemptMs / 1000)}s` : 'n/a'} />
                </>
              )}

              {/* Autopilot */}
              {autopilotEnabled && autopilotLog.length > 0 && (
                <>
                  <div className="border-t border-border/20 pt-1 mt-1" />
                  <Row label="Autopilot events" value={String(autopilotLog.length)} />
                  <Row label="Last autopilot" value={`${autopilotLog[autopilotLog.length - 1].action}: ${autopilotLog[autopilotLog.length - 1].reason.slice(0, 40)}`} />
                </>
              )}

              {/* Overrides */}
              {overrides.length > 0 && (
                <Row label="Overrides" value={String(overrides.length)} />
              )}
            </>
          )}

          {/* Roleplay */}
          <div className="border-t border-border/20 pt-1 mt-1" />
          <Row label="Roleplay today" value={snapshot.roleplayStatusToday || 'none'} />
          <Row label="Grounding" value={snapshot.roleplayGroundingSource || 'none'} />
          <Row label="Scenario ID" value={snapshot.selectedScenarioId ? snapshot.selectedScenarioId.slice(0, 16) + '…' : 'none'} />
          <Row label="Freshness" value={snapshot.scenarioFreshness || 'unknown'} />
          <Row label="Last regen" value={snapshot.lastScenarioRegenTime ? new Date(snapshot.lastScenarioRegenTime).toLocaleDateString() : 'never'} />

          {/* Suppression */}
          <div className="border-t border-border/20 pt-1 mt-1" />
          <Row label="Cap. suppressed" value={snapshot.capabilityPromptSuppressed ? 'yes' : 'no'} />
          {snapshot.suppressionReason && (
            <Row label="Reason" value={snapshot.suppressionReason} />
          )}

          {/* Sales Brain governance */}
          <div className="border-t border-border/20 pt-1 mt-1" />
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[9px]">Sales Brain</span>
          <Row label="Total doctrine" value={String(brainStats.total)} />
          <Row label="Approved" value={String(brainStats.approved)} />
          <Row label="Review needed" value={String(brainStats.reviewNeeded)} />
          <Row label="Legacy hydrated" value={String(legacyCount)} />
          <Row label="Rejected" value={String(brainStats.rejected)} />
          <Row label="Stale" value={String(brainStats.stale)} />
          <Row label="Duplicates" value={String(brainStats.duplicateCandidates)} />
          <Row label="Conflicts" value={String(brainStats.conflictCandidates)} />
          <Row label="Propagating" value={String(brainStats.propagationEnabled)} />
          <Row label="→ Dave (eligible)" value={String(brainStats.usedByDave)} />
          <Row label="→ Roleplay (eligible)" value={String(brainStats.usedByRoleplay)} />
          <Row label="→ Prep (eligible)" value={String(brainStats.usedByPrep)} />
          <Row label="→ Playbooks (eligible)" value={String(brainStats.usedByPlaybooks)} />
          <Row label="→ Dave (actual)" value={String(actualUsage.dave)} />
          <Row label="→ Roleplay (actual)" value={String(actualUsage.roleplay)} />
          <Row label="→ Prep (actual)" value={String(actualUsage.prep)} />
          <Row label="→ Playbooks (actual)" value={String(actualUsage.playbooks)} />

          {/* Fallback matrix */}
          <div className="border-t border-border/20 pt-1 mt-1" />
          <span className="font-semibold text-muted-foreground uppercase tracking-wider text-[9px]">Fallback Matrix</span>
          {Object.entries(FALLBACK_MATRIX).map(([k, v]) => (
            <Row key={k} label={k.replace(/_/g, ' ')} value={v} />
          ))}

          <p className="text-[8px] text-muted-foreground pt-1">
            Snapshot: {new Date(snapshot.snapshotAt).toLocaleTimeString()}
          </p>
        </div>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-mono text-foreground text-right truncate">{value}</span>
    </div>
  );
}
