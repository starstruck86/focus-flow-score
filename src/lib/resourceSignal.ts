/**
 * Resource Signal & Readiness — derives user-facing signal strength,
 * readiness state, and next action from canonical lifecycle data.
 */

import type { Resource } from '@/hooks/useResources';
import type { BlockedReason } from '@/lib/canonicalLifecycle';
import { deriveProcessingState } from '@/lib/processingState';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';

// ── Signal Strength ────────────────────────────────────────
export type SignalStrength = 'high' | 'medium' | 'low';

export interface ResourceSignal {
  signal: SignalStrength;
  signalLabel: string;
  signalColor: string;
}

export function deriveSignal(
  lc: { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number } | undefined,
  resource: Resource,
): ResourceSignal {
  if (!lc) return { signal: 'low', signalLabel: 'Low', signalColor: 'text-muted-foreground' };

  // High: operationalized with active KIs that have context
  if (lc.stage === 'operationalized' && lc.activeKiWithCtx > 0) {
    return { signal: 'high', signalLabel: 'High', signalColor: 'text-emerald-600' };
  }

  // Medium: has KIs extracted but not fully operationalized
  if (lc.kiCount > 0 || lc.stage === 'knowledge_extracted' || lc.stage === 'activated') {
    return { signal: 'medium', signalLabel: 'Medium', signalColor: 'text-amber-600' };
  }

  // Low: no KIs, early stage
  return { signal: 'low', signalLabel: 'Low', signalColor: 'text-muted-foreground' };
}

// ── Readiness ──────────────────────────────────────────────
export type ReadinessState = 'ready' | 'improving' | 'blocked';

export interface ResourceReadiness {
  readiness: ReadinessState;
  readinessLabel: string;
  readinessColor: string;
  readinessBg: string;
}

export function deriveReadiness(
  lc: { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number } | undefined,
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): ResourceReadiness {
  if (!lc) {
    return { readiness: 'blocked', readinessLabel: 'Unknown', readinessColor: 'text-destructive', readinessBg: 'bg-destructive/10' };
  }

  // Ready: operationalized
  if (lc.stage === 'operationalized') {
    return { readiness: 'ready', readinessLabel: 'Ready', readinessColor: 'text-emerald-600', readinessBg: 'bg-emerald-500/10' };
  }

  // Blocked: has a blocking reason
  if (lc.blocked !== 'none') {
    // Distinguish "improving" (has content, just needs extraction/activation) from truly blocked
    if (lc.blocked === 'no_extraction' || lc.blocked === 'no_activation') {
      return { readiness: 'improving', readinessLabel: 'Improving', readinessColor: 'text-amber-600', readinessBg: 'bg-amber-500/10' };
    }
    return { readiness: 'blocked', readinessLabel: 'Blocked', readinessColor: 'text-destructive', readinessBg: 'bg-destructive/10' };
  }

  // Check processing state for running jobs
  const ps = deriveProcessingState(resource, audioJob);
  if (ps.state === 'RUNNING') {
    return { readiness: 'improving', readinessLabel: 'Processing', readinessColor: 'text-primary', readinessBg: 'bg-primary/10' };
  }

  // Default: improving (not yet operationalized but not blocked)
  return { readiness: 'improving', readinessLabel: 'Improving', readinessColor: 'text-amber-600', readinessBg: 'bg-amber-500/10' };
}

// ── Next Action ────────────────────────────────────────────
export interface NextAction {
  label: string;
  actionKey: string;
  variant: 'default' | 'outline' | 'ghost';
}

export function deriveNextAction(
  lc: { stage: string; blocked: string } | undefined,
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): NextAction | null {
  if (!lc) return null;

  // Operationalized: no action needed
  if (lc.stage === 'operationalized') {
    return null;
  }

  // Blocked-reason-driven actions
  switch (lc.blocked as BlockedReason) {
    case 'no_extraction':
      return { label: 'Extract', actionKey: 'extract', variant: 'default' };
    case 'no_activation':
      return { label: 'Activate', actionKey: 'activate', variant: 'default' };
    case 'missing_contexts':
      return { label: 'Repair', actionKey: 'repair_contexts', variant: 'outline' };
    case 'empty_content':
      return { label: 'Re-enrich', actionKey: 're_enrich', variant: 'outline' };
    case 'stale_blocker_state':
      return { label: 'Review', actionKey: 'view', variant: 'outline' };
  }

  // Processing-state fallback
  const ps = deriveProcessingState(resource, audioJob);
  if (ps.state === 'READY' && resource.file_url?.startsWith('http')) {
    return { label: 'Enrich', actionKey: 'deep_enrich', variant: 'default' };
  }
  if (ps.state === 'RETRYABLE_FAILURE') {
    return { label: 'Retry', actionKey: 'deep_enrich', variant: 'outline' };
  }
  if (ps.state === 'MANUAL_REQUIRED' || ps.state === 'METADATA_ONLY') {
    return { label: 'Manual', actionKey: 'manual_assist', variant: 'outline' };
  }

  return null;
}

// ── Combined ───────────────────────────────────────────────
export interface ResourceInsight {
  signal: ResourceSignal;
  readiness: ResourceReadiness;
  nextAction: NextAction | null;
}

export function deriveResourceInsight(
  resource: Resource,
  lc: { stage: string; blocked: string; kiCount: number; activeKi: number; activeKiWithCtx: number } | undefined,
  audioJob?: AudioJobRecord | null,
): ResourceInsight {
  return {
    signal: deriveSignal(lc, resource),
    readiness: deriveReadiness(lc, resource, audioJob),
    nextAction: deriveNextAction(lc, resource, audioJob),
  };
}
