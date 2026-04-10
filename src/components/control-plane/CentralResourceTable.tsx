/**
 * Central Resource Table — filterable, expandable rows with action previews and outcome flashes.
 */
import { useState, useMemo, useCallback, Fragment } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronDown, ChevronRight, CheckCircle2, XCircle,
  Zap, FileText, Play, Wrench, Eye, MoreHorizontal,
  MinusCircle, AlertTriangle,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  type ControlPlaneState, type ControlPlaneFilter,
  CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
  deriveControlPlaneState, matchesFilter,
  deriveStateEvidence,
} from '@/lib/controlPlaneState';
import { ActionPreviewDialog, buildActionPreview, type ActionPreview } from './ActionPreviewDialog';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import { getRowFlash, type RowFlashStatus } from '@/lib/actionOutcomeStore';

interface Props {
  resources: CanonicalResourceStatus[];
  filter: ControlPlaneFilter;
  processingIds?: Set<string>;
  conflictIds?: Set<string>;
  customFilterIds?: Set<string> | null;
  customFilterLabel?: string | null;
  onAction: (resourceId: string, action: string) => void;
  onInspect: (resource: CanonicalResourceStatus, state: ControlPlaneState, tab?: 'overview' | 'content' | 'knowledge') => void;
  actionLoading?: boolean;
  outcomeRefreshKey?: number;
}

function inferSourceType(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes(' > ')) return 'Lesson';
  if (lower.includes('podcast') || lower.includes('episode')) return 'Podcast';
  if (lower.includes('transcript')) return 'Transcript';
  if (lower.includes('framework')) return 'Framework';
  return 'Document';
}

function qualityLabel(ki: number, active: number): string {
  if (ki === 0) return '—';
  const ratio = active / ki;
  if (ratio >= 0.8) return 'Strong';
  if (ratio >= 0.5) return 'Moderate';
  return 'Weak';
}

function qualityColor(ki: number, active: number): string {
  if (ki === 0) return 'text-muted-foreground';
  const ratio = active / ki;
  if (ratio >= 0.8) return 'text-emerald-600';
  if (ratio >= 0.5) return 'text-amber-600';
  return 'text-destructive';
}

function nextActionLabel(state: ControlPlaneState, resource: CanonicalResourceStatus): string {
  switch (state) {
    case 'ingested': return 'Enrich content';
    case 'has_content': return 'Extract knowledge';
    case 'extracted': return 'Activate knowledge';
    case 'activated': return 'Ready';
    case 'blocked': {
      switch (resource.blocked_reason) {
        case 'empty_content': return 'Add content';
        case 'no_extraction': return 'Run extraction';
        case 'no_activation': return 'Activate knowledge';
        case 'missing_contexts': return 'Add contexts';
        case 'stale_blocker_state': return 'Diagnose & repair';
        default: return 'Review';
      }
    }
    case 'processing': return 'In progress…';
    default: return '—';
  }
}

interface RowAction {
  key: string;
  label: string;
  icon: React.ElementType;
}

function getRowActions(state: ControlPlaneState, resource: CanonicalResourceStatus): RowAction[] {
  switch (state) {
    case 'ingested': return [{ key: 'enrich', label: 'Enrich', icon: FileText }];
    case 'has_content': return [{ key: 'extract', label: 'Extract', icon: Zap }];
    case 'extracted': return [
      { key: 'activate', label: 'Activate', icon: Play },
      { key: 'extract', label: 'Re-extract', icon: Zap },
    ];
    case 'activated': return [{ key: 'extract', label: 'Re-extract', icon: Zap }];
    case 'blocked': {
      const actions: RowAction[] = [];
      if (['no_extraction', 'stale_blocker_state'].includes(resource.blocked_reason)) {
        actions.push({ key: 'fix', label: 'Diagnose', icon: Wrench });
      }
      if (['no_activation', 'missing_contexts'].includes(resource.blocked_reason)) {
        actions.push({ key: 'activate', label: 'Activate', icon: Play });
      }
      if (resource.blocked_reason === 'empty_content') {
        actions.push({ key: 'enrich', label: 'Enrich', icon: FileText });
      }
      return actions;
    }
    case 'processing': return [{ key: 'view_progress', label: 'View', icon: Eye }];
    default: return [];
  }
}

export function CentralResourceTable({
  resources, filter, processingIds, conflictIds, customFilterIds, customFilterLabel,
  onAction, onInspect, actionLoading, outcomeRefreshKey,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'title' | 'state' | 'kis' | 'updated'>('updated');
  const [sortAsc, setSortAsc] = useState(false);

  // Action preview state
  const [previewOpen, setPreviewOpen] = useState(false);
  const [pendingPreview, setPendingPreview] = useState<{ preview: ActionPreview; resourceId: string; title: string } | null>(null);

  const rows = useMemo(() => {
    let filtered = resources
      .map(r => ({ resource: r, state: deriveControlPlaneState(r, processingIds) }));

    if (customFilterIds) {
      filtered = filtered.filter(({ resource }) => customFilterIds.has(resource.resource_id));
    } else {
      filtered = filtered.filter(({ state, resource }) =>
        matchesFilter(state, filter, resource.resource_id, conflictIds),
      );
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'title': cmp = a.resource.title.localeCompare(b.resource.title); break;
        case 'state': cmp = a.state.localeCompare(b.state); break;
        case 'kis': cmp = a.resource.knowledge_item_count - b.resource.knowledge_item_count; break;
        case 'updated': cmp = (a.resource.last_transition_at ?? '').localeCompare(b.resource.last_transition_at ?? ''); break;
      }
      return sortAsc ? cmp : -cmp;
    });

    return filtered;
  }, [resources, filter, processingIds, conflictIds, customFilterIds, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  // Show preview before executing action
  const handleActionWithPreview = useCallback((resourceId: string, actionKey: string, state: ControlPlaneState, resource: CanonicalResourceStatus) => {
    // Read-only actions skip preview
    if (actionKey === 'view_progress' || actionKey === 'inspect') {
      onAction(resourceId, actionKey);
      return;
    }
    const preview = buildActionPreview(actionKey, state, resource);
    setPendingPreview({ preview, resourceId, title: resource.title });
    setPreviewOpen(true);
  }, [onAction]);

  const confirmAction = useCallback(() => {
    if (pendingPreview) {
      onAction(pendingPreview.resourceId, pendingPreview.preview.actionKey);
    }
    setPreviewOpen(false);
    setPendingPreview(null);
  }, [pendingPreview, onAction]);

  const cancelPreview = useCallback(() => {
    setPreviewOpen(false);
    setPendingPreview(null);
  }, []);

  if (rows.length === 0) {
    const emptyMessages: Record<string, { title: string; hint: string }> = {
      ready: { title: 'No resources ready yet', hint: 'Extract knowledge from resources with content to move them here.' },
      needs_extraction: { title: 'Nothing to extract', hint: 'All resources with content have been processed — nice work.' },
      needs_review: { title: 'No blocked resources', hint: 'Everything is progressing through the lifecycle normally.' },
      processing: { title: 'Nothing processing right now', hint: 'Run an action from the queue or table to start a pipeline.' },
      ingested: { title: 'No raw resources', hint: 'All resources have been enriched or are further along the lifecycle.' },
      conflicts: { title: 'No conflicts detected', hint: 'All lifecycle signals are consistent.' },
    };

    // Custom filter empty states — match by label keywords
    let customEmpty: { title: string; hint: string } | null = null;
    if (customFilterLabel) {
      if (customFilterLabel.includes('Grounding-Ready')) {
        customEmpty = { title: 'No grounding-ready resources yet', hint: 'Resources need active KIs, usage contexts, and no blockers to qualify.' };
      } else if (customFilterLabel.includes('Active KIs')) {
        customEmpty = { title: 'No resources with active KIs', hint: 'Run Extract on resources with content to generate knowledge items.' };
      } else if (customFilterLabel.includes('With Contexts')) {
        customEmpty = { title: 'No resources with contexts yet', hint: 'Add usage contexts to extracted knowledge items to reach this stage.' };
      } else if (customFilterLabel.includes('mismatched')) {
        customEmpty = { title: 'No mismatched resources', hint: 'All recent actions landed in the expected state — reconciliation passed.' };
      } else if (customFilterLabel.includes('attention')) {
        customEmpty = { title: 'All clear after last batch', hint: 'Every resource from the last action moved forward successfully.' };
      } else {
        customEmpty = { title: 'No matching resources', hint: 'These resources may have advanced to a different state since the filter was set.' };
      }
    }

    const msg = customEmpty ?? emptyMessages[filter] ?? { title: 'No resources match', hint: 'Try a different filter or clear the current one.' };
    return (
      <div className="text-center py-10 space-y-1">
        <p className="text-sm text-muted-foreground font-medium">{msg.title}</p>
        <p className="text-xs text-muted-foreground/70">{msg.hint}</p>
      </div>
    );
  }

  return (
    <>
      <div className="border rounded-lg overflow-hidden">
        <div className="max-h-[60vh] overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="cursor-pointer hover:text-foreground" onClick={() => handleSort('title')}>
                  Resource {sortField === 'title' && (sortAsc ? '↑' : '↓')}
                </TableHead>
                <TableHead className="w-24">Source</TableHead>
                <TableHead className="cursor-pointer hover:text-foreground w-28" onClick={() => handleSort('state')}>
                  State {sortField === 'state' && (sortAsc ? '↑' : '↓')}
                </TableHead>
                <TableHead className="w-16 text-center">Content</TableHead>
                <TableHead className="cursor-pointer hover:text-foreground w-16 text-center" onClick={() => handleSort('kis')}>
                  KIs {sortField === 'kis' && (sortAsc ? '↑' : '↓')}
                </TableHead>
                <TableHead className="w-20">Quality</TableHead>
                <TableHead className="cursor-pointer hover:text-foreground w-28" onClick={() => handleSort('updated')}>
                  Updated {sortField === 'updated' && (sortAsc ? '↑' : '↓')}
                </TableHead>
                <TableHead className="w-24 text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(({ resource: r, state }) => {
                const isExpanded = expandedId === r.resource_id;
                const colors = CONTROL_PLANE_COLORS[state];
                const evidence = deriveStateEvidence(r, state);
                const hasConflict = conflictIds?.has(r.resource_id);
                const rowActions = getRowActions(state, r);
                const primaryAction = rowActions[0];
                const moreActions = rowActions.slice(1);
                const flash = getRowFlash(r.resource_id);

                return (
                  <Fragment key={r.resource_id}>
                    <TableRow className={cn(
                      'group/row transition-colors duration-500',
                      hasConflict && 'bg-destructive/5',
                      flash === 'success' && 'bg-emerald-50/50 dark:bg-emerald-950/20',
                      flash === 'failed' && 'bg-destructive/5',
                      flash === 'needs_review' && 'bg-amber-50/50 dark:bg-amber-950/20',
                    )}>
                      <TableCell
                        className="p-2 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : r.resource_id)}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                          : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                        }
                      </TableCell>
                      <TableCell
                        className="font-medium text-sm max-w-[200px] truncate cursor-pointer"
                        onClick={() => onInspect(r, state)}
                      >
                        <div className="flex items-center gap-1.5">
                          {hasConflict && (
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-destructive shrink-0" title="Has conflicts" />
                          )}
                          <span className="hover:underline">{r.title}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">{inferSourceType(r.title)}</span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className={cn('text-[10px] font-medium cursor-help', colors.text, colors.bg, colors.border)}>
                                {CONTROL_PLANE_LABELS[state]}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-xs text-xs">
                              <p className="font-medium mb-1">{evidence.reason}</p>
                            </TooltipContent>
                          </Tooltip>
                          {flash && <FlashBadge status={flash} />}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        {r.is_content_backed
                          ? <span className="text-xs text-emerald-600">✓</span>
                          : <span className="text-xs text-muted-foreground">—</span>
                        }
                      </TableCell>
                      <TableCell className="text-center">
                        <span className="text-xs tabular-nums font-medium">
                          {r.knowledge_item_count > 0 ? r.knowledge_item_count : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className={cn('text-xs', qualityColor(r.knowledge_item_count, r.active_ki_count))}>
                          {qualityLabel(r.knowledge_item_count, r.active_ki_count)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {r.last_transition_at
                            ? new Date(r.last_transition_at).toLocaleDateString()
                            : '—'
                          }
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover/row:opacity-100 transition-opacity">
                          {primaryAction && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-[10px] px-2 gap-1"
                              onClick={(e) => { e.stopPropagation(); handleActionWithPreview(r.resource_id, primaryAction.key, state, r); }}
                              disabled={actionLoading}
                            >
                              <primaryAction.icon className="h-3 w-3" />
                              {primaryAction.label}
                            </Button>
                          )}
                          {moreActions.length > 0 && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={e => e.stopPropagation()}>
                                  <MoreHorizontal className="h-3 w-3" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="text-xs">
                                {moreActions.map(a => (
                                  <DropdownMenuItem
                                    key={a.key}
                                    onClick={() => handleActionWithPreview(r.resource_id, a.key, state, r)}
                                    className="text-xs gap-2"
                                  >
                                    <a.icon className="h-3 w-3" />
                                    {a.label}
                                  </DropdownMenuItem>
                                ))}
                                <DropdownMenuItem
                                  onClick={() => onInspect(r, state)}
                                  className="text-xs gap-2"
                                >
                                  <Eye className="h-3 w-3" />
                                  Inspect
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          {moreActions.length === 0 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={(e) => { e.stopPropagation(); onInspect(r, state); }}
                            >
                              <Eye className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow>
                        <TableCell colSpan={9} className="bg-muted/30 p-4">
                          <ExpandedResourceDetail resource={r} state={state} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
        <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
          Showing {rows.length} of {resources.length} resources
        </div>
      </div>

      {/* Action Preview Dialog */}
      <ActionPreviewDialog
        preview={pendingPreview?.preview ?? null}
        resourceTitle={pendingPreview?.title}
        open={previewOpen}
        onConfirm={confirmAction}
        onCancel={cancelPreview}
        loading={actionLoading}
      />
    </>
  );
}

// ── Flash Badge ────────────────────────────────────────────
const FLASH_CONFIG: Record<RowFlashStatus, { icon: React.ElementType; label: string; className: string }> = {
  success: { icon: CheckCircle2, label: 'Updated', className: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200' },
  no_change: { icon: MinusCircle, label: 'No change', className: 'text-muted-foreground bg-muted/50 border-muted' },
  failed: { icon: XCircle, label: 'Failed', className: 'text-destructive bg-destructive/10 border-destructive/30' },
  needs_review: { icon: AlertTriangle, label: 'Needs review', className: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30 border-amber-200' },
};

function FlashBadge({ status }: { status: RowFlashStatus }) {
  const cfg = FLASH_CONFIG[status];
  const Icon = cfg.icon;
  return (
    <Badge variant="outline" className={cn('text-[9px] px-1 py-0 gap-0.5 animate-in fade-in duration-300', cfg.className)}>
      <Icon className="h-2.5 w-2.5" />
      {cfg.label}
    </Badge>
  );
}

// ── Expanded detail with "Why?" evidence panel ─────────────
function ExpandedResourceDetail({ resource: r, state }: { resource: CanonicalResourceStatus; state: ControlPlaneState }) {
  const evidence = deriveStateEvidence(r, state);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
      {/* WHY? */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Why: {CONTROL_PLANE_LABELS[state]}</h4>
        <p className="text-muted-foreground italic">{evidence.reason}</p>
        <div className="space-y-1 mt-2">
          {evidence.evidence.map((e, i) => (
            <div key={i} className="flex items-center gap-2">
              {e.pass
                ? <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                : <XCircle className="h-3 w-3 text-destructive shrink-0" />
              }
              <span className="text-muted-foreground">{e.label}</span>
              <span className="ml-auto font-mono tabular-nums">{e.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Knowledge Items */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Knowledge Items</h4>
        <div className="space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Total KIs</span><span className="font-medium tabular-nums">{r.knowledge_item_count}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Active KIs</span><span className="font-medium tabular-nums">{r.active_ki_count}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">With Contexts</span><span className="font-medium tabular-nums">{r.active_ki_with_context_count}</span></div>
        </div>
      </div>

      {/* Pipeline Facts */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Pipeline Facts</h4>
        <div className="space-y-1">
          <div className="flex justify-between"><span className="text-muted-foreground">Internal Stage</span><span className="font-mono text-[10px]">{r.canonical_stage}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Enriched</span><span>{r.is_enriched ? '✓ Yes' : '✗ No'}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">Content Backed</span><span>{r.is_content_backed ? '✓ Yes' : '✗ No'}</span></div>
          {r.blocked_reason !== 'none' && (
            <div className="flex justify-between"><span className="text-muted-foreground">Blocked</span><span className="text-destructive font-medium">{r.blocked_reason.replace(/_/g, ' ')}</span></div>
          )}
          <div className="flex justify-between"><span className="text-muted-foreground">Last Updated</span><span>{r.last_transition_at ? new Date(r.last_transition_at).toLocaleString() : '—'}</span></div>
        </div>
      </div>
    </div>
  );
}
