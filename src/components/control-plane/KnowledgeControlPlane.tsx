/**
 * Knowledge Control Plane — trust-first, lifecycle-driven workspace.
 */
import { useState, useMemo } from 'react';
import { RefreshCw, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useCanonicalLifecycle } from '@/hooks/useCanonicalLifecycle';
import { ControlPlaneSummaryBar } from './ControlPlaneSummaryBar';
import { CentralResourceTable } from './CentralResourceTable';
import {
  type ControlPlaneFilter,
  computeControlPlaneSummary,
} from '@/lib/controlPlaneState';

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

  const filterLabel = filter === 'all' ? null : {
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

      {/* Summary Bar */}
      <ControlPlaneSummaryBar
        summary={cpSummary}
        activeFilter={filter}
        onFilterChange={setFilter}
        loading={loading}
      />

      {/* Active Filter Banner */}
      {filterLabel && (
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
      />
    </div>
  );
}
