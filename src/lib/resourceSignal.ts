/**
 * Resource Signal & Readiness — PRESENTATION LAYER over canonical truth.
 *
 * This file now delegates to deriveResourceTruth() for all state logic.
 * It only provides backward-compatible signal/readiness/nextAction shapes
 * for components that haven't yet migrated to the truth model directly.
 */

import type { Resource } from '@/hooks/useResources';
import type { AudioJobRecord } from '@/lib/salesBrain/audioOrchestrator';
import { deriveResourceTruth, type ResourceTruth, type LifecycleInfo, TRUTH_STATE_COLORS } from '@/lib/resourceTruthState';

// ── Signal Strength ────────────────────────────────────────
export type SignalStrength = 'high' | 'medium' | 'low';

export interface ResourceSignal {
  signal: SignalStrength;
  signalLabel: string;
  signalColor: string;
}

export function deriveSignal(
  lc: LifecycleInfo | undefined,
  resource: Resource,
): ResourceSignal {
  if (!lc) return { signal: 'low', signalLabel: 'Low', signalColor: 'text-muted-foreground' };

  if (lc.activeKiWithCtx > 0 && lc.stage === 'operationalized') {
    return { signal: 'high', signalLabel: 'High', signalColor: 'text-emerald-600' };
  }
  if (lc.kiCount > 0 || lc.stage === 'knowledge_extracted' || lc.stage === 'activated') {
    return { signal: 'medium', signalLabel: 'Medium', signalColor: 'text-amber-600' };
  }
  return { signal: 'low', signalLabel: 'Low', signalColor: 'text-muted-foreground' };
}

// ── Readiness (now derived from truth) ─────────────────────
export type ReadinessState = 'ready' | 'improving' | 'blocked';

export interface ResourceReadiness {
  readiness: ReadinessState;
  readinessLabel: string;
  readinessColor: string;
  readinessBg: string;
}

export function deriveReadiness(
  lc: LifecycleInfo | undefined,
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): ResourceReadiness {
  const truth = deriveResourceTruth(resource, lc, audioJob);
  return truthToReadiness(truth);
}

function truthToReadiness(truth: ResourceTruth): ResourceReadiness {
  const colors = TRUTH_STATE_COLORS[truth.truth_state];
  switch (truth.truth_state) {
    case 'ready':
      return { readiness: 'ready', readinessLabel: 'Ready', readinessColor: colors.text, readinessBg: colors.bg };
    case 'processing':
      return { readiness: 'improving', readinessLabel: 'Processing', readinessColor: colors.text, readinessBg: colors.bg };
    case 'stalled':
      return { readiness: 'blocked', readinessLabel: 'Stalled', readinessColor: colors.text, readinessBg: colors.bg };
    case 'qa_required':
      return { readiness: 'improving', readinessLabel: 'QA Required', readinessColor: colors.text, readinessBg: colors.bg };
    case 'quarantined':
      return { readiness: 'blocked', readinessLabel: 'Quarantined', readinessColor: colors.text, readinessBg: colors.bg };
    case 'reference_only':
      return { readiness: 'ready', readinessLabel: 'Reference Only', readinessColor: colors.text, readinessBg: colors.bg };
    case 'blocked':
    default:
      return { readiness: 'blocked', readinessLabel: truth.readiness_label, readinessColor: colors.text, readinessBg: colors.bg };
  }
}

// ── Next Action (now derived from truth) ───────────────────
export interface NextAction {
  label: string;
  actionKey: string;
  variant: 'default' | 'outline' | 'ghost';
}

export function deriveNextAction(
  lc: LifecycleInfo | undefined,
  resource: Resource,
  audioJob?: AudioJobRecord | null,
): NextAction | null {
  const truth = deriveResourceTruth(resource, lc, audioJob);
  return truth.next_required_action;
}

// ── Combined ───────────────────────────────────────────────
export interface ResourceInsight {
  signal: ResourceSignal;
  readiness: ResourceReadiness;
  nextAction: NextAction | null;
  truth: ResourceTruth;
}

export function deriveResourceInsight(
  resource: Resource,
  lc: LifecycleInfo | undefined,
  audioJob?: AudioJobRecord | null,
): ResourceInsight {
  const truth = deriveResourceTruth(resource, lc, audioJob);
  return {
    signal: deriveSignal(lc, resource),
    readiness: truthToReadiness(truth),
    nextAction: truth.next_required_action,
    truth,
  };
}
