/**
 * Knowledge Control Plane — trust-first, lifecycle-driven, operable workspace.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { RefreshCw, Filter, Clock, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { useAutoOperationalize } from '@/hooks/useAutoOperationalize';
import { useExtractionPipeline } from '@/hooks/useExtractionPipeline';
import { UnifiedHealthStrip } from './UnifiedHealthStrip';
import { DaveReadinessStrip } from './DaveReadinessStrip';
import { ControlPlaneSummaryBar } from './ControlPlaneSummaryBar';
import { CentralResourceTable } from './CentralResourceTable';
import { ResourceInspectDrawer } from './ResourceInspectDrawer';
import { ConflictBreakdownBanner } from './ConflictBreakdownBanner';
import { BulkActionBar } from './BulkActionBar';
import { NeedsAttentionQueue, type QueueCategory, type QueueItem } from './NeedsAttentionQueue';
import { RecentActionsPanel } from './RecentActionsPanel';
import { BulkActionResultDialog } from './BulkActionResultDialog';
import { TableFilterPresets, getPinnedPreset, setPinnedPreset as savePinnedPreset } from './TableFilterPresets';
import { buildActionPreview } from './ActionPreviewDialog';
import {
  type ControlPlaneFilter, type ControlPlaneState,
  computeControlPlaneSummary,
  computeDownstreamReadiness,
  deriveControlPlaneState,
  detectAllConflicts,
  matchesFilter,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import type { BulkActionOutcome } from '@/lib/actionOutcomeStore';

export function KnowledgeControlPlane() {
  const { summary, loading, refetch, isRefetching } = useCanonicalLifecycle();
  const {
    operationalizeWithOutcome, operationalizeBatchWithOutcome,
    isRunning: opRunning, lastBulkOutcome, setLastBulkOutcome, outcomeRefreshKey,
  } = useAutoOperationalize();
  const { runBatch, isRunning: extractRunning } = useExtractionPipeline();
  const [filter, setFilter] = useState<ControlPlaneFilter>('all');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [customFilterIds, setCustomFilterIds] = useState<Set<string> | null>(null);
  const [customFilterLabel, setCustomFilterLabel] = useState<string | null>(null);

  const [didApplyPinned, setDidApplyPinned] = useState(false);

  // Inspect drawer state
  const [inspectResource, setInspectResource] = useState<CanonicalResourceStatus | null>(null);
  const [inspectState, setInspectState] = useState<ControlPlaneState | null>(null);
  const [inspectInitialTab, setInspectInitialTab] = useState<'overview' | 'content' | 'knowledge' | undefined>(undefined);

  // Bulk result dialog
  const [bulkResultOpen, setBulkResultOpen] = useState(false);
  const [bulkResultOutcome, setBulkResultOutcome] = useState<BulkActionOutcome | null>(null);

  const resources = summary?.resources ?? [];
  const actionLoading = opRunning || extractRunning;

  const processingIds = useMemo(() => new Set<string>(), []);

  const cpSummary = useMemo(
    () => computeControlPlaneSummary(resources, processingIds),
    [resources, processingIds],
  );

  const downstreamReadiness = useMemo(
    () => computeDownstreamReadiness(resources),
    [resources],
  );

  const conflicts = useMemo(() => detectAllConflicts(resources), [resources]);
  const conflictIds = useMemo(() => new Set(conflicts.map(c => c.resource_id)), [conflicts]);

  const sampleResources = useMemo(() => {
    const buckets: Record<string, CanonicalResourceStatus[]> = {
      all: resources.slice(0, 3), ready: [], needs_extraction: [],
      needs_review: [], processing: [], ingested: [],
    };
    for (const r of resources) {
      const state = deriveControlPlaneState(r, processingIds);
      if (state === 'extracted' || state === 'activated') {
        if (buckets.ready.length < 5) buckets.ready.push(r);
      } else if (state === 'has_content') {
        if (buckets.needs_extraction.length < 5) buckets.needs_extraction.push(r);
      } else if (state === 'blocked') {
        if (buckets.needs_review.length < 5) buckets.needs_review.push(r);
      } else if (state === 'processing') {
        if (buckets.processing.length < 5) buckets.processing.push(r);
      } else if (state === 'ingested') {
        if (buckets.ingested.length < 5) buckets.ingested.push(r);
      }
    }
    return buckets;
  }, [resources, processingIds]);

  const filteredResources = useMemo(() => {
    if (customFilterIds) return resources.filter(r => customFilterIds.has(r.resource_id));
    return resources.filter(r => {
      const state = deriveControlPlaneState(r, processingIds);
      return matchesFilter(state, filter, r.resource_id, conflictIds);
    });
  }, [resources, filter, processingIds, conflictIds, customFilterIds]);

  const filteredCount = filteredResources.length;

  // ── Open resource in inspect drawer by ID ────────────────
  const openResourceById = useCallback((resourceId: string, tab?: 'overview' | 'content' | 'knowledge') => {
    const r = resources.find(r => r.resource_id === resourceId);
    if (r) {
      setInspectResource(r);
      setInspectState(deriveControlPlaneState(r, processingIds));
      setInspectInitialTab(tab);
    }
  }, [resources, processingIds]);

  const handleInspect = useCallback((r: CanonicalResourceStatus, state: ControlPlaneState, tab?: 'overview' | 'content' | 'knowledge') => {
    setInspectResource(r);
    setInspectState(state);
    setInspectInitialTab(tab);
  }, []);

  // ── Row-level action handler ─────────────────────────────
  const handleAction = useCallback(async (resourceId: string, action: string) => {
    switch (action) {
      case 'extract':
      case 'enrich':
      case 'fix':
      case 'activate': {
        const resource = resources.find(r => r.resource_id === resourceId);
        if (!resource) return;
        const preState = deriveControlPlaneState(resource, processingIds);
        const preview = buildActionPreview(action, preState, resource);
        await operationalizeWithOutcome(
          resourceId, preState, preview.toState, action, preview.actionLabel, resource.title,
        );
        refetch();
        break;
      }
      case 'view_progress':
      case 'inspect':
        openResourceById(resourceId);
        break;
      default:
        toast.info(`Action "${action}" not yet implemented`);
    }
  }, [resources, processingIds, operationalizeWithOutcome, refetch, openResourceById]);

  // ── Bulk action handler ──────────────────────────────────
  const handleBulkAction = useCallback(async (action: string, currentFilter: ControlPlaneFilter) => {
    const snapshotResources = resources.filter(r => {
      const state = deriveControlPlaneState(r, processingIds);
      return matchesFilter(state, currentFilter, r.resource_id, conflictIds);
    });
    if (snapshotResources.length === 0) { toast.info('No resources to process'); return; }

    const actionLabels: Record<string, string> = {
      bulk_extract: 'Extract Knowledge (Batch)',
      bulk_enrich: 'Enrich Content (Batch)',
      bulk_review: 'Diagnose & Repair (Batch)',
    };
    const outcome = await operationalizeBatchWithOutcome(
      snapshotResources, actionLabels[action] || action, action, processingIds,
    );
    setBulkResultOutcome(outcome);
    setBulkResultOpen(true);
    refetch();
  }, [resources, processingIds, conflictIds, operationalizeBatchWithOutcome, refetch]);

  // ── Queue group batch action handler ────────────────────
  const handleQueueBatchAction = useCallback(async (
    ids: string[], action: string, _category: QueueCategory, _items: QueueItem[],
  ) => {
    const snapshotResources = resources.filter(r => ids.includes(r.resource_id));
    if (snapshotResources.length === 0) { toast.info('No resources to process'); return; }

    const actionLabels: Record<string, string> = {
      extract: 'Extract Knowledge (Queue Batch)',
      fix: 'Diagnose & Repair (Queue Batch)',
      inspect: 'Re-inspect (Queue Batch)',
    };
    const outcome = await operationalizeBatchWithOutcome(
      snapshotResources, actionLabels[action] || action, action, processingIds,
    );
    setBulkResultOutcome(outcome);
    setBulkResultOpen(true);
    refetch();
  }, [resources, processingIds, operationalizeBatchWithOutcome, refetch]);

  // handleInspect defined above (line ~117)

  const handleFilterChange = useCallback((f: ControlPlaneFilter) => {
    setFilter(f);
    setCustomFilterIds(null);
    setCustomFilterLabel(null);
    // Map filter back to preset id
    const presetMap: Record<string, string> = { needs_review: 'cleanup', conflicts: 'mismatches', needs_extraction: 'extract' };
    setActivePresetId(f === 'all' ? null : presetMap[f] || null);
  }, []);

  const handleFilterConflictCategory = useCallback((ids: Set<string>) => {
    setCustomFilterIds(ids);
    setCustomFilterLabel(`${ids.size} conflicted resource${ids.size !== 1 ? 's' : ''}`);
    setFilter('all');
  }, []);

  const setCustomFilter = useCallback((ids: Set<string>, label?: string) => {
    setCustomFilterIds(ids);
    setCustomFilterLabel(label ?? `${ids.size} resource${ids.size !== 1 ? 's' : ''}`);
    setFilter('all');
  }, []);

  const clearCustomFilter = useCallback(() => {
    setCustomFilterIds(null);
    setCustomFilterLabel(null);
  }, []);

  const handleOpenBulkResult = useCallback((outcome: BulkActionOutcome) => {
    setBulkResultOutcome(outcome);
    setBulkResultOpen(true);
  }, []);

  const filterLabel = customFilterLabel ?? (
    filter === 'all' ? null : filter === 'conflicts' ? 'Conflicts' : {
      ready: 'Ready', needs_extraction: 'Needs Extraction', needs_review: 'Blocked',
      processing: 'Processing', ingested: 'Ingested',
    }[filter]
  );

  /** Contextual explanation for the current filter */
  const filterExplanation = useMemo((): string | null => {
    if (customFilterLabel) {
      if (customFilterLabel.includes('Active KIs')) return 'Resources with at least one active knowledge item — usable for downstream AI.';
      if (customFilterLabel.includes('With Contexts')) return 'Resources with active KIs that have usage contexts assigned — ready for coaching and playbooks.';
      if (customFilterLabel.includes('Grounding-Ready')) return 'Resources eligible for Dave grounding — active KIs, contexts, and no blockers.';
      if (customFilterLabel.includes('conflicted')) return 'Resources with contradictory lifecycle signals that may need manual review.';
      if (customFilterLabel.includes('attention')) return 'Resources that failed or had unexpected outcomes in the last batch action.';
      if (customFilterLabel.includes('mismatched')) return 'Reconciliation detected a state mismatch on these resources. For each: ① verify current lifecycle state ② check recent action history ③ re-run the intended action if state is still wrong.';
      return null;
    }
    switch (filter) {
      case 'ready': return 'Extracted or activated — usable for downstream AI and playbooks.';
      case 'needs_extraction': return 'Content available but no knowledge items yet. Run Extract to process.';
      case 'needs_review': return 'Blocked by an issue — empty content, failed extraction, or stale state. Diagnose to unblock.';
      case 'processing': return 'Currently being processed by a background pipeline.';
      case 'ingested': return 'In the library with no usable content. Run Enrich to fetch and parse.';
      case 'conflicts': return 'Lifecycle signals contradict each other — e.g. marked enriched but no content found.';
      default: return null;
    }
  }, [filter, customFilterLabel]);

  const handleFilterReadiness = useCallback((key: 'withActiveKIs' | 'withContexts' | 'groundingEligible') => {
    const labels: Record<string, string> = {
      withActiveKIs: 'Active KIs',
      withContexts: 'With Contexts',
      groundingEligible: 'Grounding-Ready',
    };
    setCustomFilter(downstreamReadiness.ids[key], labels[key]);
  }, [downstreamReadiness, setCustomFilter]);

  // Apply pinned preset on mount once resources load
  useEffect(() => {
    if (didApplyPinned || resources.length === 0) return;
    const pinned = getPinnedPreset();
    if (!pinned) { setDidApplyPinned(true); return; }
    const filterMap: Record<string, ControlPlaneFilter> = { cleanup: 'needs_review', mismatches: 'conflicts', extract: 'needs_extraction' };
    if (pinned === 'ai-ready') {
      handleFilterReadiness('groundingEligible');
      setActivePresetId('ai-ready');
    } else if (filterMap[pinned]) {
      handleFilterChange(filterMap[pinned]);
    }
    setDidApplyPinned(true);
  }, [didApplyPinned, resources.length, handleFilterChange, handleFilterReadiness]);

  // Plain-English library summary
  const librarySummary = useMemo(() => {
    if (resources.length === 0) return null;
    const parts: string[] = [];
    parts.push(`${cpSummary.ready} of ${cpSummary.total} resources usable`);
    if (downstreamReadiness.groundingEligible > 0) {
      parts.push(`${downstreamReadiness.groundingEligible} grounding-ready`);
    }
    const attention = cpSummary.needsReview + cpSummary.needsExtraction;
    if (attention > 0) {
      parts.push(`${attention} need attention`);
    }
    return parts.join(' · ');
  }, [resources.length, cpSummary, downstreamReadiness]);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Knowledge Control Plane</h2>
          {librarySummary ? (
            <p className="text-xs text-muted-foreground">{librarySummary}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Lifecycle-driven view — every resource has one canonical state
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {cpSummary.lastUpdated && (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <Clock className="h-2.5 w-2.5" />
              {new Date(cpSummary.lastUpdated).toLocaleTimeString()}
            </span>
          )}
          <Button
            variant="outline" size="sm"
            onClick={() => refetch()} disabled={isRefetching}
            className="h-7 text-xs gap-1.5"
          >
            <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Unified Health — system trust + resource issues */}
      <UnifiedHealthStrip
        summary={cpSummary}
        conflictCount={conflicts.length}
        outcomeRefreshKey={outcomeRefreshKey}
        onFilterChange={handleFilterChange}
        onOpenResource={openResourceById}
      />

      {/* AI Readiness — secondary downstream layer */}
      <DaveReadinessStrip readiness={downstreamReadiness} totalResources={resources.length} onFilterReadiness={handleFilterReadiness} />

      {/* Conflict Breakdown */}
      <ConflictBreakdownBanner
        conflicts={conflicts}
        activeFilter={filter}
        onFilterConflicts={() => handleFilterChange('conflicts')}
        onFilterConflictCategory={handleFilterConflictCategory}
      />

      {/* Summary Bar */}
      <ControlPlaneSummaryBar
        summary={cpSummary}
        activeFilter={filter}
        onFilterChange={handleFilterChange}
        loading={loading}
        sampleResources={sampleResources}
      />

      {/* Active Filter Banner with explanation */}
      {filterLabel && (
        <div className="rounded-md bg-primary/5 border border-primary/20">
          <div className="flex items-center gap-2 px-3 py-1.5">
            <Filter className="h-3 w-3 text-primary shrink-0" />
            <span className="text-xs text-primary font-medium">
              Showing: {filterLabel} ({filteredCount})
            </span>
            <button
              onClick={() => { handleFilterChange('all'); clearCustomFilter(); }}
              className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          </div>
          {filterExplanation && (
            <div className="flex items-start gap-1.5 px-3 pb-1.5 -mt-0.5">
              <Info className="h-2.5 w-2.5 text-muted-foreground shrink-0 mt-0.5" />
              <span className="text-[10px] text-muted-foreground leading-tight">
                {filterExplanation}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Work Queue — "What should I work next?" */}
      <NeedsAttentionQueue
        resources={resources}
        processingIds={processingIds}
        outcomeRefreshKey={outcomeRefreshKey}
        onAction={handleAction}
        onInspect={openResourceById}
        onBatchCategoryAction={handleQueueBatchAction}
        onFilterToIds={setCustomFilter}
        batchLoading={actionLoading}
      />

      {/* Bulk Action Bar */}
      <BulkActionBar
        filter={filter}
        filteredCount={filteredCount}
        filteredResources={filteredResources}
        onBulkAction={handleBulkAction}
        loading={actionLoading}
      />

      {/* Recent Actions — clickable */}
      <RecentActionsPanel
        refreshKey={outcomeRefreshKey}
        onOpenResource={openResourceById}
        onOpenBulkResult={handleOpenBulkResult}
      />

      {/* Quick Filter Presets + Central Table */}
      <div className="space-y-1.5">
        <TableFilterPresets
          activeFilter={filter}
          customFilterLabel={customFilterLabel}
          activePresetId={activePresetId}
          onFilterChange={handleFilterChange}
          onCustomPreset={(key) => {
            if (key === 'groundingEligible') {
              handleFilterReadiness('groundingEligible');
              setActivePresetId('ai-ready');
            }
          }}
          onPinPreset={(id) => savePinnedPreset(id)}
        />
        <CentralResourceTable
          resources={resources}
          filter={filter}
          processingIds={processingIds}
          conflictIds={conflictIds}
          customFilterIds={customFilterIds}
          customFilterLabel={customFilterLabel}
          onAction={handleAction}
          onInspect={handleInspect}
          actionLoading={actionLoading}
          outcomeRefreshKey={outcomeRefreshKey}
        />
      </div>

      {/* Inspect Drawer */}
      <ResourceInspectDrawer
        resource={inspectResource}
        state={inspectState}
        open={!!inspectResource}
        onClose={() => { setInspectResource(null); setInspectState(null); }}
        onAction={handleAction}
        actionLoading={actionLoading}
      />

      {/* Bulk Action Result Dialog */}
      <BulkActionResultDialog
        outcome={bulkResultOutcome ?? lastBulkOutcome}
        open={bulkResultOpen}
        onClose={() => setBulkResultOpen(false)}
        onFilterAttention={(ids) => setCustomFilter(ids, `${ids.size} need attention`)}
        onOpenResource={(id) => { setBulkResultOpen(false); openResourceById(id); }}
      />
    </div>
  );
}
