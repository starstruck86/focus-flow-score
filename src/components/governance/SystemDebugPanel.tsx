/**
 * System Debug Panel — lightweight operator inspection surface
 *
 * Shown inside the GovernancePanel expanded view when ENABLE_SYSTEM_OS is on.
 * Shows loop state, roleplay state, scenario freshness, and suppression info.
 * No dashboard bloat — just a small inspection block.
 */

import { useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Bug, RefreshCw } from 'lucide-react';
import { captureDebugSnapshot, type SystemDebugSnapshot } from '@/lib/loopRuntime';

export function SystemDebugPanel() {
  const [snapshot, setSnapshot] = useState<SystemDebugSnapshot | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(() => {
    setSnapshot(captureDebugSnapshot());
  }, []);

  const toggle = useCallback(() => {
    setOpen(v => {
      if (!v) refresh();
      return !v;
    });
  }, [refresh]);

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

          {/* Loop state */}
          <Row label="Loop source" value={snapshot.loopSource} />
          <Row label="Loop count" value={String(snapshot.loopCount)} />
          <Row label="Current loop" value={snapshot.currentLoopStatus || 'none'} />
          <Row label="Carry-forward" value={String(snapshot.carryForwardCount)} />

          {/* Roleplay state */}
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
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground">{value}</span>
    </div>
  );
}
