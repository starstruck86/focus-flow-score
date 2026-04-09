/**
 * Needs Attention Queue — "What should I work next?"
 * Prioritized compact queue: extraction → review → mismatches → failures.
 */
import { useState, useMemo } from 'react';
import {
  Zap, AlertTriangle, ShieldAlert, XCircle,
  ChevronDown, ChevronUp, ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import { deriveControlPlaneState, type ControlPlaneState } from '@/lib/controlPlaneState';
import { getRecentActions, type ActionOutcome } from '@/lib/actionOutcomeStore';

interface QueueItem {
  id: string;
  title: string;
  priority: number; // lower = higher priority
  category: 'needs_extraction' | 'needs_review' | 'mismatched' | 'failed';
  reason: string;
  state: ControlPlaneState;
}

const CATEGORY_CONFIG: Record<QueueItem['category'], { icon: React.ElementType; label: string; color: string; actionLabel: string }> = {
  needs_review: { icon: AlertTriangle, label: 'Blocked', color: 'text-destructive', actionLabel: 'Review' },
  mismatched: { icon: ShieldAlert, label: 'Mismatched', color: 'text-amber-600', actionLabel: 'Inspect' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-destructive', actionLabel: 'Retry' },
  needs_extraction: { icon: Zap, label: 'Needs Extraction', color: 'text-amber-600', actionLabel: 'Extract' },
};

interface Props {
  resources: CanonicalResourceStatus[];
  processingIds: Set<string>;
  outcomeRefreshKey: number;
  onAction: (resourceId: string, action: string) => void;
  onInspect: (resourceId: string) => void;
}

export function NeedsAttentionQueue({ resources, processingIds, outcomeRefreshKey, onAction, onInspect }: Props) {
  const [expanded, setExpanded] = useState(false);

  const queue = useMemo(() => {
    const items: QueueItem[] = [];
    const recentActions = getRecentActions();
    const mismatchedIds = new Set<string>();
    const failedIds = new Set<string>();

    // Collect mismatched and failed from recent actions
    for (const a of recentActions) {
      if (a.reconciliation === 'mismatched') mismatchedIds.add(a.resourceId);
      if (a.status === 'failed') failedIds.add(a.resourceId);
    }

    for (const r of resources) {
      const state = deriveControlPlaneState(r, processingIds);

      // Priority 1: Mismatched outcomes (trust issue)
      if (mismatchedIds.has(r.resource_id)) {
        const action = recentActions.find(a => a.resourceId === r.resource_id && a.reconciliation === 'mismatched');
        items.push({
          id: r.resource_id,
          title: r.title,
          priority: 1,
          category: 'mismatched',
          reason: action?.mismatchExplanation || 'Outcome did not match expected transition',
          state,
        });
        continue; // Don't double-list
      }

      // Priority 2: Recent failures
      if (failedIds.has(r.resource_id)) {
        const action = recentActions.find(a => a.resourceId === r.resource_id && a.status === 'failed');
        items.push({
          id: r.resource_id,
          title: r.title,
          priority: 2,
          category: 'failed',
          reason: action?.detail || 'Action failed during execution',
          state,
        });
        continue;
      }

      // Priority 3: Blocked
      if (state === 'blocked') {
        items.push({
          id: r.resource_id,
          title: r.title,
          priority: 3,
          category: 'needs_review',
          reason: r.blocked_reason?.replace(/_/g, ' ') || 'Resource is blocked',
          state,
        });
        continue;
      }

      // Priority 4: Needs extraction
      if (state === 'has_content') {
        items.push({
          id: r.resource_id,
          title: r.title,
          priority: 4,
          category: 'needs_extraction',
          reason: 'Content available but no knowledge extracted',
          state,
        });
      }
    }

    items.sort((a, b) => a.priority - b.priority);
    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, processingIds, outcomeRefreshKey]);

  if (queue.length === 0) return null;

  const shown = expanded ? queue.slice(0, 15) : queue.slice(0, 5);

  // Group counts
  const counts = { needs_review: 0, mismatched: 0, failed: 0, needs_extraction: 0 };
  for (const q of queue) counts[q.category]++;

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-600" />
          Needs Attention ({queue.length})
        </span>
        <div className="flex items-center gap-2">
          {/* Category chips */}
          {counts.mismatched > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600 border-amber-200">
              {counts.mismatched} mismatched
            </Badge>
          )}
          {counts.failed > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-destructive border-destructive/30">
              {counts.failed} failed
            </Badge>
          )}
          {counts.needs_review > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-destructive border-destructive/30">
              {counts.needs_review} blocked
            </Badge>
          )}
          {counts.needs_extraction > 0 && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0 text-amber-600 border-amber-200">
              {counts.needs_extraction} extract
            </Badge>
          )}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      <div className="border-t divide-y">
        {shown.map(item => {
          const cfg = CATEGORY_CONFIG[item.category];
          const Icon = cfg.icon;
          return (
            <div
              key={`${item.id}-${item.category}`}
              className="px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors group"
            >
              <Icon className={cn('h-3 w-3 shrink-0', cfg.color)} />
              <button
                onClick={() => onInspect(item.id)}
                className="font-medium truncate max-w-[180px] text-left hover:text-primary hover:underline"
              >
                {item.title}
              </button>
              <span className="text-muted-foreground truncate max-w-[200px] hidden sm:inline">
                {item.reason}
              </span>
              <div className="ml-auto flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => {
                    if (item.category === 'needs_extraction') onAction(item.id, 'extract');
                    else if (item.category === 'needs_review' || item.category === 'failed') onAction(item.id, 'fix');
                    else onInspect(item.id);
                  }}
                  className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-muted', cfg.color)}
                >
                  {cfg.actionLabel}
                </button>
              </div>
            </div>
          );
        })}
        {queue.length > shown.length && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="w-full px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground text-center"
          >
            +{queue.length - shown.length} more…
          </button>
        )}
      </div>
    </div>
  );
}
