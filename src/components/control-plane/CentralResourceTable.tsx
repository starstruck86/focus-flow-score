/**
 * Central Resource Table — filterable, expandable rows with lifecycle state.
 */
import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  type ControlPlaneState, type ControlPlaneFilter,
  CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
  deriveControlPlaneState, matchesFilter,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

interface Props {
  resources: CanonicalResourceStatus[];
  filter: ControlPlaneFilter;
  processingIds?: Set<string>;
}

// Source type heuristic from title
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
    case 'extracted': return 'Activate KIs';
    case 'activated': return 'Ready';
    case 'blocked': {
      switch (resource.blocked_reason) {
        case 'empty_content': return 'Add content';
        case 'no_extraction': return 'Run extraction';
        case 'no_activation': return 'Activate KIs';
        case 'missing_contexts': return 'Add contexts';
        case 'stale_blocker_state': return 'Clear stale state';
        default: return 'Review';
      }
    }
    case 'processing': return 'In progress…';
    default: return '—';
  }
}

export function CentralResourceTable({ resources, filter, processingIds }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'title' | 'state' | 'kis' | 'updated'>('updated');
  const [sortAsc, setSortAsc] = useState(false);

  const rows = useMemo(() => {
    const filtered = resources
      .map(r => ({ resource: r, state: deriveControlPlaneState(r, processingIds) }))
      .filter(({ state }) => matchesFilter(state, filter));

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
  }, [resources, filter, processingIds, sortField, sortAsc]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
  };

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground text-sm">
        No resources match the current filter.
      </div>
    );
  }

  return (
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
              <TableHead className="w-32">Next Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ resource: r, state }) => {
              const isExpanded = expandedId === r.resource_id;
              const colors = CONTROL_PLANE_COLORS[state];

              return (
                <>
                  <TableRow
                    key={r.resource_id}
                    className="cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : r.resource_id)}
                  >
                    <TableCell className="p-2">
                      {isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      }
                    </TableCell>
                    <TableCell className="font-medium text-sm max-w-[200px] truncate">
                      {r.title}
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-muted-foreground">{inferSourceType(r.title)}</span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('text-[10px] font-medium', colors.text, colors.bg, colors.border)}>
                        {CONTROL_PLANE_LABELS[state]}
                      </Badge>
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
                    <TableCell>
                      <span className="text-xs font-medium text-primary">
                        {nextActionLabel(state, r)}
                      </span>
                    </TableCell>
                  </TableRow>

                  {isExpanded && (
                    <TableRow key={`${r.resource_id}-detail`}>
                      <TableCell colSpan={9} className="bg-muted/30 p-4">
                        <ExpandedResourceDetail resource={r} state={state} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        Showing {rows.length} of {resources.length} resources
      </div>
    </div>
  );
}

// ── Expanded detail view ───────────────────────────────────
function ExpandedResourceDetail({ resource: r, state }: { resource: CanonicalResourceStatus; state: ControlPlaneState }) {
  const colors = CONTROL_PLANE_COLORS[state];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
      {/* Pipeline Timeline */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Pipeline Status</h4>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Lifecycle State</span>
            <Badge variant="outline" className={cn('text-[10px]', colors.text, colors.bg)}>
              {CONTROL_PLANE_LABELS[state]}
            </Badge>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Internal Stage</span>
            <span className="font-mono">{r.canonical_stage}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Enriched</span>
            <span>{r.is_enriched ? '✓ Yes' : '✗ No'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Content Backed</span>
            <span>{r.is_content_backed ? '✓ Yes' : '✗ No'}</span>
          </div>
          {r.blocked_reason !== 'none' && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Blocked Reason</span>
              <span className="text-destructive font-medium">{r.blocked_reason.replace(/_/g, ' ')}</span>
            </div>
          )}
        </div>
      </div>

      {/* Knowledge Items */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Knowledge Items</h4>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Total KIs</span>
            <span className="font-medium tabular-nums">{r.knowledge_item_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Active KIs</span>
            <span className="font-medium tabular-nums">{r.active_ki_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">With Contexts</span>
            <span className="font-medium tabular-nums">{r.active_ki_with_context_count}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Quality</span>
            <span className={qualityColor(r.knowledge_item_count, r.active_ki_count)}>
              {qualityLabel(r.knowledge_item_count, r.active_ki_count)}
            </span>
          </div>
        </div>
      </div>

      {/* Diagnostics */}
      <div className="space-y-2">
        <h4 className="font-semibold text-foreground">Diagnostics</h4>
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Last Updated</span>
            <span>{r.last_transition_at ? new Date(r.last_transition_at).toLocaleString() : '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Next Action</span>
            <span className="text-primary font-medium">{nextActionLabel(state, r)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
