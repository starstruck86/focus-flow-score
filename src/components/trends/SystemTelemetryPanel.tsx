/**
 * System Telemetry Panel — replaces/augments Trends page
 * Feature-flagged behind ENABLE_SYSTEM_OS
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, Shield, AlertTriangle, TrendingUp, 
  Gauge, Brain, Zap, CheckCircle, BarChart3
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import {
  loadHealthHistory,
  loadAlerts,
  loadCorrectionLog,
  loadSystemMode,
  computeSystemConfidence,
  type HealthSnapshot,
  type SystemAlert,
  type SystemModeState,
  type SystemConfidence,
  type AutoCorrectionAction,
  type HealthInputs,
} from '@/lib/systemIntelligence';
import { getSystemSummary } from '@/lib/systemGovernance';
import { cn } from '@/lib/utils';

// Default inputs for display when no real data
const DEFAULT_INPUTS: HealthInputs = {
  enrichmentSuccessRate: 85,
  enrichmentFailureRate: 15,
  playbookRegenerationCount: 2,
  trustDegradationCount: 1,
  outcomeScoreTrend: 5,
  explorationWinRate: 30,
  exploitationWinRate: 40,
  daveFailureRate: 5,
  daveRetryRate: 3,
  singlePlaybookConcentration: 25,
};

function modeColor(mode: string) {
  switch (mode) {
    case 'normal': return 'text-primary bg-primary/10';
    case 'degraded': return 'text-amber-600 bg-amber-500/10';
    case 'recovery': return 'text-destructive bg-destructive/10';
    case 'exploration-heavy': return 'text-blue-600 bg-blue-500/10';
    case 'conservative': return 'text-muted-foreground bg-muted';
    default: return 'text-foreground bg-muted';
  }
}

function confidenceColor(label: string) {
  switch (label) {
    case 'high': return 'text-primary';
    case 'moderate': return 'text-amber-600';
    case 'low': return 'text-orange-500';
    case 'critical': return 'text-destructive';
    default: return 'text-foreground';
  }
}

export function SystemTelemetryPanel() {
  if (!isSystemOSEnabled()) return null;

  const summary = useMemo(() => getSystemSummary(), []);
  const modeState = useMemo(() => loadSystemMode(), []);
  const confidence = useMemo(() => computeSystemConfidence(DEFAULT_INPUTS, 0), []);
  const alerts = useMemo(() => loadAlerts().filter(a => a.state === 'active' || a.state === 'escalated').slice(0, 10), []);
  const corrections = useMemo(() => loadCorrectionLog().slice(-5), []);
  const healthHistory = useMemo(() => loadHealthHistory().slice(-10), []);

  return (
    <div data-testid="system-telemetry" className="space-y-4">
      {/* System Health Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3 text-center">
            <Gauge className="h-4 w-4 mx-auto mb-1 text-primary" />
            <p className={cn('text-2xl font-bold', confidenceColor(confidence.label))}>{confidence.score}</p>
            <p className="text-[10px] text-muted-foreground">Confidence</p>
            <Badge variant="outline" className={cn('text-[9px] mt-1', confidenceColor(confidence.label))}>{confidence.label}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Activity className="h-4 w-4 mx-auto mb-1" />
            <Badge className={cn('text-xs px-2 py-0.5', modeColor(modeState.mode))}>{modeState.mode}</Badge>
            <p className="text-[10px] text-muted-foreground mt-1">System Mode</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <AlertTriangle className="h-4 w-4 mx-auto mb-1 text-destructive" />
            <p className="text-2xl font-bold">{alerts.length}</p>
            <p className="text-[10px] text-muted-foreground">Active Alerts</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-3 text-center">
            <Shield className="h-4 w-4 mx-auto mb-1" />
            <p className="text-2xl font-bold">{corrections.length}</p>
            <p className="text-[10px] text-muted-foreground">Recent Corrections</p>
          </CardContent>
        </Card>
      </div>

      {/* Confidence Components */}
      <Card>
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <Brain className="h-3.5 w-3.5 text-primary" />
            Confidence Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 space-y-2">
          {confidence.components.map((c, i) => (
            <div key={i} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{c.name.replace(/_/g, ' ')}</span>
                <span className="font-medium">{Math.round(c.score)}</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', c.score >= 70 ? 'bg-primary' : c.score >= 40 ? 'bg-amber-500' : 'bg-destructive')}
                  style={{ width: `${Math.max(0, Math.min(100, c.score))}%` }}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              Active Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {alerts.map((a, i) => (
              <div key={i} className={cn(
                'flex items-start gap-2 p-2 rounded-md text-xs',
                a.severity === 'critical' ? 'bg-destructive/10' : 'bg-amber-500/10'
              )}>
                <div className={cn(
                  'h-1.5 w-1.5 rounded-full mt-1.5 shrink-0',
                  a.severity === 'critical' ? 'bg-destructive' : 'bg-amber-500'
                )} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium">{a.message}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="outline" className="text-[8px]">{a.category}</Badge>
                    <Badge variant="outline" className="text-[8px]">{a.state}</Badge>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Recent Auto-Corrections */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Recent Auto-Corrections
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {corrections.map((c, i) => (
              <div key={i} className="flex items-center justify-between text-xs p-2 rounded-md bg-muted/30">
                <span className="text-muted-foreground">{c.action.replace(/_/g, ' ')}</span>
                <span className="font-mono text-[10px]">{String(c.from)} → {String(c.to)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Health History */}
      {healthHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              Health History
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="flex items-end gap-1 h-12">
              {healthHistory.map((h, i) => {
                const alertCount = h.alerts.length;
                const height = Math.max(4, Math.min(48, (1 - alertCount / 5) * 48));
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={cn(
                        'w-full rounded-sm transition-all',
                        h.overallStatus === 'healthy' ? 'bg-primary' : h.overallStatus === 'degraded' ? 'bg-amber-500' : 'bg-destructive'
                      )}
                      style={{ height: `${height}px` }}
                      title={`${h.overallStatus} - ${h.alerts.length} alerts`}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-[9px] text-muted-foreground text-center mt-1">Recent snapshots</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
