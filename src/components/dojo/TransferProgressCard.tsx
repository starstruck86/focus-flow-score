/**
 * TransferProgressCard
 *
 * Shows real-call transfer status for transcript-origin scenarios.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, CheckCircle2, AlertTriangle, TrendingUp } from 'lucide-react';

interface TransferProgressCardProps {
  originalScore: number;
  practiceScore: number;
  retryScore?: number | null;
  originalMistake?: string;
  practiceMistake?: string;
}

function deriveTransferStatus(props: TransferProgressCardProps): {
  label: string;
  detail: string;
  tone: 'green' | 'amber' | 'red';
} {
  const best = props.retryScore != null ? Math.max(props.practiceScore, props.retryScore) : props.practiceScore;
  const delta = best - props.originalScore;
  const mistakeFixed = props.originalMistake && props.practiceMistake !== props.originalMistake;

  if (delta >= 15 && mistakeFixed) {
    return { label: 'Transfer improving', detail: `+${delta} pts from live call. Core mistake addressed.`, tone: 'green' };
  }
  if (delta >= 8) {
    return { label: 'Transfer improving', detail: `+${delta} pts from live call. Keep reinforcing.`, tone: 'green' };
  }
  if (delta >= 0 && mistakeFixed) {
    return { label: 'Transfer building', detail: `Score stable, but original mistake was fixed in practice.`, tone: 'amber' };
  }
  if (delta >= 0) {
    return { label: 'Transfer still weak', detail: `Practice improved but real-call pattern not yet resolved.`, tone: 'amber' };
  }
  return { label: 'Transfer not yet visible', detail: `Practice score below live call. Focus on the coaching cue.`, tone: 'red' };
}

export function TransferProgressCard(props: TransferProgressCardProps) {
  const status = deriveTransferStatus(props);
  const best = props.retryScore != null ? Math.max(props.practiceScore, props.retryScore) : props.practiceScore;

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
  const ToneIcon = status.tone === 'green' ? CheckCircle2 : status.tone === 'amber' ? TrendingUp : AlertTriangle;

  return (
    <Card className={toneStyles[status.tone]}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-center gap-2">
          <ToneIcon className={`h-3.5 w-3.5 ${toneText[status.tone]}`} />
          <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Real-Call Transfer
          </p>
          <Badge variant="outline" className={`text-[9px] ml-auto ${toneText[status.tone]}`}>
            {status.label}
          </Badge>
        </div>

        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-muted-foreground">{props.originalScore}</span>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="font-bold text-foreground">{best}</span>
          {best > props.originalScore && (
            <span className="text-xs text-green-600 font-medium">+{best - props.originalScore}</span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">{status.detail}</p>
      </CardContent>
    </Card>
  );
}
