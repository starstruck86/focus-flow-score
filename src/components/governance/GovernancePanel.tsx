/**
 * System Governance Panel — visible operator controls
 * Feature-flagged behind ENABLE_SYSTEM_OS
 *
 * TUNED: Compact header is the primary surface. Expanded view
 * only shows sections with actual data. Kill switches moved last
 * (operator action, not daily reading). Removed redundant confidence
 * display in expanded when already shown in header.
 */

import { useCallback, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  ChevronDown, ChevronUp
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { toggleKillSwitch, type KillSwitches } from '@/lib/systemGovernance';
import { cn } from '@/lib/utils';
import { useLiveSystemState, useLiveKillSwitches } from '@/hooks/useSystemState';
import { SystemDebugPanel } from '@/components/governance/SystemDebugPanel';

const KILL_SWITCH_LABELS: Record<keyof KillSwitches, string> = {
  ENRICHMENT_ENABLED: 'Enrichment',
  RETRY_ENABLED: 'Retries',
  RECOMMENDATION_ENABLED: 'Recommendations',
  COACHING_ENABLED: 'Coaching',
  AUTO_LEARNING_ENABLED: 'Auto-Learning',
};

export function GovernancePanel() {
  const [expanded, setExpanded] = useState(false);
  const state = useLiveSystemState();
  const [switches, setSwitches] = useLiveKillSwitches();

  const handleToggle = useCallback((key: keyof KillSwitches) => {
    const updated = toggleKillSwitch(key, !switches[key]);
    setSwitches(updated);
  }, [switches, setSwitches]);

  if (!isSystemOSEnabled()) return null;

  const healthColor = state.systemConfidence >= 75 ? 'text-primary' : state.systemConfidence >= 55 ? 'text-amber-600' : 'text-destructive';
  const healthDot = state.systemConfidence >= 75 ? 'bg-primary' : state.systemConfidence >= 55 ? 'bg-amber-500' : 'bg-destructive';
  const hasAlerts = state.activeAlerts.length > 0;
  const hasGuardrails = state.activeGuardrails.length > 0;
  const hasCorrections = state.recentCorrections.length > 0;

  return (
    <Card data-testid="governance-panel" className="border-border/50">
      {/* Compact Header — always visible, this IS the primary governance surface */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={cn('h-2 w-2 rounded-full', healthDot)} />
        <Badge variant="outline" className={cn('text-[9px]', healthColor)}>
          {state.systemConfidence}%
        </Badge>
        {state.systemMode !== 'normal' && (
          <Badge variant="outline" className="text-[9px]">{state.systemMode}</Badge>
        )}
        {hasAlerts && (
          <Badge variant="destructive" className="text-[9px]">
            {state.activeAlerts.length}
          </Badge>
        )}
        <div className="flex-1" />
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </div>

      {/* Expanded — only sections with real data */}
      {expanded && (
        <CardContent className="px-3 pb-3 pt-0 space-y-3 border-t border-border/30">
          {/* Mode reason — only when non-normal */}
          {state.systemMode !== 'normal' && (
            <div className="pt-2">
              <p className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground">{state.systemMode}</span> — {state.modeState.reason}
              </p>
            </div>
          )}

          {/* Alerts — only when present */}
          {hasAlerts && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Alerts</p>
              <div className="space-y-1">
                {state.activeAlerts.slice(0, 3).map((a, i) => (
                  <div key={i} className={cn(
                    'text-[10px] p-1.5 rounded',
                    a.severity === 'critical' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                  )}>
                    {a.message}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Guardrails — only when active */}
          {hasGuardrails && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Guardrails</p>
              <div className="flex gap-1 flex-wrap">
                {state.activeGuardrails.map((g, i) => (
                  <Badge key={i} variant="outline" className="text-[9px]">{g}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Recent Corrections — only when present */}
          {hasCorrections && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Corrections</p>
              <div className="space-y-0.5">
                {state.recentCorrections.slice(0, 3).map((c, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">
                    {c.action.replace(/_/g, ' ')}: <span className="font-mono">{String(c.from)} → {String(c.to)}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Biases — always useful, kept compact */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Steering</p>
            <div className="flex gap-3 text-[10px] text-muted-foreground">
              <span>Logo/Expand: <span className="font-mono text-foreground">{state.currentBiases.newLogoVsExpansion}</span></span>
              <span>Aggression: <span className="font-mono text-foreground">{state.currentBiases.aggressionLevel}</span></span>
              <span>Min ARR: <span className="font-mono text-foreground">${state.currentBiases.minimumDealArrK}K</span></span>
            </div>
          </div>

          {/* Kill Switches — last, operator-level action */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Controls</p>
            <div className="space-y-1.5">
              {(Object.keys(KILL_SWITCH_LABELS) as (keyof KillSwitches)[]).map(key => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs">{KILL_SWITCH_LABELS[key]}</span>
                  <Switch
                    checked={switches[key]}
                    onCheckedChange={() => handleToggle(key)}
                    className="h-4 w-7"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Debug Panel — operator inspection */}
          <div className="border-t border-border/20 pt-2">
            <SystemDebugPanel />
          </div>
        </CardContent>
      )}
    </Card>
  );
}
