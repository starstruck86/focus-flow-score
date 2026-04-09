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
import { ControlPlaneSummaryBar } from './ControlPlaneSummaryBar';
import { CentralResourceTable } from './CentralResourceTable';
import { ResourceInspectDrawer } from './ResourceInspectDrawer';
import { ConflictBreakdownBanner } from './ConflictBreakdownBanner';
import { BulkActionBar } from './BulkActionBar';
import {
  type ControlPlaneFilter, type ControlPlaneState,
  computeControlPlaneSummary,
  deriveControlPlaneState,
  detectAllConflicts,
  matchesFilter,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

export function KnowledgeControlPlane() {
  const { summary, loading, refetch, isRefetching } = useCanonicalLifecycle();
  const { operationalize, operationalizeBatch, isRunning: opRunning } = useAutoOperationalize();
  const { runBatch, isRunning: extractRunning } = useExtractionPipeline();
  const [filter, setFilter] = useState<ControlPlaneFilter>('all');
  const [customFilterIds, setCustomFilterIds] = useState<Set<string> | null>(null);
  const [customFilterLabel, setCustomFilterLabel] = useState<string | null>(null);

  // Inspect drawer state
  const [inspectResource, setInspectResource] = useState<CanonicalResourceStatus | null>(null);
  const [inspectState, setInspectState] = useState<ControlPlaneState | null>(null);

  const resources = summary?.resources ?? [];
  const actionLoading = opRunning || extractRunning;

  // Processing IDs (could be wired from background jobs later)
  const processingIds = useMemo(() => new Set<string>(), []);

  const cpSummary = useMemo(
    () => computeControlPlaneSummary(resources, processingIds),
    [resources, processingIds],
  );

  // Conflict detection
  const conflicts = useMemo(() => detectAllConflicts(resources), [resources]);
  const conflictIds = useMemo(() => new Set(conflicts.map(c => c.resource_id)), [conflicts]);

  // Sample resources for metric cards
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

  // Count of filtered resources (for bulk action bar)
  const filteredCount = useMemo(() => {
    if (customFilterIds) return customFilterIds.size;
    return resources.filter(r => {
      const state = deriveControlPlaneState(r, processingIds);
      return matchesFilter(state, filter, r.resource_id, conflictIds);
    }).length;
  }, [resources, filter, processingIds, conflictIds, customFilterIds]);

  // ── Row-level action handler ─────────────────────────────
  const handleAction = useCallback(async (resourceId: string, action: string) => {
    switch (action) {
      case 'extract':
      case 'enrich':
      case 'fix':
      case 'activate': {
        toast.info(`Running ${action} on resource…`);
        await operationalize(resourceId);
        refetch();
        break;
      }
      case 'view_progress':
      case 'inspect': {
        const r = resources.find(r => r.resource_id === resourceId);
        if (r) {
          setInspectResource(r);
          setInspectState(deriveControlPlaneState(r, processingIds));
        }
        break;
      }
      default:
        toast.info(`Action "${action}" not yet implemented`);
    }
  }, [resources, processingIds, operationalize, refetch]);

  // ── Bulk action handler ──────────────────────────────────
  const handleBulkAction = useCallback(async (action: string, currentFilter: ControlPlaneFilter) => {
    const targetResources = resources.filter(r => {
      const state = deriveControlPlaneState(r, processingIds);
      return matchesFilter(state, currentFilter, r.resource_id, conflictIds);
    });

    if (targetResources.length === 0) {
      toast.info('No resources to process');
      return;
    }

    const ids = targetResources.map(r => r.resource_id);

    switch (action) {
      case 'bulk_extract': {
        toast.info(`Extracting knowledge from ${ids.length} resources…`);
        await runBatch('needs_extraction', { max: ids.length });
        refetch();
        break;
      }
      case 'bulk_enrich':
      case 'bulk_review': {
        toast.info(`Running auto-operationalize on ${ids.length} resources…`);
        await operationalizeBatch(ids);
        refetch();
        break;
      }
      default:
        toast.info(`Bulk action "${action}" not yet implemented`);
    }
  }, [resources, processingIds, conflictIds, operationalizeBatch, runBatch, refetch]);

  // ── Inspect drawer handler ───────────────────────────────
  const handleInspect = useCallback((r: CanonicalResourceStatus, state: ControlPlaneState) => {
    setInspectResource(r);
    setInspectState(state);
  }, []);

  // ── Filter management ────────────────────────────────────
  const handleFilterChange = useCallback((f: ControlPlaneFilter) => {
    setFilter(f);
    setCustomFilterIds(null);
    setCustomFilterLabel(null);
  }, []);

  const handleFilterConflictCategory = useCallback((ids: Set<string>) => {
    setCustomFilterIds(ids);
    setCustomFilterLabel(`${ids.size} conflicted resource${ids.size !== 1 ? 's' : ''}`);
    setFilter('all'); // Clear primary filter to avoid double-filtering
  }, []);

  const clearCustomFilter = useCallback(() => {
    setCustomFilterIds(null);
    setCustomFilterLabel(null);
  }, []);

  // Labels
  const filterLabel = customFilterLabel ?? (
    filter === 'all' ? null : filter === 'conflicts' ? 'Conflicts' : {
      ready: 'Ready',
      needs_extraction: 'Needs Extraction',
      needs_review: 'Needs Review',
      processing: 'Processing',
      ingested: 'Ingested',
    }[filter]
  );

  return (
    <div className="space-y-4">
      {/* Header with freshness */}
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
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isRefetching}
          className="h-7 text-xs gap-1.5"
        >
          <RefreshCw className={`h-3 w-3 ${isRefetching ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

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
        onBulkAction={handleBulkAction}
        loading={actionLoading}
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
    </div>
  );
}
