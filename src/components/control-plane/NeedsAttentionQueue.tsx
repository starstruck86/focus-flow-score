/**
 * Needs Attention Queue — "What should I work next?"
 * Grouped by category with counts, showing state transitions and reasons.
 */
import { useState, useMemo } from 'react';
import {
  Zap, AlertTriangle, ShieldAlert, XCircle,
  ChevronDown, ChevronUp, ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import {
  deriveControlPlaneState, CONTROL_PLANE_LABELS,
  type ControlPlaneState,
} from '@/lib/controlPlaneState';
import { getRecentActions } from '@/lib/actionOutcomeStore';

type Category = 'mismatched' | 'failed' | 'needs_review' | 'needs_extraction';

interface QueueItem {
  id: string;
  title: string;
  category: Category;
  reason: string;
  state: ControlPlaneState;
  expectedNextState: ControlPlaneState;
}

const CATEGORY_CONFIG: Record<Category, {
  icon: React.ElementType; label: string; color: string; actionLabel: string; batchLabel: string; hint: string;
}> = {
  mismatched: { icon: ShieldAlert, label: 'Mismatched', color: 'text-amber-600', actionLabel: 'Inspect', batchLabel: 'Inspect All', hint: 'Inspect and re-run, or manually verify state.' },
  failed: { icon: XCircle, label: 'Failed', color: 'text-destructive', actionLabel: 'Retry', batchLabel: 'Retry All', hint: 'Retry the failed action or diagnose root cause.' },
  needs_review: { icon: AlertTriangle, label: 'Blocked', color: 'text-destructive', actionLabel: 'Diagnose', batchLabel: 'Diagnose All', hint: 'Fix blockers — re-enrich or review content.' },
  needs_extraction: { icon: Zap, label: 'Needs Extraction', color: 'text-amber-600', actionLabel: 'Extract', batchLabel: 'Extract All', hint: 'Run Extract on available content.' },
};

const CATEGORY_ORDER: Category[] = ['mismatched', 'failed', 'needs_review', 'needs_extraction'];

function expectedNext(category: Category, currentState: ControlPlaneState): ControlPlaneState {
  switch (category) {
    case 'needs_extraction': return 'extracted';
    case 'needs_review': return 'has_content';
    case 'failed': return 'has_content';
    case 'mismatched': return 'extracted';
    default: return currentState;
  }
}

interface Props {
  resources: CanonicalResourceStatus[];
  processingIds: Set<string>;
  outcomeRefreshKey: number;
  onAction: (resourceId: string, action: string) => void;
  onInspect: (resourceId: string) => void;
  onBatchCategoryAction?: (ids: string[], action: string) => void;
}

export function NeedsAttentionQueue({ resources, processingIds, outcomeRefreshKey, onAction, onInspect }: Props) {
  const [expanded, setExpanded] = useState(false);

  const { grouped, totalCount, categoryCounts } = useMemo(() => {
    const items: QueueItem[] = [];
    const recentActions = getRecentActions();
    const mismatchedIds = new Set<string>();
    const failedIds = new Set<string>();

    for (const a of recentActions) {
      if (a.reconciliation === 'mismatched') mismatchedIds.add(a.resourceId);
      if (a.status === 'failed') failedIds.add(a.resourceId);
    }

    for (const r of resources) {
      const state = deriveControlPlaneState(r, processingIds);

      if (mismatchedIds.has(r.resource_id)) {
        const action = recentActions.find(a => a.resourceId === r.resource_id && a.reconciliation === 'mismatched');
        items.push({
          id: r.resource_id, title: r.title,
          category: 'mismatched',
          reason: action?.mismatchExplanation || 'Outcome did not match expected transition',
          state, expectedNextState: expectedNext('mismatched', state),
        });
        continue;
      }

      if (failedIds.has(r.resource_id)) {
        const action = recentActions.find(a => a.resourceId === r.resource_id && a.status === 'failed');
        items.push({
          id: r.resource_id, title: r.title,
          category: 'failed',
          reason: action?.detail || 'Action failed during execution',
          state, expectedNextState: expectedNext('failed', state),
        });
        continue;
      }

      if (state === 'blocked') {
        items.push({
          id: r.resource_id, title: r.title,
          category: 'needs_review',
          reason: r.blocked_reason?.replace(/_/g, ' ') || 'Resource is blocked',
          state, expectedNextState: expectedNext('needs_review', state),
        });
        continue;
      }

      if (state === 'has_content') {
        items.push({
          id: r.resource_id, title: r.title,
          category: 'needs_extraction',
          reason: 'Content available — no knowledge extracted yet',
          state, expectedNextState: expectedNext('needs_extraction', state),
        });
      }
    }

    // Group by category
    const grouped: Record<Category, QueueItem[]> = {
      mismatched: [], failed: [], needs_review: [], needs_extraction: [],
    };
    const categoryCounts: Record<Category, number> = {
      mismatched: 0, failed: 0, needs_review: 0, needs_extraction: 0,
    };
    for (const item of items) {
      grouped[item.category].push(item);
      categoryCounts[item.category]++;
    }

    return { grouped, totalCount: items.length, categoryCounts };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, processingIds, outcomeRefreshKey]);

  if (totalCount === 0) return null;

  return (
    <div className="border rounded-lg bg-card">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3 text-amber-600" />
          Needs Attention ({totalCount})
        </span>
        <div className="flex items-center gap-2">
          {CATEGORY_ORDER.map(cat => {
            if (categoryCounts[cat] === 0) return null;
            const cfg = CATEGORY_CONFIG[cat];
            return (
              <Badge key={cat} variant="outline" className={cn('text-[9px] px-1.5 py-0 border-current/20', cfg.color)}>
                {categoryCounts[cat]} {cfg.label.toLowerCase()}
              </Badge>
            );
          })}
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t">
          {CATEGORY_ORDER.map(cat => {
            const items = grouped[cat];
            if (items.length === 0) return null;
            const cfg = CATEGORY_CONFIG[cat];
            const Icon = cfg.icon;

            return (
              <div key={cat}>
                {/* Category header with resolution hint */}
                <div className="px-3 py-1 bg-muted/30 border-b">
                  <div className="flex items-center gap-1.5">
                    <Icon className={cn('h-3 w-3', cfg.color)} />
                    <span className={cn('text-[10px] font-semibold uppercase tracking-wider', cfg.color)}>
                      {cfg.label} ({items.length})
                    </span>
                  </div>
                  <p className="text-[9px] text-muted-foreground mt-0.5 pl-[18px]">{cfg.hint}</p>
                </div>

                {/* Items */}
                <div className="divide-y">
                  {items.slice(0, 5).map(item => (
                    <div
                      key={`${item.id}-${item.category}`}
                      className="px-3 py-1.5 flex items-center gap-2 text-xs hover:bg-muted/30 transition-colors group"
                    >
                      <button
                        onClick={() => onInspect(item.id)}
                        className="font-medium truncate max-w-[160px] text-left hover:text-primary hover:underline"
                      >
                        {item.title}
                      </button>

                      <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                        <span>{CONTROL_PLANE_LABELS[item.state]}</span>
                        <ArrowRight className="h-2.5 w-2.5" />
                        <span className="text-foreground">{CONTROL_PLANE_LABELS[item.expectedNextState]}</span>
                      </span>

                      <span className="text-muted-foreground truncate max-w-[180px] hidden md:inline text-[10px]">
                        {item.reason}
                      </span>

                      <button
                        onClick={() => {
                          if (item.category === 'needs_extraction') onAction(item.id, 'extract');
                          else if (item.category === 'needs_review' || item.category === 'failed') onAction(item.id, 'fix');
                          else onInspect(item.id);
                        }}
                        className={cn(
                          'ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-muted',
                          'opacity-0 group-hover:opacity-100 transition-opacity',
                          cfg.color,
                        )}
                      >
                        {cfg.actionLabel}
                      </button>
                    </div>
                  ))}
                  {items.length > 5 && (
                    <div className="px-3 py-1 text-[10px] text-muted-foreground">
                      +{items.length - 5} more…
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {!expanded && (
        <div className="border-t divide-y">
          {/* Show top 3 items across all categories when collapsed */}
          {CATEGORY_ORDER.flatMap(cat => grouped[cat]).slice(0, 3).map(item => {
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
                  className="font-medium truncate max-w-[140px] text-left hover:text-primary hover:underline"
                >
                  {item.title}
                </button>
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
                  <span>{CONTROL_PLANE_LABELS[item.state]}</span>
                  <ArrowRight className="h-2.5 w-2.5" />
                  <span className="text-foreground">{CONTROL_PLANE_LABELS[item.expectedNextState]}</span>
                </span>
                <button
                  onClick={() => {
                    if (item.category === 'needs_extraction') onAction(item.id, 'extract');
                    else if (item.category === 'needs_review' || item.category === 'failed') onAction(item.id, 'fix');
                    else onInspect(item.id);
                  }}
                  className={cn(
                    'ml-auto text-[10px] font-medium px-1.5 py-0.5 rounded hover:bg-muted',
                    'opacity-0 group-hover:opacity-100 transition-opacity',
                    cfg.color,
                  )}
                >
                  {cfg.actionLabel}
                </button>
              </div>
            );
          })}
          {totalCount > 3 && (
            <button
              onClick={() => setExpanded(true)}
              className="w-full px-3 py-1.5 text-[10px] text-muted-foreground hover:text-foreground text-center"
            >
              +{totalCount - 3} more…
            </button>
          )}
        </div>
      )}
    </div>
  );
}
