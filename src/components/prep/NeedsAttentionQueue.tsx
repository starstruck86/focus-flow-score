/**
 * NeedsAttentionQueue — Prioritized operational queue for resources needing intervention.
 * Fully truth-blocker-driven: groups come from canonical blocker types, not mixed heuristics.
 */
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  XCircle, AlertTriangle, Zap, TrendingDown, Clock, Shield, Eye,
  HelpCircle, ChevronDown, ChevronRight, CheckCircle2, Layers, Loader2, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { deriveResourceTruth, type BlockerType, type Blocker, BLOCKER_META } from '@/lib/resourceTruthState';
import { deriveProcessingRoute, PIPELINE_LABELS, EXTRACTION_METHOD_LABELS } from '@/lib/processingRoute';
import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

interface QueueItem {
  resource: Resource;
  blockerType: BlockerType;
  reason: string;
  priority: number;
  actionLabel: string;
  actionKey: string;
  bulkEligible: boolean;
  hasOverride: boolean;
  routeContext: string | null;
}

interface QueueGroup {
  type: BlockerType;
  label: string;
  icon: React.ElementType;
  color: string;
  items: QueueItem[];
  bulkActionLabel?: string;
  bulkActionKey?: string;
}

interface Props {
  resources: Resource[];
  lifecycleMap: Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>;
  audioJobsMap?: Map<string, AudioJobRecord>;
  onAction: (action: string, resource: Resource) => void;
  onBulkAction?: (action: string, resourceIds: string[]) => void;
  onInspect: (resource: Resource) => void;
}

/** Priority order for blocker types — lower = more urgent */
const BLOCKER_PRIORITY: Record<BlockerType, number> = {
  contradictory_state: 0,
  stalled_extraction: 1,
  stalled_enrichment: 2,
  missing_content: 3,
  needs_enrichment: 4,
  needs_extraction: 5,
  needs_activation: 6,
  missing_context: 7,
  route_low_confidence: 8,
  route_manual_assist: 9,
  qa_required: 10,
  stale_version: 11,
  downstream_ineligible: 12,
  audit_mismatch: 13,
  unknown_processing_state: 14,
};

const BLOCKER_ICON: Partial<Record<BlockerType, React.ElementType>> = {
  contradictory_state: AlertTriangle,
  stalled_extraction: Loader2,
  stalled_enrichment: Loader2,
  missing_content: AlertTriangle,
  needs_enrichment: Zap,
  needs_extraction: Zap,
  needs_activation: Activity,
  missing_context: HelpCircle,
  route_low_confidence: Eye,
  route_manual_assist: Eye,
  qa_required: Eye,
  stale_version: Clock,
  downstream_ineligible: XCircle,
  audit_mismatch: AlertTriangle,
  unknown_processing_state: HelpCircle,
};

const BLOCKER_COLOR: Partial<Record<BlockerType, string>> = {
  contradictory_state: 'text-destructive',
  stalled_extraction: 'text-destructive',
  stalled_enrichment: 'text-destructive',
  missing_content: 'text-destructive',
  needs_enrichment: 'text-amber-600',
  needs_extraction: 'text-amber-600',
  needs_activation: 'text-amber-600',
  missing_context: 'text-amber-600',
  route_low_confidence: 'text-amber-600',
  route_manual_assist: 'text-amber-600',
  qa_required: 'text-amber-600',
  stale_version: 'text-muted-foreground',
};

const BULK_ACTIONS: Partial<Record<BlockerType, { label: string; key: string }>> = {
  needs_enrichment: { label: 'Enrich All', key: 'bulk_enrich' },
  needs_extraction: { label: 'Extract All', key: 'bulk_extract' },
  needs_activation: { label: 'Activate All', key: 'bulk_activate' },
  missing_content: { label: 'Re-enrich All', key: 'bulk_re_enrich' },
  stale_version: { label: 'Re-enrich All', key: 'bulk_re_enrich' },
  stalled_extraction: { label: 'Retry All', key: 'bulk_retry_stalled' },
  stalled_enrichment: { label: 'Retry All', key: 'bulk_retry_stalled' },
};

function getActionForBlocker(b: Blocker): { label: string; key: string } {
  switch (b.type) {
    case 'contradictory_state': return { label: 'Fix State', key: 'reset' };
    case 'stalled_extraction':
    case 'stalled_enrichment': return { label: 'Retry', key: 'deep_enrich' };
    case 'missing_content': return { label: 'Re-enrich', key: 're_enrich' };
    case 'needs_enrichment': return { label: 'Enrich', key: 'deep_enrich' };
    case 'needs_extraction': return { label: 'Extract', key: 'extract' };
    case 'needs_activation': return { label: 'Activate', key: 'activate' };
    case 'missing_context': return { label: 'Add Contexts', key: 'repair_contexts' };
    case 'route_low_confidence':
    case 'route_manual_assist': return { label: 'Review', key: 'view' };
    case 'qa_required': return { label: 'Review', key: 'view' };
    case 'stale_version': return { label: 'Re-enrich', key: 're_enrich' };
    case 'downstream_ineligible': return { label: 'Inspect', key: 'view' };
    case 'audit_mismatch': return { label: 'Review', key: 'view' };
    default: return { label: 'Inspect', key: 'view' };
  }
}

export function NeedsAttentionQueue({ resources, lifecycleMap, audioJobsMap, onAction, onBulkAction, onInspect }: Props) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    new Set(['contradictory_state', 'stalled_extraction', 'stalled_enrichment', 'missing_content', 'needs_extraction'])
  );

  const groups = useMemo<QueueGroup[]>(() => {
    // Collect items grouped by primary blocker type
    const buckets = new Map<BlockerType, QueueItem[]>();

    for (const r of resources) {
      const lc = lifecycleMap.get(r.id);
      if (!lc) continue;
      const truth = deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));

      // Only resources with blockers need attention
      if (truth.is_ready || truth.all_blockers.length === 0) continue;
      // Skip actively processing resources (they'll resolve on their own)
      if (truth.truth_state === 'processing') continue;

      const primaryBlocker = truth.primary_blocker;
      if (!primaryBlocker) continue;

      const route = deriveProcessingRoute(r);
      const routeCtx = `${PIPELINE_LABELS[route.pipeline]} · ${EXTRACTION_METHOD_LABELS[route.extraction_method]}`;
      const action = getActionForBlocker(primaryBlocker);

      const item: QueueItem = {
        resource: r,
        blockerType: primaryBlocker.type,
        reason: primaryBlocker.detail,
        priority: BLOCKER_PRIORITY[primaryBlocker.type] ?? 99,
        actionLabel: action.label,
        actionKey: action.key,
        bulkEligible: primaryBlocker.fixability === 'auto_fixable' || primaryBlocker.fixability === 'semi_auto_fixable',
        hasOverride: route.has_override,
        routeContext: route.confidence !== 'high' ? routeCtx : null,
      };

      if (!buckets.has(primaryBlocker.type)) buckets.set(primaryBlocker.type, []);
      buckets.get(primaryBlocker.type)!.push(item);
    }

    // Sort groups by priority, items within by age (older = more urgent)
    const sortedTypes = [...buckets.keys()].sort(
      (a, b) => (BLOCKER_PRIORITY[a] ?? 99) - (BLOCKER_PRIORITY[b] ?? 99)
    );

    return sortedTypes.map(type => {
      const items = buckets.get(type)!;
      items.sort((a, b) => {
        const ageA = Date.now() - new Date(a.resource.updated_at || a.resource.created_at).getTime();
        const ageB = Date.now() - new Date(b.resource.updated_at || b.resource.created_at).getTime();
        return ageB - ageA; // older first
      });

      const meta = BLOCKER_META[type];
      const bulk = BULK_ACTIONS[type];

      return {
        type,
        label: meta.label,
        icon: BLOCKER_ICON[type] ?? HelpCircle,
        color: BLOCKER_COLOR[type] ?? 'text-muted-foreground',
        items,
        bulkActionLabel: bulk && items.length > 1 ? `${bulk.label} ${items.length}` : undefined,
        bulkActionKey: bulk?.key,
      };
    });
  }, [resources, lifecycleMap, audioJobsMap]);

  const totalItems = groups.reduce((s, g) => s + g.items.length, 0);

  const toggleGroup = (type: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  if (totalItems === 0) {
    return (
      <div className="flex items-center gap-2 p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-lg">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        <p className="text-xs font-medium text-emerald-600">All clear — no resources need attention</p>
      </div>
    );
  }

  const urgentCount = groups
    .filter(g => ['contradictory_state', 'stalled_extraction', 'stalled_enrichment', 'missing_content'].includes(g.type))
    .reduce((s, g) => s + g.items.length, 0);
  const fixableCount = groups.reduce((s, g) => s + g.items.filter(i => i.bulkEligible).length, 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <div className="flex items-center gap-2">
          <Shield className="h-3.5 w-3.5 text-foreground" />
          <span className="text-xs font-semibold text-foreground">Needs Attention</span>
          <Badge variant="secondary" className="text-[9px] h-4">{totalItems}</Badge>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          {urgentCount > 0 && (
            <span className="text-destructive font-medium">{urgentCount} urgent</span>
          )}
          {fixableCount > 0 && (
            <span>· {fixableCount} auto-fixable</span>
          )}
        </div>
      </div>
      <ScrollArea className="max-h-[400px]">
        <div className="divide-y divide-border">
          {groups.map(group => {
            const isExpanded = expandedGroups.has(group.type);
            const Icon = group.icon;
            return (
              <div key={group.type}>
                <button
                  onClick={() => toggleGroup(group.type)}
                  className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  <Icon className={cn('h-3.5 w-3.5', group.color)} />
                  <span className="text-xs font-medium text-foreground">{group.label}</span>
                  <Badge variant="outline" className="text-[9px] h-4 ml-auto">{group.items.length}</Badge>
                </button>
                {isExpanded && (
                  <div className="pb-1">
                    {group.bulkActionLabel && group.items.length > 1 && (
                      <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/20 border-b border-border/50">
                        <Layers className="h-3 w-3 text-muted-foreground" />
                        <span className="text-[10px] text-muted-foreground flex-1">
                          {group.items.filter(i => i.bulkEligible).length} items can be fixed automatically
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={() => onAction(group.bulkActionKey!, group.items[0].resource)}
                        >
                          {group.bulkActionLabel}
                        </Button>
                      </div>
                    )}
                    {group.items.slice(0, 10).map(item => (
                      <div key={item.resource.id} className="flex items-center gap-2 px-4 py-1.5 hover:bg-muted/20 transition-colors">
                        <button
                          onClick={() => onInspect(item.resource)}
                          className="flex-1 min-w-0 text-left"
                        >
                          <p className="text-[11px] font-medium text-foreground truncate">{item.resource.title}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-[10px] text-muted-foreground truncate">{item.reason}</p>
                            {item.routeContext && (
                              <span className="text-[9px] text-muted-foreground/70">{item.routeContext}</span>
                            )}
                            {item.hasOverride && (
                              <Badge className="text-[8px] h-3.5 bg-amber-500/15 text-amber-700 border-amber-500/30">Override</Badge>
                            )}
                          </div>
                        </button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2 shrink-0"
                          onClick={(e) => { e.stopPropagation(); onAction(item.actionKey, item.resource); }}
                        >
                          {item.actionLabel}
                        </Button>
                      </div>
                    ))}
                    {group.items.length > 10 && (
                      <p className="text-[10px] text-muted-foreground px-4 py-1">
                        + {group.items.length - 10} more
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
