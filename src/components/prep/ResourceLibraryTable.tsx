import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Search, ArrowUpDown, ArrowUp, ArrowDown,
  MoreHorizontal, Zap, RefreshCw, RotateCcw, Trash2,
  Eye, AlertTriangle, CheckCircle2, FileText,
  Filter, X, FileAudio, HelpCircle, Info, Inbox, ShieldAlert,
  Star, BookOpen, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type EnrichmentStatus } from '@/lib/resourceEligibility';
import {
  getQualityTierLabel, getQualityTierColor,
} from '@/lib/resourceQuality';
import { detectDrift } from '@/lib/resourceLifecycle';
import {
  detectResourceSubtype, getSubtypeLabel, classifyEnrichability,
  classifyEnrichabilityForResource,
  getEnrichabilityColor,
} from '@/lib/salesBrain/resourceSubtype';
import {
  isAudioResource, getAudioStageLabel,
  getAudioFailureDescription,
} from '@/lib/salesBrain/audioPipeline';
import {
  deriveProcessingState, getProcessingStateColor,
} from '@/lib/processingState';
import { routeFailure, getFailureBucketActions } from '@/lib/failureRouting';
import { useCanonicalLifecycle, type BlockedReason } from '@/hooks/useCanonicalLifecycle';
import { useInUseResources } from '@/hooks/useInUseResources';
import type { AudioFailureCode, AudioPipelineStage } from '@/lib/salesBrain/audioPipeline';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
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
  audioJobsMap?: Map<string, AudioJobRecord>;
}

// ── Lifecycle-based quick filters ──────────────────────────
type LifecycleFilter = 'all' | 'ready' | 'in_use' | 'blocked' | 'needs_extraction' | 'needs_activation' | 'needs_context' | 'needs_review' | 'missing_content';

const LIFECYCLE_FILTER_LABELS: Record<LifecycleFilter, string> = {
  all: 'All',
  ready: 'Ready to Use',
  in_use: 'In Use',
  blocked: 'Blocked',
  needs_extraction: 'Needs Extraction',
  needs_activation: 'Needs Activation',
  needs_context: 'Needs Context Repair',
  needs_review: 'Needs Review',
  missing_content: 'Missing Content',
};

const LIFECYCLE_FILTER_ICONS: Record<LifecycleFilter, React.ReactNode> = {
  all: <FileText className="h-3 w-3" />,
  ready: <CheckCircle2 className="h-3 w-3" />,
  in_use: <Activity className="h-3 w-3" />,
  blocked: <ShieldAlert className="h-3 w-3" />,
  needs_extraction: <Zap className="h-3 w-3" />,
  needs_activation: <Zap className="h-3 w-3" />,
  needs_context: <HelpCircle className="h-3 w-3" />,
  needs_review: <AlertTriangle className="h-3 w-3" />,
  missing_content: <Inbox className="h-3 w-3" />,
};

// ── Template status filter ────────────────────────────────
type AssetTypeFilter = 'all_assets' | 'template' | 'example' | 'reference' | 'working_asset' | 'untagged';

const ASSET_TYPE_LABELS: Record<AssetTypeFilter, string> = {
  all_assets: 'All Assets',
  template: 'Templates',
  example: 'Examples',
  reference: 'References',
  working_asset: 'Working Assets',
  untagged: 'Untagged',
};

function getAssetType(r: Resource): AssetTypeFilter {
  if (r.is_template) return 'template';
  const tc = r.template_category?.toLowerCase();
  if (tc === 'example') return 'example';
  if (tc === 'reference') return 'reference';
  if (tc === 'working_asset') return 'working_asset';
  return 'untagged';
}

function getAssetTypeLabel(r: Resource): string {
  const t = getAssetType(r);
  if (t === 'untagged') return '';
  return ASSET_TYPE_LABELS[t].replace(/s$/, ''); // singular
}

// ── Lifecycle stage label (user-facing) ───────────────────
function getStageFriendlyLabel(stage: string): string {
  switch (stage) {
    case 'operationalized': return '✓ Ready to Use';
    case 'activated': return 'Activated';
    case 'knowledge_extracted': return 'Knowledge Extracted';
    case 'tagged': return 'Tagged';
    case 'content_ready': return 'Content Ready';
    case 'uploaded': return 'Uploaded';
    default: return stage;
  }
}

// ── Next best action for blocked resources ─────────────────
function getNextBestAction(blocked: BlockedReason | string): string {
  switch (blocked) {
    case 'no_extraction': return 'Run extraction';
    case 'no_activation': return 'Activate KI';
    case 'missing_contexts': return 'Repair contexts';
    case 'empty_content': return 'Re-enrich content';
    case 'stale_blocker_state': return 'Review stale state';
    default: return '';
  }
}

function getBlockedLabel(blocked: string): string {
  switch (blocked) {
    case 'no_extraction': return 'Needs extraction';
    case 'no_activation': return 'Needs activation';
    case 'missing_contexts': return 'Needs context repair';
    case 'empty_content': return 'Missing content';
    case 'stale_blocker_state': return 'Needs review';
    default: return '';
  }
}

// (Action helpers removed — action column now uses deriveProcessingState directly)

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

type Density = 'compact' | 'comfortable' | 'expanded';
const DENSITY_ROW_CLASS: Record<Density, string> = {
  compact: '[&>td]:py-1',
  comfortable: '[&>td]:py-2',
  expanded: '[&>td]:py-3',
};

// ── Component ──────────────────────────────────────────────
export function ResourceLibraryTable({
  resources,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onResourceClick,
  onAction,
  audioJobsMap,
}: ResourceLibraryTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [lifecycleFilter, setLifecycleFilter] = useState<LifecycleFilter>('all');
  const [assetFilter, setAssetFilter] = useState<AssetTypeFilter>('all_assets');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [density, setDensity] = useState<Density>('comfortable');
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { summary: lifecycle } = useCanonicalLifecycle();
  const { data: inUseData } = useInUseResources();
  const inUseIds = inUseData?.inUseResourceIds ?? new Set<string>();

  // Build a quick lookup for canonical status per resource
  const lifecycleMap = useMemo(() => {
    const map = new Map<string, { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number }>();
    if (!lifecycle) return map;
    for (const r of lifecycle.resources) {
      map.set(r.resource_id, {
        stage: r.canonical_stage,
        blocked: r.blocked_reason,
        kiCount: r.knowledge_item_count,
        activeKi: r.active_ki_count,
        activeKiWithCtx: r.active_ki_with_context_count,
      });
    }
    return map;
  }, [lifecycle]);

  // Lifecycle filter counts from canonical data
  const filterCounts = useMemo(() => {
    const counts: Record<LifecycleFilter, number> = {
      all: resources.length,
      ready: 0, in_use: 0, blocked: 0,
      needs_extraction: 0, needs_activation: 0,
      needs_context: 0, needs_review: 0, missing_content: 0,
    };
    for (const r of resources) {
      const lc = lifecycleMap.get(r.id);
      if (!lc) continue;
      if (lc.stage === 'operationalized') counts.ready++;
      if (inUseIds.has(r.id)) counts.in_use++;
      if (lc.blocked !== 'none') {
        counts.blocked++;
        if (lc.blocked === 'no_extraction') counts.needs_extraction++;
        if (lc.blocked === 'no_activation') counts.needs_activation++;
        if (lc.blocked === 'missing_contexts') counts.needs_context++;
        if (lc.blocked === 'stale_blocker_state') counts.needs_review++;
        if (lc.blocked === 'empty_content') counts.missing_content++;
      }
    }
    return counts;
  }, [resources, lifecycleMap, inUseIds]);

  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const filtered = useMemo(() => {
    let result = [...resources];
    // Apply lifecycle filter
    if (lifecycleFilter !== 'all') {
      result = result.filter(r => {
        const lc = lifecycleMap.get(r.id);
        if (!lc) return false;
        switch (lifecycleFilter) {
          case 'ready': return lc.stage === 'operationalized';
          case 'in_use': return inUseIds.has(r.id);
          case 'blocked': return lc.blocked !== 'none';
          case 'needs_extraction': return lc.blocked === 'no_extraction';
          case 'needs_activation': return lc.blocked === 'no_activation';
          case 'needs_context': return lc.blocked === 'missing_contexts';
          case 'needs_review': return lc.blocked === 'stale_blocker_state';
          case 'missing_content': return lc.blocked === 'empty_content';
          default: return true;
        }
      });
    }
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q));
    }
    if (typeFilter !== 'all') {
      result = result.filter(r => r.resource_type === typeFilter);
    }
    if (assetFilter !== 'all_assets') {
      result = result.filter(r => getAssetType(r) === assetFilter);
    }
    return sortResources(result, sortKey, sortDir);
  }, [resources, lifecycleFilter, lifecycleMap, inUseIds, search, typeFilter, assetFilter, sortKey, sortDir]);

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  const resourceTypes = useMemo(() => {
    const types = new Set(resources.map(r => r.resource_type));
    return Array.from(types).sort();
  }, [resources]);

  const hasSelection = selectedIds.size > 0;

  // Track scroll position for scroll-to-top button
  const handleScroll = useCallback(() => {
    const el = scrollBodyRef.current;
    if (el) {
      setShowScrollTop(el.scrollTop > 300);
    }
  }, []);

  useEffect(() => {
    const el = scrollBodyRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  const scrollToTop = useCallback(() => {
    scrollBodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  return (
    <div ref={shellRef} className="flex flex-col" style={{ height: 'calc(100vh - 160px)', minHeight: '450px' }}>
      {/* Lifecycle summary strip */}
      <div className="flex items-center gap-3 py-2 px-1 shrink-0 border-b border-border mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Total</span>
          <span className="text-sm font-semibold">{filterCounts.all}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Ready to Use</span>
          <span className="text-sm font-semibold text-emerald-600">{filterCounts.ready}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">In Use</span>
          <span className="text-sm font-semibold text-blue-600">{filterCounts.in_use}</span>
        </div>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Blocked</span>
          <span className="text-sm font-semibold text-destructive">{filterCounts.blocked}</span>
        </div>
      </div>

      {/* Lifecycle quick filters */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 shrink-0">
        {(Object.keys(LIFECYCLE_FILTER_LABELS) as LifecycleFilter[]).map(key => (
          <Button
            key={key}
            variant={lifecycleFilter === key ? 'default' : 'ghost'}
            size="sm"
            className={cn('h-7 text-xs gap-1 shrink-0', lifecycleFilter === key && 'shadow-sm')}
            onClick={() => setLifecycleFilter(key)}
          >
            {LIFECYCLE_FILTER_ICONS[key]}
            {LIFECYCLE_FILTER_LABELS[key]}
            {key !== 'all' && (
              <span className="ml-0.5 opacity-70">
                ({filterCounts[key]})
              </span>
            )}
          </Button>
        ))}
      </div>

      {/* Search + filters + density — pinned top */}
      <div className="flex items-center gap-2 flex-wrap py-1.5 shrink-0">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="pl-8 h-8 text-xs"
          />
        </div>
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
        <Select value={assetFilter} onValueChange={(v) => setAssetFilter(v as AssetTypeFilter)}>
          <SelectTrigger className="h-8 w-[140px] text-xs">
            <Star className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Asset Type" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(ASSET_TYPE_LABELS) as AssetTypeFilter[]).map(k => (
              <SelectItem key={k} value={k}>{ASSET_TYPE_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(lifecycleFilter !== 'all' || typeFilter !== 'all' || assetFilter !== 'all_assets' || search) && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => { setLifecycleFilter('all'); setTypeFilter('all'); setAssetFilter('all_assets'); setSearch(''); }}
          >
            <X className="h-3 w-3" /> Clear
          </Button>
        )}

        {/* Density toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden ml-auto">
          {(['compact', 'comfortable', 'expanded'] as Density[]).map(d => (
            <button
              key={d}
              className={cn(
                'px-2 py-1 text-[10px] transition-colors',
                density === d ? 'bg-primary text-primary-foreground' : 'bg-background text-muted-foreground hover:bg-muted'
              )}
              onClick={() => setDensity(d)}
            >
              {d.charAt(0).toUpperCase() + d.slice(1, 4)}
            </button>
          ))}
        </div>

        <span className="text-xs text-muted-foreground">
          {filtered.length} of {resources.length}
        </span>
      </div>

      {/* Table shell — flex-1 takes remaining height, min-h-0 allows shrinking */}
      <div className="flex-1 min-h-0 border border-border rounded-lg flex flex-col overflow-hidden relative">
        {/* Scrollable region — THIS is the sole vertical scroll owner */}
        <div
          ref={scrollBodyRef}
          className="flex-1 min-h-0 overflow-y-auto overflow-x-auto"
          style={{ paddingBottom: hasSelection ? '72px' : '8px' }}
        >
          <table className="w-full caption-bottom text-sm">
            {/* Sticky header */}
            <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm border-b border-border">
              <tr>
                <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-10">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={onToggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors min-w-[200px] text-xs"
                  onClick={() => handleSort('title')}
                >
                  <div className="flex items-center gap-1">Title <SortIcon col="title" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[90px] text-xs"
                  onClick={() => handleSort('resource_type')}
                >
                  <div className="flex items-center gap-1">Type <SortIcon col="resource_type" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[100px] text-xs"
                  onClick={() => handleSort('subtype')}
                >
                  <div className="flex items-center gap-1">Subtype <SortIcon col="subtype" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[110px] text-xs"
                  onClick={() => handleSort('enrichment_status')}
                >
                  <div className="flex items-center gap-1">Status <SortIcon col="enrichment_status" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[90px] text-xs"
                  onClick={() => handleSort('last_quality_tier')}
                >
                  <div className="flex items-center gap-1">Quality <SortIcon col="last_quality_tier" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[60px] text-xs"
                  onClick={() => handleSort('last_quality_score')}
                >
                  <div className="flex items-center gap-1">Score <SortIcon col="last_quality_score" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[80px] text-xs"
                  onClick={() => handleSort('created_at')}
                >
                  <div className="flex items-center gap-1">Added <SortIcon col="created_at" /></div>
                </th>
                <th
                  className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors w-[80px] text-xs"
                  onClick={() => handleSort('enriched_at')}
                >
                  <div className="flex items-center gap-1">Enriched <SortIcon col="enriched_at" /></div>
                </th>
                <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-[50px] text-xs">Ver</th>
                <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-[90px] text-xs">Action</th>
                <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-[40px]" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-12 text-muted-foreground">
                    <FileText className="h-6 w-6 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No resources match filters</p>
                  </td>
                </tr>
              ) : (
                filtered.map(resource => {
                  const drift = detectDrift(resource);
                  const isSelected = selectedIds.has(resource.id);
                  const isAudio = isAudioResource(resource.file_url, resource.resource_type);
                  const audioJob = audioJobsMap?.get(resource.id) || null;
                  const lc = lifecycleMap.get(resource.id);

                  return (
                    <tr
                      key={resource.id}
                      className={cn(
                        'cursor-pointer border-b border-border transition-colors hover:bg-muted/50',
                        DENSITY_ROW_CLASS[density],
                        isSelected && 'bg-primary/5',
                        drift.hasDrift && 'border-l-2 border-l-status-yellow',
                      )}
                      onClick={() => onResourceClick(resource)}
                    >
                      <td className="px-3 align-middle" onClick={e => e.stopPropagation()}>
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => onToggleSelect(resource.id)}
                        />
                      </td>
                      <td className="px-3 align-middle">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-sm font-medium text-foreground truncate max-w-[220px]">{resource.title}</p>
                            {lc && (
                              <Badge variant="outline" className={cn(
                                'text-[8px] h-4 px-1 shrink-0',
                                lc.stage === 'operationalized' ? 'border-emerald-500/40 text-emerald-600' :
                                lc.blocked !== 'none' ? 'border-destructive/40 text-destructive' :
                                'border-border text-muted-foreground'
                              )}>
                                {lc.stage === 'operationalized' ? '✓ Ready' :
                                 lc.stage === 'activated' ? 'Activated' :
                                 lc.stage === 'knowledge_extracted' ? 'Extracted' :
                                 lc.stage === 'tagged' ? 'Tagged' :
                                 lc.stage === 'content_ready' ? 'Content' :
                                 'Uploaded'}
                              </Badge>
                            )}
                            {inUseIds.has(resource.id) && (
                              <Badge variant="outline" className="text-[8px] h-4 px-1 shrink-0 border-blue-500/40 text-blue-600">
                                In Use
                              </Badge>
                            )}
                            {lc && lc.kiCount > 0 && (
                              <span className="text-[8px] text-muted-foreground shrink-0">
                                {lc.activeKi}/{lc.kiCount} KI
                              </span>
                            )}
                          </div>
                          {lc && lc.blocked !== 'none' && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <p className="text-[9px] text-destructive/80">
                                {getBlockedLabel(lc.blocked)}
                              </p>
                              <span className="text-[9px] text-primary/80 font-medium">
                                → {getNextBestAction(lc.blocked)}
                              </span>
                            </div>
                          )}
                          {drift.hasDrift && (
                            <p className="text-[10px] text-status-yellow flex items-center gap-0.5 mt-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" />
                              Drift: {drift.issues[0]}
                            </p>
                          )}
                          {/* Manual recovery provenance badge */}
                          {((resource as any).manual_content_present || (resource as any).resolution_method) && (
                            <Badge variant="outline" className="text-[8px] h-4 px-1 mt-0.5 border-primary/30 text-primary">
                              {(resource as any).resolution_method === 'metadata_only' ? 'Metadata Only' :
                               (resource as any).resolution_method === 'manual_transcript_paste' ? 'Manual Transcript' :
                               (resource as any).resolution_method === 'manual_paste' ? 'Manual Content' :
                               (resource as any).resolution_method === 'transcript_upload' ? 'Uploaded Transcript' :
                               (resource as any).resolution_method === 'content_upload' ? 'Uploaded Content' :
                               (resource as any).resolution_method === 'alternate_url' ? 'Alternate URL' :
                               (resource as any).resolution_method === 'fixed_from_existing_content' ? 'Fixed From Content' :
                               (resource as any).resolution_method === 'manual_content' ? 'Manual Content' :
                               (resource as any).resolution_method === 'notion_zip_import' ? 'Notion ZIP Import' :
                               (resource as any).resolution_method === 'notion_zip_split' ? 'Notion Split' :
                               (resource as any).resolution_method === 'notion_zip_source' ? 'Notion Source' :
                               'Manual Recovery'}
                            </Badge>
                          )}
                          {/* Audio status inline */}
                          {isAudio && audioJob && (
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              <Badge variant="outline" className="text-[8px] h-4 px-1">
                                {getAudioStageLabel(audioJob.stage as AudioPipelineStage)}
                              </Badge>
                              {audioJob.transcript_mode && audioJob.transcript_mode !== 'direct_transcription' && (
                                <Badge variant="outline" className="text-[8px] h-4 px-1">
                                  {audioJob.transcript_mode === 'metadata_only' ? 'Metadata Only' :
                                   audioJob.transcript_mode === 'manual_assist' ? 'Manual Assist' :
                                   audioJob.transcript_mode}
                                </Badge>
                              )}
                              {audioJob.failure_code && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge variant="destructive" className="text-[8px] h-4 px-1 cursor-help">
                                      {audioJob.failure_code.replace(/_/g, ' ').toLowerCase()}
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent side="bottom" className="text-xs max-w-[250px]">
                                    {getAudioFailureDescription(audioJob.failure_code as AudioFailureCode).explanation}
                                    <br />→ {getAudioFailureDescription(audioJob.failure_code as AudioFailureCode).nextAction}
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-xs text-muted-foreground capitalize">{resource.resource_type}</span>
                      </td>
                      <td className="px-3 align-middle">
                        {(() => {
                          const subtype = detectResourceSubtype(resource.file_url, resource.resource_type);
                          const ea = classifyEnrichability(resource.file_url, resource.resource_type);
                          return (
                            <Badge className={cn('text-[8px]', getEnrichabilityColor(ea.enrichability))} title={ea.reason}>
                              {getSubtypeLabel(subtype)}
                            </Badge>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle">
                        {(() => {
                          const ps = deriveProcessingState(resource, audioJob);
                          return (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Badge className={cn('text-[9px] cursor-help', getProcessingStateColor(ps.state))}>
                                  {ps.label}
                                </Badge>
                              </TooltipTrigger>
                              <TooltipContent side="bottom" className="text-xs max-w-[250px]">
                                <p>{ps.description}</p>
                                {ps.nextAction && <p className="mt-1 text-primary">→ {ps.nextAction}</p>}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })()}
                      </td>
                      <td className="px-3 align-middle">
                        {(resource as any).last_quality_tier ? (
                          <Badge className={cn('text-[9px]', getQualityTierColor((resource as any).last_quality_tier))}>
                            {getQualityTierLabel((resource as any).last_quality_tier)}
                          </Badge>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-xs text-muted-foreground">
                          {(resource as any).last_quality_score != null
                            ? Math.round((resource as any).last_quality_score)
                            : '—'}
                        </span>
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-[11px] text-muted-foreground">{formatDate(resource.created_at)}</span>
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-[11px] text-muted-foreground">{formatDate(resource.enriched_at)}</span>
                      </td>
                      <td className="px-3 align-middle">
                        <span className="text-[11px] text-muted-foreground">v{resource.enrichment_version ?? 0}</span>
                      </td>
                      <td className="px-3 align-middle">
                        {(() => {
                          const ps = deriveProcessingState(resource, audioJob);
                          if (ps.state === 'READY' && resource.file_url?.startsWith('http')) {
                            return (
                              <Badge className={cn('text-[9px] cursor-pointer', getProcessingStateColor('READY'))}
                                onClick={e => { e.stopPropagation(); onAction('deep_enrich', resource); }}>
                                Deep Enrich
                              </Badge>
                            );
                          }
                          if (ps.state === 'RETRYABLE_FAILURE') {
                            return (
                              <Badge className={cn('text-[9px] cursor-pointer', getProcessingStateColor('RETRYABLE_FAILURE'))}
                                onClick={e => { e.stopPropagation(); onAction('deep_enrich', resource); }}>
                                Retry
                              </Badge>
                            );
                          }
                          if (ps.state === 'MANUAL_REQUIRED') {
                            return (
                              <Badge className={cn('text-[9px] cursor-pointer', getProcessingStateColor('MANUAL_REQUIRED'))}
                                onClick={e => { e.stopPropagation(); onAction('manual_assist', resource); }}>
                                Manual Assist
                              </Badge>
                            );
                          }
                          if (ps.state === 'METADATA_ONLY') {
                            return (
                              <Badge className={cn('text-[9px] cursor-pointer', getProcessingStateColor('METADATA_ONLY'))}
                                onClick={e => { e.stopPropagation(); onAction('manual_assist', resource); }}>
                                Manual Assist
                              </Badge>
                            );
                          }
                          if (ps.state === 'COMPLETED' && resource.file_url?.startsWith('http')) {
                            return (
                              <Badge className={cn('text-[9px] cursor-pointer', getProcessingStateColor('COMPLETED'))}
                                onClick={e => { e.stopPropagation(); onAction('re_enrich', resource); }}>
                                Re-enrich
                              </Badge>
                            );
                          }
                          return <span className="text-[10px] text-muted-foreground">—</span>;
                        })()}
                      </td>
                      <td className="px-3 align-middle" onClick={e => e.stopPropagation()}>
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
                            {isAudio && (
                              <DropdownMenuItem onClick={() => onAction('inspect_audio', resource)}>
                                <Info className="h-3.5 w-3.5 mr-2" /> Audio Inspector
                              </DropdownMenuItem>
                            )}
                            {/* State-driven actions — failure-bucket-aware */}
                            {(() => {
                              const ps = deriveProcessingState(resource, audioJob);
                              const items: React.ReactNode[] = [];

                              if (ps.state === 'READY' && resource.file_url?.startsWith('http')) {
                                items.push(
                                  <DropdownMenuItem key="enrich" onClick={() => onAction('deep_enrich', resource)}>
                                    <Zap className="h-3.5 w-3.5 mr-2" /> Deep Enrich
                                  </DropdownMenuItem>
                                );
                              }
                              if (ps.state === 'COMPLETED' && resource.file_url?.startsWith('http')) {
                                items.push(
                                  <DropdownMenuItem key="reenrich" onClick={() => onAction('re_enrich', resource)}>
                                    <RefreshCw className="h-3.5 w-3.5 mr-2" /> Re-enrich
                                  </DropdownMenuItem>
                                );
                              }
                              // Failed states: use failure routing for precise actions
                              if (ps.state === 'RETRYABLE_FAILURE' || ps.state === 'MANUAL_REQUIRED' || ps.state === 'METADATA_ONLY') {
                                const routing = routeFailure(
                                  resource.file_url,
                                  resource.resource_type ?? undefined,
                                  undefined,
                                  resource.failure_reason ?? undefined,
                                );
                                const bucketActions = getFailureBucketActions(routing.bucket);
                                for (const ba of bucketActions) {
                                  const icon = ba.icon === 'retry' ? <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                    : ba.icon === 'inspect_audio' ? <Info className="h-3.5 w-3.5 mr-2" />
                                    : ba.icon === 'mark_metadata' ? <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                                    : <HelpCircle className="h-3.5 w-3.5 mr-2" />;
                                  items.push(
                                    <DropdownMenuItem key={ba.action} onClick={() => onAction(ba.action === 'mark_metadata_only' ? 'mark_metadata_only' : ba.action, resource)}>
                                      {icon} {ba.label}
                                    </DropdownMenuItem>
                                  );
                                }
                              }
                              // Manual Assist always available for non-RUNNING, non-failed (already covered above)
                              if (ps.state === 'READY' || ps.state === 'COMPLETED') {
                                items.push(
                                  <DropdownMenuItem key="manual" onClick={() => onAction('manual_assist', resource)}>
                                    <HelpCircle className="h-3.5 w-3.5 mr-2" /> Manual Assist
                                  </DropdownMenuItem>
                                );
                              }
                              return items;
                            })()}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => onAction('mark_template', resource)}>
                              <Star className="h-3.5 w-3.5 mr-2" /> Use as Template
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => onAction('mark_example', resource)}>
                              <BookOpen className="h-3.5 w-3.5 mr-2" /> Mark as Example
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
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
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Scroll to top */}
        {showScrollTop && (
          <button
            onClick={scrollToTop}
            className="absolute bottom-2 right-3 z-20 h-8 w-8 rounded-full bg-primary text-primary-foreground shadow-md flex items-center justify-center hover:bg-primary/90 transition-colors"
            style={{ bottom: hasSelection ? '60px' : '8px' }}
            aria-label="Scroll to top"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
        )}

        {/* Sticky bulk action bar — inside the table shell at the bottom */}
        {hasSelection && (
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 bg-card/95 backdrop-blur-sm border-t border-border px-4 py-2">
            <span className="text-sm font-medium">{selectedIds.size} selected</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1"
              onClick={() => onAction('bulk_enrich', { id: '' } as Resource)}
            >
              <Zap className="h-3 w-3" />
              Deep Enrich Selected
            </Button>
            <Button
              size="sm"
              variant="destructive"
              className="h-7 text-xs gap-1"
              onClick={() => onAction('bulk_delete', { id: '' } as Resource)}
            >
              <Trash2 className="h-3 w-3" />
              Delete Selected
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onToggleSelectAll}>
              <X className="h-3 w-3 mr-1" /> Clear
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
