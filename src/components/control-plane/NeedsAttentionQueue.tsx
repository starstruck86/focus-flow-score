/**
 * Needs Attention Queue — "What should I work next?"
 * Grouped by category with counts, preview confirmation, and result summaries.
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
  deriveControlPlaneState, CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
  type ControlPlaneState,
} from '@/lib/controlPlaneState';
import { getRecentActions } from '@/lib/actionOutcomeStore';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

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
  icon: React.ElementType; label: string; color: string; actionLabel: string;
  batchLabel: string; hint: string;
  batchReason: string; batchPipeline: string;
}> = {
  mismatched: {
    icon: ShieldAlert, label: 'Mismatched', color: 'text-amber-600',
    actionLabel: 'Inspect', batchLabel: 'Inspect All',
    hint: 'Inspect and re-run, or manually verify state.',
    batchReason: 'These resources had outcomes that did not match expected state transitions — reconciliation detected a mismatch.',
    batchPipeline: 'Re-inspect each resource and re-run the last failed action',
  },
  failed: {
    icon: XCircle, label: 'Failed', color: 'text-destructive',
    actionLabel: 'Retry', batchLabel: 'Retry All',
    hint: 'Retry the failed action or diagnose root cause.',
    batchReason: 'These resources failed during their last pipeline action — the operation did not complete successfully.',
    batchPipeline: 'Retry the failed pipeline step on each resource',
  },
  needs_review: {
    icon: AlertTriangle, label: 'Blocked', color: 'text-destructive',
    actionLabel: 'Diagnose', batchLabel: 'Diagnose All',
    hint: 'Fix blockers — re-enrich or review content.',
    batchReason: 'These resources are blocked by detected issues — empty content, failed extraction, or stale state.',
    batchPipeline: 'Diagnostic pipeline (detect root cause → apply fix → re-validate)',
  },
  needs_extraction: {
    icon: Zap, label: 'Needs Extraction', color: 'text-amber-600',
    actionLabel: 'Extract', batchLabel: 'Extract All',
    hint: 'Run Extract on available content.',
    batchReason: 'These resources have parseable content but no knowledge items extracted yet.',
    batchPipeline: 'AI extraction on each resource (segment → extract → validate → deduplicate)',
  },
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

/** Map category to the action key used by the pipeline */
function categoryToAction(cat: Category): string {
  switch (cat) {
    case 'needs_extraction': return 'extract';
    case 'needs_review':
    case 'failed': return 'fix';
    case 'mismatched': return 'inspect';
  }
}

// ── Queue Group Preview Dialog ─────────────────────────────

interface QueueGroupPreview {
  category: Category;
  items: QueueItem[];
}

function QueueGroupPreviewDialog({
  preview,
  open,
  onConfirm,
  onCancel,
  loading,
}: {
  preview: QueueGroupPreview | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}) {
  if (!preview) return null;
  const cfg = CATEGORY_CONFIG[preview.category];
  const Icon = cfg.icon;

  // Determine dominant from → to transition
  const fromState = preview.items[0]?.state ?? 'ingested';
  const toState = preview.items[0]?.expectedNextState ?? 'has_content';
  const fromColors = CONTROL_PLANE_COLORS[fromState];
  const toColors = CONTROL_PLANE_COLORS[toState];

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm flex items-center gap-1.5">
            <Icon className={cn('h-3.5 w-3.5', cfg.color)} />
            {cfg.batchLabel}
          </AlertDialogTitle>
          <p className="text-xs text-muted-foreground">
            {preview.items.length} resource{preview.items.length !== 1 ? 's' : ''} in this group
          </p>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Why these resources</span>
              <p className="text-xs text-foreground mt-0.5">{cfg.batchReason}</p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Will run</span>
              <p className="text-xs text-foreground mt-0.5 font-mono">{cfg.batchPipeline}</p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Expected transition</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn('text-[10px]', fromColors.text, fromColors.bg, fromColors.border)}>
                  {CONTROL_PLANE_LABELS[fromState]}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="outline" className={cn('text-[10px]', toColors.text, toColors.bg, toColors.border)}>
                  {CONTROL_PLANE_LABELS[toState]}
                </Badge>
              </div>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Resources</span>
              <ul className="mt-1 space-y-0.5">
                {preview.items.slice(0, 5).map((item, i) => (
                  <li key={i} className="text-xs text-muted-foreground truncate">• {item.title}</li>
                ))}
                {preview.items.length > 5 && (
                  <li className="text-[10px] text-muted-foreground/70 italic">
                    …and {preview.items.length - 5} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs h-8" disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="text-xs h-8" onClick={onConfirm} disabled={loading}>
            {loading ? 'Running…' : `Run on ${preview.items.length} resources`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Main Component ─────────────────────────────────────────

interface Props {
  resources: CanonicalResourceStatus[];
  processingIds: Set<string>;
  outcomeRefreshKey: number;
  onAction: (resourceId: string, action: string) => void;
  onInspect: (resourceId: string) => void;
  onBatchCategoryAction?: (ids: string[], action: string, category: Category, items: QueueItem[]) => void;
  batchLoading?: boolean;
}

export type { Category as QueueCategory, QueueItem };

export function NeedsAttentionQueue({
  resources, processingIds, outcomeRefreshKey,
  onAction, onInspect, onBatchCategoryAction, batchLoading,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [previewState, setPreviewState] = useState<QueueGroupPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

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

  const handleBatchClick = (cat: Category, items: QueueItem[]) => {
    setPreviewState({ category: cat, items });
    setPreviewOpen(true);
  };

  const handlePreviewConfirm = () => {
    if (!previewState || !onBatchCategoryAction) return;
    const action = categoryToAction(previewState.category);
    onBatchCategoryAction(
      previewState.items.map(i => i.id),
      action,
      previewState.category,
      previewState.items,
    );
    setPreviewOpen(false);
    setPreviewState(null);
  };

  const handlePreviewCancel = () => {
    setPreviewOpen(false);
    setPreviewState(null);
  };

  return (
    <>
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
                  <div className="px-3 py-1 bg-muted/30 border-b flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Icon className={cn('h-3 w-3', cfg.color)} />
                        <span className={cn('text-[10px] font-semibold uppercase tracking-wider', cfg.color)}>
                          {cfg.label} ({items.length})
                        </span>
                      </div>
                      <p className="text-[9px] text-muted-foreground mt-0.5 pl-[18px]">{cfg.hint}</p>
                    </div>
                    {onBatchCategoryAction && items.length > 1 && (
                      <button
                        onClick={() => handleBatchClick(cat, items)}
                        disabled={batchLoading}
                        className={cn(
                          'text-[9px] font-medium px-2 py-0.5 rounded border border-current/20 hover:bg-muted transition-colors',
                          batchLoading ? 'opacity-50 cursor-not-allowed' : '',
                          cfg.color,
                        )}
                      >
                        {cfg.batchLabel}
                      </button>
                    )}
                  </div>

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

      <QueueGroupPreviewDialog
        preview={previewState}
        open={previewOpen}
        onConfirm={handlePreviewConfirm}
        onCancel={handlePreviewCancel}
        loading={batchLoading}
      />
    </>
  );
}
