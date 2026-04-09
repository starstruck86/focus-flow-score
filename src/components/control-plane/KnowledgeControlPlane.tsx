/**
 * Knowledge Control Plane — trust-first, lifecycle-driven workspace.
 */
import { useState, useMemo } from 'react';
import { RefreshCw, Filter, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { ControlPlaneSummaryBar } from './ControlPlaneSummaryBar';
import { CentralResourceTable } from './CentralResourceTable';
import {
  type ControlPlaneFilter,
  computeControlPlaneSummary,
  deriveControlPlaneState,
  detectAllConflicts,
  matchesFilter,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

export function KnowledgeControlPlane() {
  const { summary, loading, refetch, isRefetching } = useCanonicalLifecycle();
  const [filter, setFilter] = useState<ControlPlaneFilter>('all');

  const resources = summary?.resources ?? [];

  // TODO: derive processing IDs from active background jobs
  const processingIds = useMemo(() => new Set<string>(), []);

  const cpSummary = useMemo(
    () => computeControlPlaneSummary(resources, processingIds),
    [resources, processingIds],
  );

  // Conflict detection
  const conflicts = useMemo(() => detectAllConflicts(resources), [resources]);
  const conflictIds = useMemo(() => new Set(conflicts.map(c => c.resource_id)), [conflicts]);

  // Sample resources for each metric card
  const sampleResources = useMemo(() => {
    const buckets: Record<string, CanonicalResourceStatus[]> = {
      all: resources.slice(0, 3),
      ready: [],
      needs_extraction: [],
      needs_review: [],
      processing: [],
      ingested: [],
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

  const filterLabel = filter === 'all' ? null : filter === 'conflicts' ? 'Conflicts' : {
    ready: 'Ready',
    needs_extraction: 'Needs Extraction',
    needs_review: 'Needs Review',
    processing: 'Processing',
    ingested: 'Ingested',
  }[filter];

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Knowledge Control Plane</h2>
          <p className="text-xs text-muted-foreground">
            Lifecycle-driven view — every resource has one canonical state
          </p>
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

      {/* Conflict Banner */}
      {conflicts.length > 0 && (
        <button
          onClick={() => setFilter(filter === 'conflicts' ? 'all' : 'conflicts')}
          className="flex items-center gap-2 w-full px-3 py-2 rounded-md bg-destructive/10 border border-destructive/30 text-left hover:bg-destructive/15 transition-colors"
        >
          <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
          <span className="text-xs text-destructive font-medium">
            {conflicts.length} resource{conflicts.length !== 1 ? 's' : ''} with conflicting lifecycle signals
          </span>
          <span className="ml-auto text-[10px] text-destructive/70">
            {filter === 'conflicts' ? 'Showing conflicts — click to clear' : 'Click to filter'}
          </span>
        </button>
      )}

      {/* Summary Bar */}
      <ControlPlaneSummaryBar
        summary={cpSummary}
        activeFilter={filter}
        onFilterChange={setFilter}
        loading={loading}
        sampleResources={sampleResources}
      />

      {/* Active Filter Banner */}
      {filterLabel && filter !== 'conflicts' && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/5 border border-primary/20">
          <Filter className="h-3 w-3 text-primary" />
          <span className="text-xs text-primary font-medium">Filtered: {filterLabel}</span>
          <button
            onClick={() => setFilter('all')}
            className="ml-auto text-[10px] text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {/* Central Table */}
      <CentralResourceTable
        resources={resources}
        filter={filter}
        processingIds={processingIds}
        conflictIds={conflictIds}
      />
    </div>
  );
}
