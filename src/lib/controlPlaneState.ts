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

// ── Evidence: structured "Why?" for every state ────────────
export interface StateEvidence {
  state: ControlPlaneState;
  reason: string;
  evidence: { label: string; value: string; pass: boolean }[];
}

export function deriveStateEvidence(
  resource: CanonicalResourceStatus,
  state: ControlPlaneState,
): StateEvidence {
  const e: StateEvidence['evidence'] = [];

  // Content evidence
  e.push({
    label: 'Content exists',
    value: resource.is_content_backed ? 'Yes' : 'No',
    pass: resource.is_content_backed,
  });

  // KI evidence
  e.push({
    label: 'KI count',
    value: String(resource.knowledge_item_count),
    pass: resource.knowledge_item_count > 0,
  });

  // Active KI evidence
  if (resource.knowledge_item_count > 0) {
    e.push({
      label: 'Active KIs',
      value: String(resource.active_ki_count),
      pass: resource.active_ki_count > 0,
    });
  }

  // Context evidence (only if active KIs exist)
  if (resource.active_ki_count > 0) {
    e.push({
      label: 'KIs with contexts',
      value: String(resource.active_ki_with_context_count),
      pass: resource.active_ki_with_context_count > 0,
    });
  }

  // Enrichment evidence
  e.push({
    label: 'Enriched',
    value: resource.is_enriched ? 'Yes' : 'No',
    pass: resource.is_enriched,
  });

  // Blocked reason
  e.push({
    label: 'Blocked reason',
    value: resource.blocked_reason === 'none' ? 'None' : resource.blocked_reason.replace(/_/g, ' '),
    pass: resource.blocked_reason === 'none',
  });

  // Derive the human-readable reason
  let reason: string;
  switch (state) {
    case 'ingested':
      reason = 'No usable content detected yet';
      break;
    case 'has_content':
      reason = resource.knowledge_item_count === 0
        ? 'Content exists but no knowledge has been extracted'
        : 'Content exists but KIs are not yet active';
      break;
    case 'extracted':
      reason = 'Knowledge extracted but not fully activated for downstream use';
      break;
    case 'activated':
      reason = 'Fully activated — usable by downstream AI';
      break;
    case 'blocked': {
      const blockedReasons: Record<string, string> = {
        empty_content: 'Content is missing or too short',
        no_extraction: 'Enriched but extraction produced no knowledge items',
        no_activation: 'Knowledge items exist but none are active',
        missing_contexts: 'Active KIs exist but none have usage contexts assigned',
        stale_blocker_state: 'Content exists but resource is stuck in a failed/blocked pipeline state',
      };
      reason = blockedReasons[resource.blocked_reason] ?? 'Resource has an unresolved issue';
      break;
    }
    case 'processing':
      reason = 'Currently being processed by the pipeline';
      break;
    default:
      reason = 'Unknown state';
  }

  return { state, reason, evidence: e };
}

// ── Conflict detection ─────────────────────────────────────
export interface ConflictInfo {
  resource_id: string;
  title: string;
  conflicts: string[];
}

export function detectConflicts(resource: CanonicalResourceStatus): string[] {
  const conflicts: string[] = [];

  // Content-backed but blocked as empty_content
  if (resource.is_content_backed && resource.blocked_reason === 'empty_content') {
    conflicts.push('Marked as content-backed but blocked for empty content');
  }

  // Has KIs but canonical stage says uploaded
  if (resource.knowledge_item_count > 0 && resource.canonical_stage === 'uploaded') {
    conflicts.push('Has knowledge items but lifecycle stage is "uploaded"');
  }

  // Enriched but no content
  if (resource.is_enriched && !resource.is_content_backed) {
    conflicts.push('Marked enriched but has no usable content');
  }

  // Active KIs with contexts but not operationalized
  if (resource.active_ki_with_context_count > 0 && resource.canonical_stage !== 'operationalized') {
    conflicts.push(`Has ${resource.active_ki_with_context_count} active KIs with contexts but stage is "${resource.canonical_stage}" not "operationalized"`);
  }

  // Active KIs but blocked
  if (resource.active_ki_count > 0 && resource.blocked_reason !== 'none') {
    conflicts.push(`Has ${resource.active_ki_count} active KIs but is blocked: ${resource.blocked_reason.replace(/_/g, ' ')}`);
  }

  return conflicts;
}

export function detectAllConflicts(resources: CanonicalResourceStatus[]): ConflictInfo[] {
  const results: ConflictInfo[] = [];
  for (const r of resources) {
    const conflicts = detectConflicts(r);
    if (conflicts.length > 0) {
      results.push({ resource_id: r.resource_id, title: r.title, conflicts });
    }
  }
  return results;
}

// ── Metric definitions ─────────────────────────────────────
export interface MetricDefinition {
  label: string;
  definition: string;
  formula: string;
  dataSources: string[];
}

export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  total: {
    label: 'Total Resources',
    definition: 'Count of all resources in the library, regardless of state.',
    formula: 'COUNT(resources)',
    dataSources: ['resources table'],
  },
  ready: {
    label: 'Ready',
    definition: 'Resources with extracted knowledge that are usable downstream. Includes both "Extracted" (KIs exist but not all active) and "Activated" (fully usable by AI).',
    formula: 'COUNT(resources WHERE knowledge_item_count > 0 AND blocked_reason = "none")',
    dataSources: ['resources table', 'knowledge_items table'],
  },
  needsExtraction: {
    label: 'Needs Extraction',
    definition: 'Resources with parseable content but no knowledge items extracted yet.',
    formula: 'COUNT(resources WHERE content_backed = true AND knowledge_item_count = 0 AND blocked_reason = "none")',
    dataSources: ['resources table', 'knowledge_items table'],
  },
  needsReview: {
    label: 'Blocked',
    definition: 'Resources with a detected blocker — empty content, stale state, missing activation, or missing contexts.',
    formula: 'COUNT(resources WHERE blocked_reason ≠ "none")',
    dataSources: ['resources table', 'knowledge_items table'],
  },
  processing: {
    label: 'Processing',
    definition: 'Resources currently being processed by an active background job.',
    formula: 'COUNT(resources WHERE active_job_status = "running")',
    dataSources: ['resources table', 'background_jobs table'],
  },
  ingested: {
    label: 'Ingested',
    definition: 'Resources that exist in the library but have no usable content yet (content too short or missing).',
    formula: 'COUNT(resources WHERE content_backed = false AND blocked_reason = "none")',
    dataSources: ['resources table'],
  },
};

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

// ── Summary view for the control bar ───────────────────────
export interface ControlPlaneSummary {
  total: number;
  ready: number;        // extracted + activated
  needsExtraction: number; // has_content
  needsReview: number;  // blocked or mismatch
  processing: number;
  ingested: number;
  lastUpdated: string;  // ISO timestamp
}

/** Downstream AI readiness metrics (structured for future surface) */
export interface DownstreamReadiness {
  withActiveKIs: number;
  withContexts: number;
  groundingEligible: number;
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
    lastUpdated: new Date().toISOString(),
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

/** Compute downstream AI readiness (Dave grounding, playbook gen, etc.) */
export function computeDownstreamReadiness(
  resources: CanonicalResourceStatus[],
): DownstreamReadiness {
  let withActiveKIs = 0;
  let withContexts = 0;
  let groundingEligible = 0;

  for (const r of resources) {
    if (r.active_ki_count > 0) {
      withActiveKIs++;
      if (r.active_ki_with_context_count > 0) {
        withContexts++;
        // Grounding-eligible = active KIs + contexts + not blocked
        if (r.blocked_reason === 'none') {
          groundingEligible++;
        }
      }
    }
  }

  return { withActiveKIs, withContexts, groundingEligible };
}

// ── Filter type for the central table ──────────────────────
export type ControlPlaneFilter =
  | 'all'
  | 'ready'
  | 'needs_extraction'
  | 'needs_review'
  | 'processing'
  | 'ingested'
  | 'conflicts';

export function matchesFilter(
  state: ControlPlaneState,
  filter: ControlPlaneFilter,
  resourceId?: string,
  conflictIds?: Set<string>,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'conflicts') return conflictIds?.has(resourceId ?? '') ?? false;
  switch (filter) {
    case 'ready': return state === 'extracted' || state === 'activated';
    case 'needs_extraction': return state === 'has_content';
    case 'needs_review': return state === 'blocked';
    case 'processing': return state === 'processing';
    case 'ingested': return state === 'ingested';
    default: return true;
  }
}
