/**
 * PressureAnalysisCard
 *
 * Post-session pressure analysis with deterministic interpretation.
 * Only rendered when session had pressure_level !== 'none'.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Zap, ShieldAlert, ShieldCheck, RotateCcw } from 'lucide-react';
import { PRESSURE_LABELS, type PressureDimension } from '@/lib/dojo/v4/pressureModel';
import { FOCUS_PATTERN_LABELS } from '@/lib/dojo/focusPatterns';

interface PressureAnalysisCardProps {
  pressureLevel: string;
  pressureDimensions: string[];
  sessionScore: number;
  recentAvg: number;          // recent avg for this skill (pass from parent or default 0)
  topMistake?: string;
  focusPattern?: string;
  retryScore?: number | null;
}

function interpret(props: PressureAnalysisCardProps): { line: string; tone: 'green' | 'amber' | 'red' } {
  const { sessionScore, recentAvg, topMistake, focusPattern, retryScore } = props;
  const delta = sessionScore - recentAvg;

  // Retry recovery check
  if (retryScore != null && retryScore - sessionScore >= 8) {
    return { line: 'You recovered well once coached.', tone: 'green' };
  }

  // Pressure caused breakdown in focus
  if (topMistake && focusPattern && topMistake === focusPattern) {
    return { line: `Pressure caused a breakdown in today's focus.`, tone: 'red' };
  }

  // Score held
  if (delta >= -5) {
    return { line: 'Form held under pressure.', tone: 'green' };
  }

  // Moderate drop
  if (delta >= -8) {
    return { line: 'Slight drop under pressure — stay sharp.', tone: 'amber' };
  }

  // Big drop
  return { line: 'Pressure exposed a weakness.', tone: 'red' };
}

export function PressureAnalysisCard(props: PressureAnalysisCardProps) {
  const { pressureLevel, pressureDimensions } = props;
  if (!pressureLevel || pressureLevel === 'none') return null;

  const dims = (pressureDimensions ?? []).filter(d => d !== 'none') as PressureDimension[];
  const dimLabels = dims.map(d => PRESSURE_LABELS[d] || d.replace(/_/g, ' ')).join(' + ');
  const { line, tone } = interpret(props);

  const toneStyles = {
    green: 'border-green-500/20 bg-green-500/5',
    amber: 'border-amber-500/20 bg-amber-500/5',
    red: 'border-red-500/20 bg-red-500/5',
  };
  const toneText = {
    green: 'text-green-700 dark:text-green-400',
    amber: 'text-amber-700 dark:text-amber-400',
    red: 'text-red-700 dark:text-red-400',
  };
  const ToneIcon = tone === 'green' ? ShieldCheck : tone === 'amber' ? ShieldAlert : ShieldAlert;

  return (
    <Card className={toneStyles[tone]}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Zap className="h-3.5 w-3.5 text-amber-500" />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Pressure Analysis
          </p>
          <Badge variant="outline" className="text-[9px] ml-auto capitalize">
            {pressureLevel}
          </Badge>
        </div>

        {dimLabels && (
          <p className="text-xs text-muted-foreground">
            Pressure Rep: <span className="font-medium text-foreground">{dimLabels}</span>
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <ToneIcon className={`h-3.5 w-3.5 ${toneText[tone]}`} />
          <p className={`text-xs font-medium ${toneText[tone]}`}>{line}</p>
        </div>

        {props.retryScore != null && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <RotateCcw className="h-3 w-3" />
            <span>Pressure score: {props.sessionScore} → Retry: {props.retryScore}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
