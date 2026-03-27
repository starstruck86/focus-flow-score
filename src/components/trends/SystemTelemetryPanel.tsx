/**
 * System Telemetry Panel — Trends system health surface
 * Feature-flagged behind ENABLE_SYSTEM_OS
 *
 * TUNED: Removed redundant summary card (already in GovernancePanel header).
 * Confidence breakdown is the hero. Alerts/corrections only when present.
 * Health history bar chart kept but sized down.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { 
  Activity, AlertTriangle, 
  Gauge, Brain, Zap, BarChart3
} from 'lucide-react';
import { isSystemOSEnabled } from '@/lib/featureFlags';
import { cn } from '@/lib/utils';
import { useLiveTelemetry } from '@/hooks/useSystemState';

function confidenceColor(label: string) {
  switch (label) {
    case 'high': return 'text-primary';
    case 'moderate': return 'text-amber-600';
    case 'low': return 'text-orange-500';
    case 'critical': return 'text-destructive';
    default: return 'text-foreground';
  }
}

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

export function SystemTelemetryPanel() {
  const { modeState, confidence, alerts, corrections, healthHistory } = useLiveTelemetry();

  if (!isSystemOSEnabled()) return null;

  return (
    <div data-testid="system-telemetry" className="space-y-4">
      {/* Hero: Confidence + Mode in a compact strip */}
      <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-muted/40">
        <Gauge className="h-4 w-4 text-primary shrink-0" />
        <span className={cn('text-lg font-bold', confidenceColor(confidence.label))}>{confidence.score}</span>
        <span className="text-[10px] text-muted-foreground">confidence</span>
        <div className="flex-1" />
        <Badge className={cn('text-[10px]', modeColor(modeState.mode))}>{modeState.mode}</Badge>
        {alerts.length > 0 && (
          <Badge variant="destructive" className="text-[9px]">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</Badge>
        )}
      </div>

      {/* Confidence Breakdown — the primary telemetry view */}
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

      {/* Alerts — only when present */}
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
                  <Badge variant="outline" className="text-[8px] mt-0.5">{a.state}</Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Corrections — only when present */}
      {corrections.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <Zap className="h-3.5 w-3.5 text-primary" />
              Recent Corrections
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

      {/* Health History — compact sparkline */}
      {healthHistory.length > 2 && (
        <Card>
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-sm flex items-center gap-1.5">
              <BarChart3 className="h-3.5 w-3.5 text-primary" />
              Health Trend
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="flex items-end gap-0.5 h-8">
              {healthHistory.map((h, i) => {
                const alertCount = h.alerts.length;
                const height = Math.max(3, Math.min(32, (1 - alertCount / 5) * 32));
                return (
                  <div key={i} className="flex-1">
                    <div
                      className={cn(
                        'w-full rounded-sm',
                        h.overallStatus === 'healthy' ? 'bg-primary' : h.overallStatus === 'degraded' ? 'bg-amber-500' : 'bg-destructive'
                      )}
                      style={{ height: `${height}px` }}
                      title={`${h.overallStatus} · ${h.alerts.length} alerts`}
                    />
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
