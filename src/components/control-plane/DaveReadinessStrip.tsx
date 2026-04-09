/**
 * Dave Readiness Strip — secondary layer showing downstream AI readiness.
 * Uses the existing DownstreamReadiness model from controlPlaneState.
 * NOT a primary state system — strictly a readiness indicator.
 */
import { Brain, MessageSquare, Target, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import type { DownstreamReadiness } from '@/lib/controlPlaneState';

interface Props {
  readiness: DownstreamReadiness;
  totalResources: number;
}

export function DaveReadinessStrip({ readiness, totalResources }: Props) {
  if (totalResources === 0) return null;

  const groundingPct = totalResources > 0
    ? Math.round((readiness.groundingEligible / totalResources) * 100)
    : 0;

  const metrics = [
    {
      icon: Brain,
      label: 'Active KIs',
      value: readiness.withActiveKIs,
      detail: `${readiness.withActiveKIs} of ${totalResources} resources have at least one active knowledge item`,
      color: readiness.withActiveKIs > 0 ? 'text-blue-600' : 'text-muted-foreground',
    },
    {
      icon: MessageSquare,
      label: 'With Contexts',
      value: readiness.withContexts,
      detail: `${readiness.withContexts} resources have active KIs with usage contexts assigned`,
      color: readiness.withContexts > 0 ? 'text-violet-600' : 'text-muted-foreground',
    },
    {
      icon: Target,
      label: 'Grounding-Ready',
      value: readiness.groundingEligible,
      detail: `${readiness.groundingEligible} resources are eligible for Dave grounding (active KIs + contexts + not blocked)`,
      color: readiness.groundingEligible > 0 ? 'text-emerald-600' : 'text-muted-foreground',
    },
  ];

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg border bg-card border-border text-xs">
      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">AI Readiness</span>

      <div className="flex items-center gap-4 ml-auto">
        {metrics.map(({ icon: Icon, label, value, detail, color }) => (
          <Tooltip key={label}>
            <TooltipTrigger asChild>
              <span className={cn('flex items-center gap-1 cursor-default', color)}>
                <Icon className="h-3 w-3" />
                <span className="tabular-nums font-medium">{value}</span>
                <span className="text-muted-foreground">{label}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="text-xs max-w-[240px]">
              {detail}
            </TooltipContent>
          </Tooltip>
        ))}

        {/* Coverage indicator */}
        <span className={cn(
          'flex items-center gap-1 pl-2 border-l border-border',
          groundingPct >= 60 ? 'text-emerald-600' :
          groundingPct >= 30 ? 'text-amber-600' :
          'text-muted-foreground',
        )}>
          <span className="tabular-nums font-semibold">{groundingPct}%</span>
          <span className="text-muted-foreground">coverage</span>
        </span>
      </div>
    </div>
  );
}
