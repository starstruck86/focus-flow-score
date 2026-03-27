import { useState, useMemo, useCallback } from 'react';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown,
  MoreHorizontal, Zap, RefreshCw, RotateCcw, Trash2,
  Eye, AlertTriangle, CheckCircle2, XCircle, FileText,
  Filter, X, FileAudio, HelpCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getEnrichmentStatusLabel, getEnrichmentStatusColor,
  getRecommendedAction, type EnrichmentStatus,
} from '@/lib/resourceEligibility';
import {
  getQualityTierLabel, getQualityTierColor,
} from '@/lib/resourceQuality';
import { detectDrift } from '@/lib/resourceLifecycle';
import {
  detectResourceSubtype, getSubtypeLabel, classifyEnrichability,
  getEnrichabilityLabel, getEnrichabilityColor,
} from '@/lib/salesBrain/resourceSubtype';
import {
  isAudioResource, getAudioJobForResource, getAudioStageLabel,
} from '@/lib/salesBrain/audioPipeline';
import type { Resource } from '@/hooks/useResources';

// ── Types ──────────────────────────────────────────────────
type SortKey = 'title' | 'resource_type' | 'enrichment_status' | 'last_quality_tier' | 'last_quality_score' | 'created_at' | 'enriched_at' | 'enrichment_version' | 'subtype';
type SortDir = 'asc' | 'desc';

export interface SavedView {
  id: string;
  label: string;
  icon: React.ReactNode;
  filter: (r: Resource) => boolean;
}

interface ResourceLibraryTableProps {
  resources: Resource[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onResourceClick: (resource: Resource) => void;
  onAction: (action: string, resource: Resource) => void;
}

// ── Saved views ────────────────────────────────────────────
const SAVED_VIEWS: SavedView[] = [
  {
    id: 'all', label: 'All', icon: <FileText className="h-3 w-3" />,
    filter: () => true,
  },
  {
    id: 'needs_deep', label: 'Needs Deep Enrich', icon: <Zap className="h-3 w-3" />,
    filter: (r) => !r.enrichment_status || r.enrichment_status === 'not_enriched' || r.enrichment_status === 'incomplete',
  },
  {
    id: 'needs_reenrich', label: 'Needs Re-enrich', icon: <RefreshCw className="h-3 w-3" />,
    filter: (r) => r.enrichment_status === 'queued_for_reenrich' || r.enrichment_status === 'incomplete' || ((r as any).last_quality_tier === 'shallow' && r.enrichment_status === 'deep_enriched'),
  },
  {
    id: 'failed', label: 'Failed', icon: <XCircle className="h-3 w-3" />,
    filter: (r) => r.enrichment_status === 'failed',
  },
  {
    id: 'recent', label: 'Recently Added', icon: <FileText className="h-3 w-3" />,
    filter: (r) => Date.now() - new Date(r.created_at).getTime() < 7 * 86400000,
  },
  {
    id: 'enriched', label: 'Enriched Recently', icon: <CheckCircle2 className="h-3 w-3" />,
    filter: (r) => r.enrichment_status === 'deep_enriched' && !!r.enriched_at && Date.now() - new Date(r.enriched_at).getTime() < 7 * 86400000,
  },
  {
    id: 'shallow', label: 'Low Quality', icon: <AlertTriangle className="h-3 w-3" />,
    filter: (r) => (r as any).last_quality_tier === 'shallow' || (r as any).last_quality_tier === 'incomplete',
  },
  {
    id: 'high_quality', label: 'High Quality', icon: <CheckCircle2 className="h-3 w-3" />,
    filter: (r) => (r as any).last_quality_tier === 'complete',
  },
];

// ── Recommended action helpers ─────────────────────────────
function getActionLabel(action: string): string {
  switch (action) {
    case 'deep_enrich': return 'Deep Enrich';
    case 're_enrich': return 'Re-enrich';
    case 'retry': return 'Retry';
    case 'review_manually': return 'Review';
    case 'no_action': return '—';
    case 'ignore': return 'Ignore';
    default: return action;
  }
}

function getActionColor(action: string): string {
  switch (action) {
    case 'deep_enrich': return 'bg-primary/20 text-primary';
    case 're_enrich': return 'bg-status-yellow/20 text-status-yellow';
    case 'retry': return 'bg-orange-500/20 text-orange-600';
    case 'review_manually': return 'bg-status-red/20 text-status-red';
    case 'no_action': return 'bg-muted text-muted-foreground';
    case 'ignore': return 'bg-muted text-muted-foreground';
    default: return 'bg-muted text-muted-foreground';
  }
}

// ── Sort comparator ────────────────────────────────────────
function sortResources(resources: Resource[], key: SortKey, dir: SortDir): Resource[] {
  return [...resources].sort((a, b) => {
    let av: any, bv: any;
    switch (key) {
      case 'title': av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
      case 'resource_type': av = a.resource_type; bv = b.resource_type; break;
      case 'enrichment_status': av = a.enrichment_status || ''; bv = b.enrichment_status || ''; break;
      case 'last_quality_tier': av = (a as any).last_quality_tier || ''; bv = (b as any).last_quality_tier || ''; break;
      case 'last_quality_score': av = (a as any).last_quality_score ?? -1; bv = (b as any).last_quality_score ?? -1; break;
      case 'created_at': av = a.created_at; bv = b.created_at; break;
      case 'enriched_at': av = a.enriched_at || ''; bv = b.enriched_at || ''; break;
      case 'enrichment_version': av = a.enrichment_version ?? 0; bv = b.enrichment_version ?? 0; break;
      default: av = ''; bv = '';
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

// ── Format helpers ─────────────────────────────────────────
function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Component ──────────────────────────────────────────────
export function ResourceLibraryTable({
  resources,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onResourceClick,
  onAction,
}: ResourceLibraryTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [activeView, setActiveView] = useState('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const viewFilter = useMemo(
    () => SAVED_VIEWS.find(v => v.id === activeView)?.filter || (() => true),
    [activeView]
  );

  const filtered = useMemo(() => {
    let result = resources.filter(viewFilter);
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      result = result.filter(r => r.enrichment_status === statusFilter);
    }
    if (typeFilter !== 'all') {
      result = result.filter(r => r.resource_type === typeFilter);
    }
    return sortResources(result, sortKey, sortDir);
  }, [resources, viewFilter, search, statusFilter, typeFilter, sortKey, sortDir]);

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const resourceTypes = useMemo(() => {
    const types = new Set(resources.map(r => r.resource_type));
    return Array.from(types).sort();
  }, [resources]);

  return (
    <div className="space-y-2">
      {/* Saved views */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1">
        {SAVED_VIEWS.map(view => (
          <Button
            key={view.id}
            variant={activeView === view.id ? 'default' : 'ghost'}
            size="sm"
            className={cn('h-7 text-xs gap-1 shrink-0', activeView === view.id && 'shadow-sm')}
            onClick={() => setActiveView(view.id)}
          >
            {view.icon}
            {view.label}
            {view.id !== 'all' && (
              <span className="ml-0.5 opacity-70">
                ({resources.filter(view.filter).length})
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Search + filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="pl-8 h-8 text-xs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="not_enriched">Not Enriched</SelectItem>
            <SelectItem value="deep_enriched">Enriched</SelectItem>
            <SelectItem value="incomplete">Incomplete</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="queued_for_reenrich">Re-enrich Queued</SelectItem>
            <SelectItem value="duplicate">Duplicate</SelectItem>
            <SelectItem value="superseded">Superseded</SelectItem>
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {resourceTypes.map(t => (
              <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(statusFilter !== 'all' || typeFilter !== 'all' || search) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => { setStatusFilter('all'); setTypeFilter('all'); setSearch(''); }}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {resources.length}
        </span>
      </div>

      {/* Table */}
      <div className="border border-border rounded-lg overflow-hidden">
        <ScrollArea className="max-h-[calc(100vh-320px)]">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={onToggleSelectAll}
                    aria-label="Select all"
                  />
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors min-w-[200px]"
                  onClick={() => handleSort('title')}
                >
                  <div className="flex items-center gap-1">Title <SortIcon col="title" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[90px]"
                  onClick={() => handleSort('resource_type')}
                >
                  <div className="flex items-center gap-1">Type <SortIcon col="resource_type" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[100px]"
                  onClick={() => handleSort('subtype')}
                >
                  <div className="flex items-center gap-1">Subtype <SortIcon col="subtype" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[110px]"
                  onClick={() => handleSort('enrichment_status')}
                >
                  <div className="flex items-center gap-1">Status <SortIcon col="enrichment_status" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[90px]"
                  onClick={() => handleSort('last_quality_tier')}
                >
                  <div className="flex items-center gap-1">Quality <SortIcon col="last_quality_tier" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[60px]"
                  onClick={() => handleSort('last_quality_score')}
                >
                  <div className="flex items-center gap-1">Score <SortIcon col="last_quality_score" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[80px]"
                  onClick={() => handleSort('created_at')}
                >
                  <div className="flex items-center gap-1">Added <SortIcon col="created_at" /></div>
                </TableHead>
                <TableHead
                  className="cursor-pointer select-none hover:bg-muted/50 transition-colors w-[80px]"
                  onClick={() => handleSort('enriched_at')}
                >
                  <div className="flex items-center gap-1">Enriched <SortIcon col="enriched_at" /></div>
                </TableHead>
                <TableHead className="w-[50px]">Ver</TableHead>
                <TableHead className="w-[90px]">Action</TableHead>
                <TableHead className="w-[40px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={12} className="text-center py-12 text-muted-foreground">
                    <FileText className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No resources match filters</p>
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map(resource => {
                  const recommended = getRecommendedAction(resource);
                  const drift = detectDrift(resource);
                  const isSelected = selectedIds.has(resource.id);

                  return (
                    <TableRow
                      key={resource.id}
                      className={cn(
                        'cursor-pointer',
                        isSelected && 'bg-primary/5',
                        drift.hasDrift && 'border-l-2 border-l-status-yellow',
                      )}
                      onClick={() => onResourceClick(resource)}
                    >
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(resource.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate max-w-[280px]">{resource.title}</p>
                          {drift.hasDrift && (
                            <p className="text-[10px] text-status-yellow flex items-center gap-0.5 mt-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Drift: {drift.issues[0]}
                            </p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground capitalize">{resource.resource_type}</span>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const subtype = detectResourceSubtype(resource.file_url, resource.resource_type);
                          const ea = classifyEnrichability(resource.file_url, resource.resource_type);
                          return (
                            <Badge className={cn('text-[8px]', getEnrichabilityColor(ea.enrichability))} title={ea.reason}>
                              {getSubtypeLabel(subtype)}
                            </Badge>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <Badge className={cn('text-[9px]', getEnrichmentStatusColor(resource.enrichment_status))}>
                          {getEnrichmentStatusLabel(resource.enrichment_status)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {(resource as any).last_quality_tier ? (
                          <Badge className={cn('text-[9px]', getQualityTierColor((resource as any).last_quality_tier))}>
                            {getQualityTierLabel((resource as any).last_quality_tier)}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <span className="text-xs text-muted-foreground">
                          {(resource as any).last_quality_score != null
                            ? Math.round((resource as any).last_quality_score)
                            : '—'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-muted-foreground">{formatDate(resource.created_at)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-muted-foreground">{formatDate(resource.enriched_at)}</span>
                      </TableCell>
                      <TableCell>
                        <span className="text-[11px] text-muted-foreground">v{resource.enrichment_version ?? 0}</span>
                      </TableCell>
                      <TableCell>
                        {recommended.action !== 'no_action' ? (
                          <Badge className={cn('text-[9px] cursor-pointer', getActionColor(recommended.action))}
                            onClick={e => { e.stopPropagation(); onAction(recommended.action, resource); }}
                          >
                            {getActionLabel(recommended.action)}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell onClick={e => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => onAction('view', resource)}>
                              <Eye className="h-3.5 w-3.5 mr-2" /> Inspect
                            </DropdownMenuItem>
                            {resource.file_url?.startsWith('http') && (
                              <>
                                <DropdownMenuItem onClick={() => onAction('deep_enrich', resource)}>
                                  <Zap className="h-3.5 w-3.5 mr-2" /> Deep Enrich
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onAction('re_enrich', resource)}>
                                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Re-enrich
                                </DropdownMenuItem>
                              </>
                            )}
                            <DropdownMenuItem onClick={() => onAction('reset', resource)}>
                              <RotateCcw className="h-3.5 w-3.5 mr-2" /> Reset Status
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAction('mark_duplicate', resource)}>
                              <AlertTriangle className="h-3.5 w-3.5 mr-2" /> Mark Duplicate
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem className="text-destructive" onClick={() => onAction('delete', resource)}>
                              <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </div>
    </div>
  );
}
