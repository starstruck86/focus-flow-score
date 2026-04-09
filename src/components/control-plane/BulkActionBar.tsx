/**
 * Bulk Action Bar — shows contextual bulk actions when filtered by state.
 */
import { cn } from '@/lib/utils';
import { Zap, FileText, AlertTriangle, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ControlPlaneFilter } from '@/lib/controlPlaneState';

interface Props {
  filter: ControlPlaneFilter;
  filteredCount: number;
  onBulkAction: (action: string, filter: ControlPlaneFilter) => void;
  loading?: boolean;
}

const BULK_ACTIONS: Record<string, { label: string; icon: React.ElementType; action: string } | null> = {
  all: null,
  ready: null, // No primary bulk action for ready
  needs_extraction: { label: 'Extract All', icon: Zap, action: 'bulk_extract' },
  needs_review: { label: 'Review All', icon: AlertTriangle, action: 'bulk_review' },
  processing: null,
  ingested: { label: 'Enrich All', icon: FileText, action: 'bulk_enrich' },
  conflicts: null,
};

export function BulkActionBar({ filter, filteredCount, onBulkAction, loading }: Props) {
  const action = BULK_ACTIONS[filter];
  if (!action || filteredCount === 0) return null;

  return (
    <div className="flex items-center justify-between px-3 py-2 rounded-md border bg-card">
      <span className="text-xs text-muted-foreground">
        {filteredCount} resource{filteredCount !== 1 ? 's' : ''} in this view
      </span>
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5"
        onClick={() => onBulkAction(action.action, filter)}
        disabled={loading}
      >
        <action.icon className="h-3 w-3" />
        {action.label} ({filteredCount})
      </Button>
    </div>
  );
}
