import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { deriveResourceTruth } from '@/lib/resourceTruthState';
import { Sparkles, Wrench, Tag, Loader2 as Loader2Icon } from 'lucide-react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useResourceJobProgress, getJobLabel, isJobStale } from '@/store/useResourceJobProgress';
import { Progress } from '@/components/ui/progress';
import { formatRelativeTime } from '@/hooks/useReExtractResource';
import { PRIMARY_ACTIONS } from '@/components/prep/QueueActionBar';
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
  Star, BookOpen, Activity, Shuffle, Clock, TrendingDown,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { type EnrichmentStatus, getResourceOrigin } from '@/lib/resourceEligibility';
import { detectDrift } from '@/lib/resourceLifecycle';
import { deriveProcessingState, getProcessingStateColor } from '@/lib/processingState';
import { routeFailure, getFailureBucketActions } from '@/lib/failureRouting';
import { useCanonicalLifecycle, type BlockedReason } from '@/hooks/useCanonicalLifecycle';
import { useInUseResources } from '@/hooks/useInUseResources';
import { useIsMobile } from '@/hooks/use-mobile';
import type { AudioFailureCode, AudioPipelineStage } from '@/lib/salesBrain/audioPipeline';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import type { Resource } from '@/hooks/useResources';
import { ResourceInspectPanel } from './ResourceInspectPanel';
import { decodeHTMLEntities } from '@/lib/stringUtils';
import { SystemHealthBar } from './SystemHealthBar';
import { ResourceCard } from './ResourceCard';
import { NeedsAttentionQueue } from './NeedsAttentionQueue';
import { ProcessingStatusBar } from './ProcessingStatusBar';
import { CollectionBrowser } from './CollectionBrowser';
import { CatchupDashboard } from './CatchupDashboard';
import { LibraryTrustSummary } from './LibraryTrustSummary';
import { deriveResourceInsight, deriveReadiness } from '@/lib/resourceSignal';
import type { ReadinessBucket } from '@/lib/resourceAudit';
import {
  isAudioResource, getAudioStageLabel,
  getAudioFailureDescription,
} from '@/lib/salesBrain/audioPipeline';

// ── Types ──────────────────────────────────────────────────
type SortKey = 'title' | 'created_at' | 'signal' | 'readiness';
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
  onBulkAction?: (action: string, resourceIds: string[]) => void;
  audioJobsMap?: Map<string, AudioJobRecord>;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  lastFixResult?: import('@/lib/fixAllAutoBlockers').FixAllResult | null;
  /** Live fix-all progress message */
  fixAllProgressMessage?: string | null;
  /** Is fix-all currently running? */
  isFixAllRunning?: boolean;
  /** External filter override (e.g. from NeedsAttentionQueue) */
  externalHealthFilter?: string | null;
}

// ── Health filter type ─────────────────────────────────────
type HealthFilter = 'all' | 'ready' | 'improving' | 'blocked' | 'failed' | 'missing_content' | 'needs_extraction' | 'needs_review'
  | 'needs_enrichment' | 'needs_activation' | 'stalled' | 'qa_required' | 'needs_auth' | 'contradictions';

// ── Spot check presets ─────────────────────────────────────
type SpotCheck = 'none' | 'recent' | 'failed' | 'low_yield' | 'random' | 'high_signal' | 'limited_readiness' | 'random_ready' | 'random_lessons';

const SPOT_CHECK_LABELS: Record<SpotCheck, string> = {
  none: 'All',
  recent: 'Recent Uploads',
  failed: 'Failed',
  low_yield: 'Low Yield',
  random: 'Random 10',
  high_signal: 'High Signal',
  limited_readiness: 'Limited Readiness',
  random_ready: 'Random 5 Ready',
  random_lessons: 'Random 5 Lessons',
};

// ── Collection grouping ────────────────────────────────────
const COLLECTION_TAGS = ['AE Operating System', 'Sales Introverts', '30MPC'];

// ── Blocked bucket mapping (for bulk actions) ──────────────
const BLOCKED_TO_BUCKET: Record<string, ReadinessBucket> = {
  no_extraction: 'extractable_not_operationalized',
  no_activation: 'operationalized',
  missing_contexts: 'content_backed_needs_fix',
  stale_blocker_state: 'blocked_incorrectly',
  empty_content: 'missing_content',
  none: 'ready',
};

interface SelectionAnalysis {
  dominant: ReadinessBucket;
  dominantCount: number;
  total: number;
  isMixed: boolean;
  breakdown: { bucket: ReadinessBucket; count: number; label: string }[];
}

const BUCKET_FRIENDLY_LABEL: Partial<Record<ReadinessBucket, string>> = {
  extractable_not_operationalized: 'need extraction',
  operationalized: 'need activation',
  content_backed_needs_fix: 'need context fix',
  missing_content: 'need content fix',
  blocked_incorrectly: 'need review',
  junk_or_low_signal: 'are low-value / junk',
  ready: 'are ready',
  low_quality_extraction: 'need re-extraction',
  needs_tagging: 'need tagging',
  orphaned_or_inconsistent: 'need review',
};

function analyzeSelection(
  selectedIds: Set<string>,
  lifecycleMap: Map<string, { stage: string; blocked: string }>,
): SelectionAnalysis {
  const counts: Record<string, number> = {};
  for (const id of selectedIds) {
    const lc = lifecycleMap.get(id);
    const bucket = lc ? (BLOCKED_TO_BUCKET[lc.blocked] ?? 'extractable_not_operationalized') : 'extractable_not_operationalized';
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const entries = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => ({ bucket: k as ReadinessBucket, count: v, label: BUCKET_FRIENDLY_LABEL[k as ReadinessBucket] ?? k }));
  const total = selectedIds.size;
  let dominant = entries[0]?.bucket ?? 'extractable_not_operationalized';
  const dominantCount = entries[0]?.count ?? 0;
  const isMixed = entries.length > 1;
  if (dominant === 'junk_or_low_signal' && dominantCount / total <= 0.6) {
    dominant = 'extractable_not_operationalized';
  }
  return { dominant, dominantCount, total, isMixed, breakdown: entries };
}

// ── Sort ───────────────────────────────────────────────────
function sortResources(
  resources: Resource[],
  key: SortKey,
  dir: SortDir,
  lifecycleMap: Map<string, any>,
): Resource[] {
  return [...resources].sort((a, b) => {
    let av: any, bv: any;
    switch (key) {
      case 'title': av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
      case 'created_at': av = a.created_at; bv = b.created_at; break;
      case 'signal': {
        const la = lifecycleMap.get(a.id);
        const lb = lifecycleMap.get(b.id);
        const sa = la?.activeKiWithCtx ?? 0;
        const sb = lb?.activeKiWithCtx ?? 0;
        av = sa; bv = sb; break;
      }
      case 'readiness': {
        const la = lifecycleMap.get(a.id);
        const lb = lifecycleMap.get(b.id);
        const order = { operationalized: 3, activated: 2, knowledge_extracted: 1 };
        av = order[la?.stage as keyof typeof order] ?? 0;
        bv = order[lb?.stage as keyof typeof order] ?? 0;
        break;
      }
      default: av = ''; bv = '';
    }
    if (av < bv) return dir === 'asc' ? -1 : 1;
    if (av > bv) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

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
  onBulkAction,
  audioJobsMap,
  onRefresh,
  isRefreshing,
  lastFixResult,
}: ResourceLibraryTableProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [healthFilter, setHealthFilter] = useState<HealthFilter>('all');
  const [spotCheck, setSpotCheck] = useState<SpotCheck>('none');
  const [collectionFilter, setCollectionFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [mobileInspectId, setMobileInspectId] = useState<string | null>(null);
  const { summary: lifecycle } = useCanonicalLifecycle();
  const { data: inUseData } = useInUseResources();
  const inUseIds = inUseData?.inUseResourceIds ?? new Set<string>();
  const liveJobResources = useResourceJobProgress(s => s.resources);
  const batchActive = useResourceJobProgress(s => s.batchActive);
  const isMobile = useIsMobile();

  const scrollBodyRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Build lifecycle lookup
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

  // Available collections from resource tags
  const availableCollections = useMemo(() => {
    const found = new Set<string>();
    for (const r of resources) {
      const tags = (r as any).tags as string[] | null;
      if (tags) {
        for (const t of tags) {
          if (COLLECTION_TAGS.some(ct => t.toLowerCase().includes(ct.toLowerCase()))) {
            found.add(t);
          }
        }
      }
    }
    return Array.from(found).sort();
  }, [resources]);

  // Filter pipeline
  const filtered = useMemo(() => {
    let result = [...resources];

    // Health filter
    if (healthFilter !== 'all') {
      result = result.filter(r => {
        const lc = lifecycleMap.get(r.id);
        const truth = deriveResourceTruth(r, lc, audioJobsMap?.get(r.id));
        switch (healthFilter) {
          case 'ready': return truth.truth_state === 'ready';
          case 'improving': return truth.truth_state === 'processing';
          case 'blocked': return truth.truth_state === 'blocked' || truth.truth_state === 'quarantined';
          case 'failed': return r.enrichment_status === 'failed';
          case 'stalled': return truth.truth_state === 'stalled';
          case 'qa_required': return truth.truth_state === 'qa_required';
          case 'missing_content': return truth.primary_blocker?.type === 'missing_content';
          case 'needs_extraction': return truth.primary_blocker?.type === 'needs_extraction';
          case 'needs_enrichment': return truth.primary_blocker?.type === 'needs_enrichment';
          case 'needs_activation': return truth.primary_blocker?.type === 'needs_activation';
          case 'needs_auth': return truth.primary_blocker?.type === 'needs_auth' || truth.primary_blocker?.type === 'route_manual_assist';
          case 'needs_review': return truth.truth_state === 'qa_required' || truth.primary_blocker?.type === 'qa_required';
          case 'contradictions': return truth.truth_state === 'quarantined';
          default: return true;
        }
      });
    }

    // Collection filter
    if (collectionFilter !== 'all') {
      result = result.filter(r => {
        const tags = (r as any).tags as string[] | null;
        return tags?.some(t => t === collectionFilter);
      });
    }

    // Search
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(r => r.title.toLowerCase().includes(q));
    }

    // Spot check
    if (spotCheck !== 'none') {
      switch (spotCheck) {
        case 'recent':
          result = [...result].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 20);
          break;
        case 'failed':
          result = result.filter(r => r.enrichment_status === 'failed');
          break;
        case 'low_yield':
          result = result.filter(r => {
            const lc = lifecycleMap.get(r.id);
            return lc && lc.kiCount > 0 && lc.kiCount <= 2;
          });
          break;
        case 'random':
          result = [...result].sort(() => Math.random() - 0.5).slice(0, 10);
          break;
        case 'high_signal':
          result = result.filter(r => {
            const lc = lifecycleMap.get(r.id);
            return lc && lc.activeKiWithCtx > 0;
          });
          break;
        case 'limited_readiness':
          result = result.filter(r => {
            const lc = lifecycleMap.get(r.id);
            const { readiness } = deriveReadiness(lc, r, audioJobsMap?.get(r.id));
            return readiness === 'improving';
          });
          break;
        case 'random_ready':
          result = result.filter(r => {
            const lc = lifecycleMap.get(r.id);
            return lc?.stage === 'operationalized';
          }).sort(() => Math.random() - 0.5).slice(0, 5);
          break;
        case 'random_lessons':
          result = result.filter(r => r.title.includes(' > ')).sort(() => Math.random() - 0.5).slice(0, 5);
          break;
      }
    }

    return sortResources(result, sortKey, sortDir, lifecycleMap);
  }, [resources, healthFilter, collectionFilter, search, spotCheck, sortKey, sortDir, lifecycleMap, audioJobsMap]);

  const allSelected = filtered.length > 0 && filtered.every(r => selectedIds.has(r.id));
  const hasSelection = selectedIds.size > 0;

  const handleSort = useCallback((key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir('asc'); }
  }, [sortKey]);

  const handleScroll = useCallback(() => {
    const el = scrollBodyRef.current;
    if (el) setShowScrollTop(el.scrollTop > 300);
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

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
  };

  // Active filter label for display
  const activeFilterLabel = useMemo(() => {
    const labels: Record<string, string> = {
      all: '', ready: 'Ready', improving: 'Processing', blocked: 'Blocked', failed: 'Failed',
      stalled: 'Stalled', qa_required: 'QA Required', missing_content: 'Missing Content',
      needs_extraction: 'Needs Extraction', needs_enrichment: 'Needs Enrichment',
      needs_activation: 'Needs Activation', needs_auth: 'Auth Required',
      needs_review: 'Needs Review', contradictions: 'Contradictions',
    };
    return labels[healthFilter] ?? '';
  }, [healthFilter]);

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 160px)', minHeight: '450px' }}>
      {/* Library Trust Summary */}
      <div className="shrink-0 pb-2 border-b border-border mb-2">
        <LibraryTrustSummary
          resources={resources}
          lifecycleMap={lifecycleMap}
          audioJobsMap={audioJobsMap}
          onFixAllAuto={onBulkAction ? (ids) => onBulkAction('fix_all_auto', ids) : undefined}
          onFilterChange={(f) => setHealthFilter(f as HealthFilter)}
          onRefresh={onRefresh}
          isRefreshing={isRefreshing}
          lastFixResult={lastFixResult}
        />
      </div>

      {/* Active filter indicator */}
      {healthFilter !== 'all' && (
        <div className="shrink-0 flex items-center gap-2 px-2 py-1.5 mb-2 rounded-md bg-primary/5 border border-primary/20">
          <Filter className="h-3 w-3 text-primary" />
          <span className="text-xs text-foreground font-medium">Filtered: {activeFilterLabel}</span>
          <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10px] ml-auto" onClick={() => setHealthFilter('all')}>
            <X className="h-3 w-3 mr-0.5" /> Clear
          </Button>
        </div>
      )}

      {/* System Health Overview */}
      <div className="shrink-0 pb-2 border-b border-border mb-2">
        <SystemHealthBar
          resources={resources}
          lifecycleMap={lifecycleMap}
          audioJobsMap={audioJobsMap}
          onFilterChange={(f) => setHealthFilter(f as HealthFilter)}
          activeFilter={healthFilter}
        />
      </div>

      {/* Processing Status */}
      <div className="shrink-0 mb-2">
        <ProcessingStatusBar resources={resources} />
      </div>

      {/* Catch-Up Dashboard */}
      <div className="shrink-0 mb-2">
        <CatchupDashboard />
      </div>

      {/* Needs Attention Queue */}
      <div className="shrink-0 mb-2">
        <NeedsAttentionQueue
          resources={resources}
          lifecycleMap={lifecycleMap}
          audioJobsMap={audioJobsMap}
          onAction={onAction}
          onBulkAction={onBulkAction}
          onInspect={(r) => isMobile ? setMobileInspectId(r.id) : setExpandedId(r.id)}
        />
      </div>

      {/* Collections sidebar on desktop, inline on mobile */}
      {!isMobile && (
        <div className="shrink-0 mb-2">
          <CollectionBrowser
            resources={resources}
            lifecycleMap={lifecycleMap}
            onFilterByCollection={(id) => {
              if (!id) { setCollectionFilter('all'); return; }
              if (id.startsWith('implicit:')) {
                const prefix = id.replace('implicit:', '');
                setSearch(prefix + ' > ');
                setCollectionFilter('all');
              } else {
                setCollectionFilter(id);
              }
            }}
            activeCollectionId={collectionFilter !== 'all' ? collectionFilter : null}
          />
        </div>
      )}

      {/* Search + spot check + collections */}
      <div className="flex items-center gap-2 flex-wrap py-1.5 shrink-0">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search resources..."
            className="pl-8 h-8 text-xs"
          />
        </div>

        {/* Spot check */}
        <Select value={spotCheck} onValueChange={v => setSpotCheck(v as SpotCheck)}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="Spot Check" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SPOT_CHECK_LABELS) as SpotCheck[]).map(k => (
              <SelectItem key={k} value={k}>{SPOT_CHECK_LABELS[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Collections */}
        {availableCollections.length > 0 && (
          <Select value={collectionFilter} onValueChange={setCollectionFilter}>
            <SelectTrigger className="h-8 w-[150px] text-xs">
              <SelectValue placeholder="Collection" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Collections</SelectItem>
              {availableCollections.map(c => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Sort */}
        {!isMobile && (
          <Select value={`${sortKey}_${sortDir}`} onValueChange={v => {
            const [k, d] = v.split('_') as [SortKey, SortDir];
            setSortKey(k); setSortDir(d);
          }}>
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <ArrowUpDown className="h-3 w-3 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at_desc">Newest</SelectItem>
              <SelectItem value="created_at_asc">Oldest</SelectItem>
              <SelectItem value="title_asc">Title A-Z</SelectItem>
              <SelectItem value="signal_desc">Signal ↓</SelectItem>
              <SelectItem value="readiness_desc">Readiness ↓</SelectItem>
            </SelectContent>
          </Select>
        )}

        {(healthFilter !== 'all' || search || spotCheck !== 'none' || collectionFilter !== 'all') && (
          <Button variant="ghost" size="sm" className="h-8 text-xs gap-1"
            onClick={() => { setHealthFilter('all'); setSearch(''); setSpotCheck('none'); setCollectionFilter('all'); }}>
            <X className="h-3 w-3" /> Clear
          </Button>
        )}

        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} of {resources.length}
        </span>
      </div>

      {/* Main content area */}
      <div className="flex-1 min-h-0 border border-border rounded-lg flex flex-col overflow-hidden relative">
        <div
          ref={scrollBodyRef}
          className="flex-1 min-h-0 overflow-y-auto"
          style={{ paddingBottom: hasSelection ? '72px' : '8px' }}
        >
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <FileText className="h-6 w-6 mb-2 opacity-40" />
              <p className="text-sm">No resources match filters</p>
            </div>
          ) : isMobile ? (
            /* ── MOBILE: Card layout ──────────────────────── */
            <div className="p-2 space-y-2">
              {filtered.map(resource => (
                <ResourceCard
                  key={resource.id}
                  resource={resource}
                  lc={lifecycleMap.get(resource.id)}
                  audioJob={audioJobsMap?.get(resource.id) ?? null}
                  isSelected={selectedIds.has(resource.id)}
                  onToggleSelect={onToggleSelect}
                  onAction={(action, r) => {
                    if (action === 'view') { setMobileInspectId(r.id); return; }
                    onAction(action, r);
                  }}
                />
              ))}
            </div>
          ) : (
            /* ── DESKTOP: Simplified table ────────────────── */
            <table className="w-full caption-bottom text-sm">
              <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm border-b border-border">
                <tr>
                  <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-10">
                    <Checkbox checked={allSelected} onCheckedChange={onToggleSelectAll} aria-label="Select all" />
                  </th>
                  <th
                    className="h-9 px-3 text-left align-middle font-medium text-muted-foreground cursor-pointer select-none hover:bg-muted/70 transition-colors text-xs"
                    onClick={() => handleSort('title')}
                  >
                    <div className="flex items-center gap-1">Resource <SortIcon col="title" /></div>
                  </th>
                  <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-[100px] text-xs">
                    Action
                  </th>
                  <th className="h-9 px-3 text-left align-middle font-medium text-muted-foreground w-[40px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map(resource => {
                  const lc = lifecycleMap.get(resource.id);
                  const audioJob = audioJobsMap?.get(resource.id) ?? null;
                  const insight = deriveResourceInsight(resource, lc, audioJob);
                  const isSelected = selectedIds.has(resource.id);
                  const drift = detectDrift(resource);
                  const decoded = decodeHTMLEntities(resource.title);
                  const separatorIdx = decoded.indexOf(' > ');
                  const parentName = separatorIdx > 0 ? decoded.slice(0, separatorIdx) : null;
                  const childName = separatorIdx > 0 ? decoded.slice(separatorIdx + 3) : decoded;
                  const liveJob = liveJobResources[resource.id];

                  return (
                    <React.Fragment key={resource.id}>
                      <tr
                        className={cn(
                          'cursor-pointer border-b border-border transition-colors hover:bg-muted/50 [&>td]:py-2',
                          isSelected && 'bg-primary/5',
                          expandedId === resource.id && 'bg-primary/5 border-b-0 border-l-2 border-l-primary',
                          drift.hasDrift && 'border-l-2 border-l-amber-500',
                        )}
                        onClick={() => setExpandedId(prev => prev === resource.id ? null : resource.id)}
                      >
                        {/* Checkbox */}
                        <td className="px-3 align-middle" onClick={e => e.stopPropagation()}>
                          <Checkbox checked={isSelected} onCheckedChange={() => onToggleSelect(resource.id)} />
                        </td>

                        {/* Title + signal + readiness */}
                        <td className="px-3 align-middle">
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {parentName && (
                                <span className="text-[9px] text-muted-foreground truncate max-w-[120px]">{parentName} ›</span>
                              )}
                              <p className="text-sm font-medium text-foreground truncate max-w-[300px]">{childName}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              {/* Signal indicator */}
                              <div className="flex items-center gap-0.5">
                                {insight.signal.signal === 'high' && <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                                {insight.signal.signal === 'medium' && <Activity className="h-3 w-3 text-amber-600" />}
                                {insight.signal.signal === 'low' && <AlertTriangle className="h-3 w-3 text-muted-foreground" />}
                                <span className={cn('text-[10px] font-medium', insight.signal.signalColor)}>
                                  {insight.signal.signalLabel}
                                </span>
                              </div>
                              {/* Readiness badge */}
                              <Badge className={cn(
                                'text-[9px] h-4 px-1.5',
                                insight.readiness.readinessBg,
                                insight.readiness.readinessColor,
                              )}>
                                {insight.readiness.readinessLabel}
                              </Badge>
                              {/* KI count */}
                              {lc && lc.kiCount > 0 && (
                                <span className="text-[9px] text-muted-foreground">
                                  {lc.activeKi}/{lc.kiCount} KI
                                </span>
                              )}
                              {/* In use badge */}
                              {inUseIds.has(resource.id) && (
                                <Badge variant="outline" className="text-[8px] h-4 px-1 border-blue-500/40 text-blue-600">In Use</Badge>
                              )}
                            </div>
                            {/* Live job progress */}
                            {liveJob && liveJob.status === 'running' && (
                              <div className="flex items-center gap-2 mt-0.5">
                                <Loader2Icon className="h-3 w-3 animate-spin text-primary shrink-0" />
                                <Progress value={50} className="h-1.5 flex-1 max-w-[120px]" />
                                <span className="text-[9px] text-muted-foreground">{getJobLabel(liveJob.jobType, 'running')}</span>
                              </div>
                            )}
                            {/* Blocked reason inline */}
                            {lc && lc.blocked !== 'none' && (
                              <p className="text-[9px] text-destructive/80 mt-0.5">
                                {lc.blocked.replace(/_/g, ' ')}
                              </p>
                            )}
                            {drift.hasDrift && (
                              <p className="text-[9px] text-amber-600 flex items-center gap-0.5 mt-0.5">
                                <AlertTriangle className="h-2.5 w-2.5" />
                                Drift: {drift.issues[0]}
                              </p>
                            )}
                          </div>
                        </td>

                        {/* Next Action */}
                        <td className="px-3 align-middle" onClick={e => e.stopPropagation()}>
                          {insight.nextAction ? (
                            <Button
                              size="sm"
                              variant={insight.nextAction.variant}
                              className="h-7 text-xs px-2.5"
                              onClick={() => onAction(insight.nextAction!.actionKey, resource)}
                            >
                              {insight.nextAction.label}
                            </Button>
                          ) : (
                            <Badge className="text-[9px] bg-emerald-500/10 text-emerald-600">
                              Complete
                            </Badge>
                          )}
                        </td>

                        {/* Menu */}
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
                              {isAudioResource(resource.file_url, resource.resource_type) && (
                                <DropdownMenuItem onClick={() => onAction('inspect_audio', resource)}>
                                  <Info className="h-3.5 w-3.5 mr-2" /> Audio Inspector
                                </DropdownMenuItem>
                              )}
                              {(() => {
                                const ps = deriveProcessingState(resource, audioJob);
                                const items: React.ReactNode[] = [];
                                if (ps.state === 'READY' && resource.file_url?.startsWith('http')) {
                                  items.push(<DropdownMenuItem key="enrich" onClick={() => onAction('deep_enrich', resource)}>
                                    <Zap className="h-3.5 w-3.5 mr-2" /> Deep Enrich
                                  </DropdownMenuItem>);
                                }
                                if (ps.state === 'COMPLETED' && resource.file_url?.startsWith('http')) {
                                  items.push(<DropdownMenuItem key="reenrich" onClick={() => onAction('re_enrich', resource)}>
                                    <RefreshCw className="h-3.5 w-3.5 mr-2" /> Re-enrich
                                  </DropdownMenuItem>);
                                }
                                if (ps.state === 'RETRYABLE_FAILURE' || ps.state === 'MANUAL_REQUIRED' || ps.state === 'METADATA_ONLY') {
                                  const routing = routeFailure(resource.file_url, resource.resource_type ?? undefined, undefined, resource.failure_reason ?? undefined);
                                  const bucketActions = getFailureBucketActions(routing.bucket);
                                  for (const ba of bucketActions) {
                                    const icon = ba.icon === 'retry' ? <RefreshCw className="h-3.5 w-3.5 mr-2" />
                                      : ba.icon === 'inspect_audio' ? <Info className="h-3.5 w-3.5 mr-2" />
                                      : ba.icon === 'mark_metadata' ? <CheckCircle2 className="h-3.5 w-3.5 mr-2" />
                                      : <HelpCircle className="h-3.5 w-3.5 mr-2" />;
                                    items.push(<DropdownMenuItem key={ba.action} onClick={() => onAction(ba.action === 'mark_metadata_only' ? 'mark_metadata_only' : ba.action, resource)}>
                                      {icon} {ba.label}
                                    </DropdownMenuItem>);
                                  }
                                }
                                if (ps.state === 'READY' || ps.state === 'COMPLETED') {
                                  items.push(<DropdownMenuItem key="manual" onClick={() => onAction('manual_assist', resource)}>
                                    <HelpCircle className="h-3.5 w-3.5 mr-2" /> Manual Assist
                                  </DropdownMenuItem>);
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
                      {expandedId === resource.id && (
                        <tr className="bg-card">
                          <td colSpan={4} className="p-0 relative z-10 bg-card">
                            <ResourceInspectPanel
                              resource={resource}
                              onClose={() => setExpandedId(null)}
                              onAction={onAction}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
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

        {/* Bulk action bar */}
        {hasSelection && (() => {
          const analysis = analyzeSelection(selectedIds, lifecycleMap);
          const action = PRIMARY_ACTIONS[analysis.dominant];
          const Icon = action.icon;
          return (
            <div className="absolute bottom-0 left-0 right-0 z-20 bg-card/95 backdrop-blur-sm border-t border-border px-4 py-2 space-y-1">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium">{selectedIds.size} selected</span>
                <Button size="sm" variant={action.variant === 'destructive' ? 'destructive' : 'default'} className="h-7 text-xs gap-1"
                  onClick={() => onAction(`bulk_${action.actionType}`, { id: '' } as Resource)}>
                  <Icon className="h-3 w-3" />
                  {action.label}
                </Button>
                <Button size="sm" variant="destructive" className="h-7 text-xs gap-1"
                  onClick={() => onAction('bulk_delete', { id: '' } as Resource)}>
                  <Trash2 className="h-3 w-3" /> Delete
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={onToggleSelectAll}>
                  <X className="h-3 w-3 mr-1" /> Clear
                </Button>
              </div>
              {analysis.isMixed && (
                <p className="text-[10px] text-muted-foreground">
                  Primary: <span className="font-medium text-foreground">{analysis.dominantCount}/{analysis.total}</span> {analysis.breakdown[0]?.label}
                  {analysis.breakdown.slice(1).map((b, i) => (
                    <span key={b.bucket}> · {b.count} {b.label}</span>
                  ))}
                </p>
              )}
            </div>
          );
        })()}
      </div>

      {/* Mobile Inspect Sheet */}
      {isMobile && (
        <Sheet open={!!mobileInspectId} onOpenChange={(open) => { if (!open) setMobileInspectId(null); }}>
          <SheetContent side="bottom" className="h-[85vh] p-0 overflow-y-auto rounded-t-xl">
            <SheetTitle className="sr-only">Resource Inspector</SheetTitle>
            {mobileInspectId && (() => {
              const inspectResource = resources.find(r => r.id === mobileInspectId);
              if (!inspectResource) return null;
              return (
                <ResourceInspectPanel
                  resource={inspectResource}
                  onClose={() => setMobileInspectId(null)}
                  onAction={onAction}
                />
              );
            })()}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
