/**
 * System Governance Panel — visible operator controls
 * Feature-flagged behind ENABLE_SYSTEM_OS
 * REACTIVE: polls live system state every 5 s
 */

import { useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { 
  Shield, AlertTriangle,
  ChevronDown, ChevronUp
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { toggleKillSwitch, type KillSwitches } from '@/lib/systemGovernance';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { useLiveSystemState, useLiveKillSwitches } from '@/hooks/useSystemState';

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

  return (
    <Card data-testid="governance-panel" className="border-border/50">
      {/* Compact Header — always visible */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <div className={cn('h-2 w-2 rounded-full', healthDot)} />
        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">System OS</span>
        <Badge variant="outline" className={cn('text-[9px] ml-1', healthColor)}>
          {state.systemConfidence}%
        </Badge>
        <Badge variant="outline" className="text-[9px]">{state.systemMode}</Badge>
        {state.activeAlerts.length > 0 && (
          <Badge variant="destructive" className="text-[9px]">
            {state.activeAlerts.length} alert{state.activeAlerts.length !== 1 ? 's' : ''}
          </Badge>
        )}
        <div className="flex-1" />
        {expanded ? <ChevronUp className="h-3 w-3 text-muted-foreground" /> : <ChevronDown className="h-3 w-3 text-muted-foreground" />}
      </div>

      {/* Expanded Details */}
      {expanded && (
        <CardContent className="px-3 pb-3 pt-0 space-y-3 border-t border-border/30">
          {/* Mode & Confidence */}
          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="p-2 rounded-md bg-muted/30 text-center">
              <p className={cn('text-lg font-bold', healthColor)}>{state.systemConfidence}%</p>
              <p className="text-[9px] text-muted-foreground">Confidence</p>
            </div>
            <div className="p-2 rounded-md bg-muted/30 text-center">
              <Badge className="text-[10px]">{state.systemMode}</Badge>
              <p className="text-[9px] text-muted-foreground mt-0.5">{state.modeState.reason}</p>
            </div>
          </div>

          {/* Active Guardrails */}
          {state.activeGuardrails.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Active Guardrails</p>
              <div className="flex gap-1 flex-wrap">
                {state.activeGuardrails.map((g, i) => (
                  <Badge key={i} variant="outline" className="text-[9px]">{g}</Badge>
                ))}
              </div>
            </div>
          )}

          {/* Active Alerts */}
          {state.activeAlerts.length > 0 && (
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

          {/* Kill Switches */}
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

          {/* Current Biases */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Steering Biases</p>
            <div className="space-y-0.5 text-[10px] text-muted-foreground">
              <p>New Logo vs Expansion: <span className="font-mono text-foreground">{state.currentBiases.newLogoVsExpansion}</span></p>
              <p>Aggression: <span className="font-mono text-foreground">{state.currentBiases.aggressionLevel}</span></p>
              <p>Min Deal ARR: <span className="font-mono text-foreground">${state.currentBiases.minimumDealArrK}K</span></p>
            </div>
          </div>

          {/* Recent Corrections */}
          {state.recentCorrections.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Recent Corrections</p>
              <div className="space-y-0.5">
                {state.recentCorrections.slice(0, 3).map((c, i) => (
                  <p key={i} className="text-[10px] text-muted-foreground">
                    {c.action.replace(/_/g, ' ')}: <span className="font-mono">{String(c.from)} → {String(c.to)}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
