/**
 * Unified Lifecycle Summary Bar — renders canonical lifecycle counts.
 * 
 * MUST be the only way lifecycle stats are displayed. No tab may compute
 * its own lifecycle truth independently.
 * 
 * Uses human-readable labels: "Ready to Use" not "Operationalized".
 */

import { memo } from 'react';
import { cn } from '@/lib/utils';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import type { LifecycleSummary } from '@/lib/canonicalLifecycle';
import { Loader2, AlertTriangle } from 'lucide-react';
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown } from 'lucide-react';

/** Human-readable blocked labels */
const HUMAN_BLOCKED_LABELS: Record<string, string> = {
  empty_content: 'Empty content',
  no_extraction: 'Needs extraction',
  no_activation: 'Needs activation',
  missing_contexts: 'Needs context repair',
  stale_blocker_state: 'Needs review',
};

interface Props {
  /** If provided, uses this summary instead of fetching via hook */
  summary?: LifecycleSummary | null;
  compact?: boolean;
}

export const LifecycleSummaryBar = memo(function LifecycleSummaryBar({ summary: externalSummary, compact }: Props) {
  const hook = useCanonicalLifecycle();
  const summary = externalSummary ?? hook.summary;
  const loading = !externalSummary && hook.loading;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground p-2">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading lifecycle…
      </div>
    );
  }

  if (!summary) return null;

  const totalBlocked = summary.blocked.empty_content + summary.blocked.no_extraction
    + summary.blocked.no_activation + summary.blocked.missing_contexts
    + summary.blocked.stale_blocker_state;

  if (compact) {
    return (
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap">
        <span>{summary.total_resources} total</span>
        <span className="text-border">·</span>
        <span>{summary.content_ready} content</span>
        <span className="text-border">·</span>
        <span>{summary.with_knowledge} with knowledge</span>
        <span className="text-border">·</span>
        <span className="text-emerald-600 font-medium">{summary.operationalized} operationalized</span>
        {totalBlocked > 0 && (
          <>
            <span className="text-border">·</span>
            <span className="text-amber-500">{totalBlocked} need attention</span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Stage counts */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
        <StageStat label="Total" value={summary.total_resources} color="text-foreground" />
        <StageStat label="Enriched" value={summary.enriched} color="text-foreground" />
        <StageStat label="Content" value={summary.content_ready} color="text-amber-600" />
        <StageStat label="With Knowledge" value={summary.with_knowledge} color="text-blue-600" />
        <StageStat label="Activated" value={summary.activated} color="text-emerald-600" />
        <StageStat label="Ready to Use" value={summary.operationalized} color="text-emerald-600" />
      </div>

      {/* Blocked breakdown */}
      {totalBlocked > 0 && (
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-between p-1.5 rounded hover:bg-accent/50 text-[10px]">
            <span className="font-medium text-foreground flex items-center gap-1">
              <AlertTriangle className="h-3 w-3 text-amber-500" />
              {totalBlocked} resource{totalBlocked !== 1 ? 's' : ''} need attention
            </span>
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground pl-2 pt-1">
              {(Object.entries(summary.blocked) as [string, number][]).map(([reason, count]) => {
                if (count === 0) return null;
                return (
                  <div key={reason} className="contents">
                    <span>{HUMAN_BLOCKED_LABELS[reason] ?? reason}</span>
                    <span className="font-medium text-amber-500">{count}</span>
                  </div>
                );
              })}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
});

function StageStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-lg border border-border p-1.5 text-center">
      <p className={cn('text-base font-bold', color)}>{value}</p>
      <p className="text-[8px] text-muted-foreground leading-tight">{label}</p>
    </div>
  );
}
