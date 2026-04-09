/**
 * Knowledge Control Plane — trust-first, lifecycle-driven, operable workspace.
 */
import { useState, useMemo, useCallback } from 'react';
import { RefreshCw, Filter, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { useAutoOperationalize } from '@/hooks/useAutoOperationalize';
import { useExtractionPipeline } from '@/hooks/useExtractionPipeline';
import { SystemHealthStrip } from './SystemHealthStrip';
import { ResourceHealthStrip } from './ResourceHealthStrip';
import { ControlPlaneSummaryBar } from './ControlPlaneSummaryBar';
import { CentralResourceTable } from './CentralResourceTable';
import { ResourceInspectDrawer } from './ResourceInspectDrawer';
import { ConflictBreakdownBanner } from './ConflictBreakdownBanner';
import { BulkActionBar } from './BulkActionBar';
import { RecentActionsPanel } from './RecentActionsPanel';
import { BulkActionResultDialog } from './BulkActionResultDialog';
import { buildActionPreview } from './ActionPreviewDialog';
import {
  type ControlPlaneFilter, type ControlPlaneState,
  computeControlPlaneSummary,
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
  const [customFilterIds, setCustomFilterIds] = useState<Set<string> | null>(null);
  const [customFilterLabel, setCustomFilterLabel] = useState<string | null>(null);

  // Inspect drawer state
  const [inspectResource, setInspectResource] = useState<CanonicalResourceStatus | null>(null);
  const [inspectState, setInspectState] = useState<ControlPlaneState | null>(null);

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
  const openResourceById = useCallback((resourceId: string) => {
    const r = resources.find(r => r.resource_id === resourceId);
    if (r) {
      setInspectResource(r);
      setInspectState(deriveControlPlaneState(r, processingIds));
    }
  }, [resources, processingIds]);

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

  const handleInspect = useCallback((r: CanonicalResourceStatus, state: ControlPlaneState) => {
    setInspectResource(r);
    setInspectState(state);
  }, []);

  const handleFilterChange = useCallback((f: ControlPlaneFilter) => {
    setFilter(f);
    setCustomFilterIds(null);
    setCustomFilterLabel(null);
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
      ready: 'Ready', needs_extraction: 'Needs Extraction', needs_review: 'Needs Review',
      processing: 'Processing', ingested: 'Ingested',
    }[filter]
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Knowledge Control Plane</h2>
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground">
              Lifecycle-driven view — every resource has one canonical state
            </p>
            {cpSummary.lastUpdated && (
              <span className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
                <Clock className="h-2.5 w-2.5" />
                Last recalculated {new Date(cpSummary.lastUpdated).toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
        <Button
          variant="outline" size="sm"
          onClick={() => refetch()} disabled={isRefetching}
          className="h-7 text-xs gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* System Health — reconciliation & trust */}
      <SystemHealthStrip refreshKey={outcomeRefreshKey} onOpenResource={openResourceById} />

      {/* Resource Health — blocked, extraction, conflicts */}
      <ResourceHealthStrip
        summary={cpSummary}
        conflictCount={conflicts.length}
        onFilterChange={handleFilterChange}
      />

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

      {/* Active Filter Banner */}
      {filterLabel && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/20">
          <Filter className="h-3 w-3 text-primary" />
          <span className="text-xs text-primary font-medium">Filtered: {filterLabel}</span>
          <button
            onClick={() => { handleFilterChange('all'); clearCustomFilter(); }}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

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

      {/* Central Table */}
      <CentralResourceTable
        resources={resources}
        filter={filter}
        processingIds={processingIds}
        conflictIds={conflictIds}
        customFilterIds={customFilterIds}
        onAction={handleAction}
        onInspect={handleInspect}
        actionLoading={actionLoading}
        outcomeRefreshKey={outcomeRefreshKey}
      />

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
