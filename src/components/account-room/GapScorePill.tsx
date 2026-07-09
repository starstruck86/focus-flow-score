import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { GapScoreResult } from '@/lib/gapScore';

interface GapScorePillProps {
  gap: GapScoreResult | null | undefined;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Gap Score pill — 0-100 truth-model expansion signal with a one-line "why".
 * Replaces the retired ICP fit-score badge on account rows and detail headers.
 */
export function GapScorePill({ gap, size = 'sm', className }: GapScorePillProps) {
  if (!gap) return <span className="text-xs text-muted-foreground">—</span>;
  const { score, why } = gap;
  const tone =
    score >= 70
      ? 'text-status-green border-status-green/40'
      : score >= 40
      ? 'text-primary border-primary/40'
      : score >= 15
      ? 'text-status-yellow border-status-yellow/40'
      : 'text-muted-foreground border-border';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 font-mono font-bold tabular-nums cursor-default',
              size === 'sm' ? 'text-[11px] py-0.5' : 'text-sm py-1',
              tone,
              className,
            )}
            aria-label={`Gap Score ${score}/100 — ${why}`}
          >
            <span className="opacity-70 font-sans font-medium">GAP</span>
            {score}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-[280px]">
          <p className="font-semibold">Gap Score {score}/100</p>
          <p className="text-muted-foreground mt-0.5">{why}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
