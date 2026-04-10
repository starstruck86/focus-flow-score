/**
 * Action Preview Dialog — lightweight confirmation showing what will run and why.
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ControlPlaneState,
  CONTROL_PLANE_LABELS, CONTROL_PLANE_COLORS,
} from '@/lib/controlPlaneState';
import type { CanonicalResourceStatus } from '@/lib/canonicalLifecycle';

export interface ActionPreview {
  actionKey: string;
  actionLabel: string;
  reason: string;
  pipelineStep: string;
  fromState: ControlPlaneState;
  toState: ControlPlaneState;
  successCriteria: string;
}

/** Build a preview for a given action + state combination */
export function buildActionPreview(
  actionKey: string,
  state: ControlPlaneState,
  resource: CanonicalResourceStatus,
): ActionPreview {
  switch (actionKey) {
    case 'enrich':
      return {
        actionKey,
        actionLabel: 'Enrich Content',
        reason: resource.is_content_backed
          ? 'Content exists but may be incomplete — re-enrichment will attempt deeper extraction'
          : 'No usable content detected — enrichment will fetch and parse the source',
        pipelineStep: 'Content enrichment pipeline (fetch → parse → validate)',
        fromState: state,
        toState: 'has_content',
        successCriteria: 'Resource has parseable content (content_backed = true)',
      };
    case 'extract':
      return {
        actionKey,
        actionLabel: 'Extract Knowledge',
        reason: resource.knowledge_item_count === 0
          ? 'Content exists but no knowledge items have been extracted'
          : `${resource.knowledge_item_count} KIs exist — re-extraction will find additional insights`,
        pipelineStep: 'AI extraction (segment → extract → validate → deduplicate)',
        fromState: state,
        toState: 'extracted',
        successCriteria: 'At least 1 validated knowledge item saved',
      };
    case 'activate':
      return {
        actionKey,
        actionLabel: 'Activate Knowledge',
        reason: resource.active_ki_count === 0
          ? 'Knowledge items exist but none are active for downstream use'
          : `${resource.active_ki_count} of ${resource.knowledge_item_count} KIs active — activation will enable remaining items`,
        pipelineStep: 'Activation pipeline (validate → assign contexts → enable)',
        fromState: state,
        toState: 'activated',
        successCriteria: 'Active KIs > 0 with assigned usage contexts',
      };
    case 'fix':
      return {
        actionKey,
        actionLabel: 'Diagnose & Repair',
        reason: `Blocked: ${resource.blocked_reason.replace(/_/g, ' ')} — auto-repair will attempt to resolve the issue`,
        pipelineStep: 'Diagnostic pipeline (detect root cause → apply fix → re-validate)',
        fromState: 'blocked',
        toState: resource.is_content_backed ? 'has_content' : 'ingested',
        successCriteria: 'Blocked reason cleared (blocked_reason = none)',
      };
    case 'view_progress':
      return {
        actionKey,
        actionLabel: 'View Progress',
        reason: 'Resource is currently being processed by the pipeline',
        pipelineStep: 'No new pipeline step — opens progress inspector',
        fromState: 'processing',
        toState: 'processing',
        successCriteria: 'N/A — read-only inspection',
      };
    default:
      return {
        actionKey,
        actionLabel: actionKey,
        reason: 'Action details unavailable',
        pipelineStep: 'Unknown',
        fromState: state,
        toState: state,
        successCriteria: 'Unknown',
      };
  }
}

interface Props {
  preview: ActionPreview | null;
  resourceTitle?: string;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function ActionPreviewDialog({ preview, resourceTitle, open, onConfirm, onCancel, loading }: Props) {
  if (!preview) return null;

  const fromColors = CONTROL_PLANE_COLORS[preview.fromState];
  const toColors = CONTROL_PLANE_COLORS[preview.toState];

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{preview.actionLabel}</AlertDialogTitle>
          {resourceTitle && (
            <p className="text-xs text-muted-foreground truncate">{resourceTitle}</p>
          )}
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            {/* Why */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Why</span>
              <p className="text-xs text-foreground mt-0.5">{preview.reason}</p>
            </div>

            {/* Pipeline step */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Will run</span>
              <p className="text-xs text-foreground mt-0.5 font-mono">{preview.pipelineStep}</p>
            </div>

            {/* State transition */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Expected transition</span>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant="outline" className={cn('text-[10px]', fromColors.text, fromColors.bg, fromColors.border)}>
                  {CONTROL_PLANE_LABELS[preview.fromState]}
                </Badge>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <Badge variant="outline" className={cn('text-[10px]', toColors.text, toColors.bg, toColors.border)}>
                  {CONTROL_PLANE_LABELS[preview.toState]}
                </Badge>
              </div>
            </div>

            {/* Success criteria */}
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Success criteria</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                <p className="text-xs text-foreground">{preview.successCriteria}</p>
              </div>
            </div>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs h-8" disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="text-xs h-8" onClick={onConfirm} disabled={loading}>
            {loading ? 'Running…' : `Run ${preview.actionLabel}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ── Bulk action preview ────────────────────────────────────

export interface BulkActionPreview {
  actionLabel: string;
  count: number;
  reason: string;
  pipelineStep: string;
  expectedTransition: string;
  sampleTitles: string[];
}

export function buildBulkActionPreview(
  action: string,
  resources: CanonicalResourceStatus[],
): BulkActionPreview {
  const decodeHtml = (s: string) => {
    const el = document.createElement('textarea');
    el.innerHTML = s;
    return el.value;
  };
  const sampleTitles = resources.slice(0, 4).map(r => decodeHtml(r.title));

  switch (action) {
    case 'bulk_extract':
      return {
        actionLabel: 'Extract Knowledge (Batch)',
        count: resources.length,
        reason: 'These resources have content but no knowledge items extracted yet',
        pipelineStep: 'AI extraction on each resource (segment → extract → validate)',
        expectedTransition: 'Has Content → Extracted',
        sampleTitles,
      };
    case 'bulk_enrich':
      return {
        actionLabel: 'Enrich Content (Batch)',
        count: resources.length,
        reason: 'These resources have been ingested but lack usable content',
        pipelineStep: 'Content enrichment pipeline on each resource',
        expectedTransition: 'Ingested → Has Content',
        sampleTitles,
      };
    case 'bulk_review':
      return {
        actionLabel: 'Diagnose & Repair (Batch)',
        count: resources.length,
        reason: 'These resources have detected blockers preventing progress',
        pipelineStep: 'Diagnostic pipeline on each blocked resource',
        expectedTransition: 'Blocked → resolved state',
        sampleTitles,
      };
    default:
      return {
        actionLabel: action,
        count: resources.length,
        reason: 'Batch operation',
        pipelineStep: 'Unknown',
        expectedTransition: 'Unknown',
        sampleTitles,
      };
  }
}

interface BulkProps {
  preview: BulkActionPreview | null;
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

export function BulkActionPreviewDialog({ preview, open, onConfirm, onCancel, loading }: BulkProps) {
  if (!preview) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-sm">{preview.actionLabel}</AlertDialogTitle>
          <p className="text-xs text-muted-foreground">
            {preview.count} resource{preview.count !== 1 ? 's' : ''} selected
          </p>
        </AlertDialogHeader>
        <AlertDialogDescription asChild>
          <div className="space-y-3">
            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Why these resources</span>
              <p className="text-xs text-foreground mt-0.5">{preview.reason}</p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Will run</span>
              <p className="text-xs text-foreground mt-0.5 font-mono">{preview.pipelineStep}</p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Expected transition</span>
              <p className="text-xs text-foreground mt-0.5">{preview.expectedTransition}</p>
            </div>

            <div>
              <span className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wider">Sample resources</span>
              <ul className="mt-1 space-y-0.5">
                {preview.sampleTitles.map((t, i) => (
                  <li key={i} className="text-xs text-muted-foreground truncate">• {t}</li>
                ))}
                {preview.count > preview.sampleTitles.length && (
                  <li className="text-[10px] text-muted-foreground/70 italic">
                    …and {preview.count - preview.sampleTitles.length} more
                  </li>
                )}
              </ul>
            </div>
          </div>
        </AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogCancel className="text-xs h-8" disabled={loading}>Cancel</AlertDialogCancel>
          <AlertDialogAction className="text-xs h-8" onClick={onConfirm} disabled={loading}>
            {loading ? 'Running…' : `Run on ${preview.count} resources`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
