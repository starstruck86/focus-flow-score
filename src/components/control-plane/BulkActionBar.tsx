/**
 * Bulk Action Bar — shows contextual bulk actions with preview confirmation.
 */
import { useState, useCallback } from 'react';
import { Zap, FileText, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ControlPlaneFilter } from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';
import { BulkActionPreviewDialog, buildBulkActionPreview, type BulkActionPreview } from './ActionPreviewDialog';

interface Props {
  filter: ControlPlaneFilter;
  filteredCount: number;
  filteredResources: CanonicalResourceStatus[];
  onBulkAction: (action: string, filter: ControlPlaneFilter) => void;
  loading?: boolean;
}

const BULK_ACTIONS: Record<string, { label: string; icon: React.ElementType; action: string } | null> = {
  all: null,
  ready: null,
  needs_extraction: { label: 'Extract All', icon: Zap, action: 'bulk_extract' },
  needs_review: { label: 'Diagnose All', icon: AlertTriangle, action: 'bulk_review' },
  processing: null,
  ingested: { label: 'Enrich All', icon: FileText, action: 'bulk_enrich' },
  conflicts: null,
};

export function BulkActionBar({ filter, filteredCount, filteredResources, onBulkAction, loading }: Props) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<BulkActionPreview | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const action = BULK_ACTIONS[filter];
  if (!action || filteredCount === 0) return null;

  const handleClick = () => {
    const preview = buildBulkActionPreview(action.action, filteredResources);
    setBulkPreview(preview);
    setPendingAction(action.action);
    setPreviewOpen(true);
  };

  const handleConfirm = () => {
    if (pendingAction) {
      onBulkAction(pendingAction, filter);
    }
    setPreviewOpen(false);
    setBulkPreview(null);
    setPendingAction(null);
  };

  const handleCancel = () => {
    setPreviewOpen(false);
    setBulkPreview(null);
    setPendingAction(null);
  };

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 rounded-md border bg-card">
        <span className="text-xs text-muted-foreground">
          {filteredCount} resource{filteredCount !== 1 ? 's' : ''} in this view
        </span>
        <Button
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={handleClick}
          disabled={loading}
        >
          <action.icon className="h-3 w-3" />
          {action.label} ({filteredCount})
        </Button>
      </div>

      <BulkActionPreviewDialog
        preview={bulkPreview}
        open={previewOpen}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        loading={loading}
      />
    </>
  );
}
