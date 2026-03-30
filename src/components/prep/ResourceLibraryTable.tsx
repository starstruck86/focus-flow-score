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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type EnrichmentStatus } from '@/lib/resourceEligibility';
import {
  getQualityTierLabel, getQualityTierColor,
} from '@/lib/resourceQuality';
import { detectDrift } from '@/lib/resourceLifecycle';
import {
  detectResourceSubtype, getSubtypeLabel, classifyEnrichability,
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

// ── Saved views ────────────────────────────────────────────
// Saved view filters use a function that receives the resource and optionally an audioJobsMap
// We can't use deriveProcessingState directly in static filter since it needs audioJob,
// so we use heuristic filters that approximate canonical states
// Helper: resource has substantial content and should not appear in blocked views
function hasSubstantialContent(r: Resource): boolean {
  return ((r as any).content_length ?? 0) > 1000 || (r as any).manual_content_present === true;
}

const SAVED_VIEWS: SavedView[] = [
  {
    id: 'all', label: 'All', icon: <FileText className="h-3 w-3" />,
    filter: () => true,
  },
  {
    id: 'needs_action', label: 'Needs Action', icon: <Zap className="h-3 w-3" />,
    filter: (r) => {
      if (hasSubstantialContent(r)) return false;
      const status = r.enrichment_status;
      if (!status || status === 'not_enriched' || status === 'incomplete' || status === 'failed') return true;
      const ea = classifyEnrichability(r.file_url, r.resource_type);
      return ea.enrichability === 'manual_input_needed' || ea.enrichability === 'needs_auth';
    },
  },
  {
    id: 'retryable', label: 'Retryable', icon: <RefreshCw className="h-3 w-3" />,
    filter: (r) => {
      if (hasSubstantialContent(r)) return false;
      const status = r.enrichment_status;
      if (status === 'failed' || status === 'incomplete' || status === 'stale' || status === 'quarantined') return true;
      if ((r as any).last_quality_tier === 'shallow' && status === 'deep_enriched') return true;
      return false;
    },
  },
  {
    id: 'manual', label: 'Manual Required', icon: <HelpCircle className="h-3 w-3" />,
    filter: (r) => {
      if (hasSubstantialContent(r)) return false;
      const ea = classifyEnrichability(r.file_url, r.resource_type);
      return ea.enrichability === 'manual_input_needed' || ea.enrichability === 'needs_auth' || ea.enrichability === 'metadata_only';
    },
  },
  {
    id: 'recent', label: 'Recently Added', icon: <FileText className="h-3 w-3" />,
    filter: (r) => Date.now() - new Date(r.created_at).getTime() < 7 * 86400000,
  },
  {
    id: 'completed', label: 'Completed', icon: <CheckCircle2 className="h-3 w-3" />,
    filter: (r) => r.enrichment_status === 'deep_enriched' || hasSubstantialContent(r),
  },
  {
    id: 'audio', label: 'Audio', icon: <FileAudio className="h-3 w-3" />,
    filter: (r) => isAudioResource(r.file_url, r.resource_type),
  },
  {
    id: 'needs_input', label: 'Needs Input', icon: <Inbox className="h-3 w-3" />,
    filter: (r) => {
      if (hasSubstantialContent(r)) return false;
      const status = r.enrichment_status;
      if (status === 'quarantined') return true;
      if (status === 'failed' || status === 'incomplete') {
        const ea = classifyEnrichability(r.file_url, r.resource_type);
        return ea.enrichability === 'manual_input_needed'
          || ea.enrichability === 'needs_auth'
          || ea.enrichability === 'metadata_only';
      }
      const ea = classifyEnrichability(r.file_url, r.resource_type);
      return ea.enrichability === 'manual_input_needed' || ea.enrichability === 'needs_auth';
    },
  },
  {
    id: 'quarantined', label: 'Quarantined', icon: <ShieldAlert className="h-3 w-3" />,
    filter: (r) => r.enrichment_status === 'quarantined' && !hasSubstantialContent(r),
  },
];

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
  const [activeView, setActiveView] = useState('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [density, setDensity] = useState<Density>('comfortable');
  const [showScrollTop, setShowScrollTop] = useState(false);

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
      {/* Saved views — pinned top */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 shrink-0">
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
                          <p className="text-sm font-medium text-foreground truncate max-w-[280px]">{resource.title}</p>
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
