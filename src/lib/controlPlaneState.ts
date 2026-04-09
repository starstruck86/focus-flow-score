/**
 * Control Plane State — simplified 6-state lifecycle model.
 *
 * This is a PRESENTATION LAYER over the existing canonical lifecycle.
 * It collapses the detailed internal stages into 6 user-facing states.
 */

import type { CanonicalResourceStatus, LifecycleStage, BlockedReason } from '@/lib/canonicalLifecycle';

// ── The 6 canonical control plane states ───────────────────
export type ControlPlaneState =
  | 'ingested'
  | 'has_content'
  | 'extracted'
  | 'activated'
  | 'blocked'
  | 'processing';

export const CONTROL_PLANE_LABELS: Record<ControlPlaneState, string> = {
  ingested: 'Ingested',
  has_content: 'Has Content',
  extracted: 'Extracted',
  activated: 'Activated',
  blocked: 'Blocked',
  processing: 'Processing',
};

export const CONTROL_PLANE_COLORS: Record<ControlPlaneState, { text: string; bg: string; border: string }> = {
  ingested: { text: 'text-muted-foreground', bg: 'bg-muted/50', border: 'border-muted' },
  has_content: { text: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800' },
  extracted: { text: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800' },
  activated: { text: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800' },
  blocked: { text: 'text-destructive', bg: 'bg-destructive/10', border: 'border-destructive/30' },
  processing: { text: 'text-primary', bg: 'bg-primary/10', border: 'border-primary/30' },
};

// ── Derived signals (explanations, not states) ─────────────
export interface DerivedSignals {
  has_digest: boolean;
  ki_count: number;
  ki_density: number;
  under_extracted: boolean;
  stale: boolean;
  shallow: boolean;
  resumable: boolean;
  drift_detected: boolean;
  mismatch_detected: boolean;
}

// ── Map canonical lifecycle → control plane state ──────────
export function deriveControlPlaneState(
  resource: CanonicalResourceStatus,
  processingResourceIds?: Set<string>,
): ControlPlaneState {
  // Processing takes precedence
  if (processingResourceIds?.has(resource.resource_id)) {
    return 'processing';
  }

  // Blocked: any blocked_reason other than 'none'
  if (resource.blocked_reason !== 'none') {
    return 'blocked';
  }

  // Map lifecycle stages to control plane states
  const stage = resource.canonical_stage;

  switch (stage) {
    case 'uploaded':
      return 'ingested';

    case 'content_ready':
    case 'tagged':
      return 'has_content';

    case 'knowledge_extracted':
      return 'extracted';

    case 'activated':
    case 'operationalized':
      return 'activated';

    default:
      return 'ingested';
  }
}

// ── Derive signals from resource data ──────────────────────
export function deriveDerivedSignals(
  resource: CanonicalResourceStatus & {
    content_length?: number | null;
    enrichment_status?: string | null;
    enriched_at?: string | null;
    updated_at?: string | null;
  },
): DerivedSignals {
  const contentLength = resource.is_content_backed ? 1000 : 0; // approximate
  const kiCount = resource.knowledge_item_count;
  const kiDensity = contentLength > 0 ? (kiCount / (contentLength / 1000)) : 0;

  return {
    has_digest: false, // will be enriched later when digest data available
    ki_count: kiCount,
    ki_density: Math.round(kiDensity * 100) / 100,
    under_extracted: resource.is_content_backed && kiCount === 0,
    stale: false, // can be enriched with time-based logic
    shallow: kiCount > 0 && kiCount < 3,
    resumable: false, // will be enriched from extraction_batches
    drift_detected: false,
    mismatch_detected: resource.blocked_reason !== 'none',
  };
}

// ── Summary view for the control bar ───────────────────────
export interface ControlPlaneSummary {
  total: number;
  ready: number;        // extracted + activated
  needsExtraction: number; // has_content
  needsReview: number;  // blocked or mismatch
  processing: number;
  ingested: number;
}

export function computeControlPlaneSummary(
  resources: CanonicalResourceStatus[],
  processingIds?: Set<string>,
): ControlPlaneSummary {
  const summary: ControlPlaneSummary = {
    total: resources.length,
    ready: 0,
    needsExtraction: 0,
    needsReview: 0,
    processing: 0,
    ingested: 0,
  };

  for (const r of resources) {
    const state = deriveControlPlaneState(r, processingIds);
    switch (state) {
      case 'extracted':
      case 'activated':
        summary.ready++;
        break;
      case 'has_content':
        summary.needsExtraction++;
        break;
      case 'blocked':
        summary.needsReview++;
        break;
      case 'processing':
        summary.processing++;
        break;
      case 'ingested':
        summary.ingested++;
        break;
    }
  }

  return summary;
}

// ── Filter type for the central table ──────────────────────
export type ControlPlaneFilter =
  | 'all'
  | 'ready'
  | 'needs_extraction'
  | 'needs_review'
  | 'processing'
  | 'ingested';

export function matchesFilter(
  state: ControlPlaneState,
  filter: ControlPlaneFilter,
): boolean {
  if (filter === 'all') return true;
  switch (filter) {
    case 'ready': return state === 'extracted' || state === 'activated';
    case 'needs_extraction': return state === 'has_content';
    case 'needs_review': return state === 'blocked';
    case 'processing': return state === 'processing';
    case 'ingested': return state === 'ingested';
    default: return true;
  }
}
