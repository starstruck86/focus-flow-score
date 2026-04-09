/**
 * Action Outcome Store — tracks results of control plane actions.
 * Provides row-level flash states, recent actions log, and per-resource history.
 *
 * V2: Adds reconciliation (confirmed/partial/mismatched) against refreshed data.
 */

import type { ControlPlaneState } from './controlPlaneState';

export type ReconciliationVerdict = 'confirmed' | 'partial' | 'mismatched' | 'pending';

export interface ActionOutcome {
  id: string;
  resourceId: string;
  resourceTitle: string;
  actionKey: string;
  actionLabel: string;
  timestamp: string;
  status: 'success' | 'no_change' | 'failed' | 'needs_review';
  expectedFromState: ControlPlaneState;
  expectedToState: ControlPlaneState;
  /** State derived from the mutation response (before reconciliation) */
  mutationToState: ControlPlaneState;
  /** State observed after refetching canonical lifecycle data */
  reconciledToState: ControlPlaneState | null;
  reconciliation: ReconciliationVerdict;
  /** If mismatched, a human-readable explanation */
  mismatchExplanation?: string;
  transitionMatched: boolean;
  detail?: string;
}

export interface BulkActionOutcome {
  id: string;
  actionLabel: string;
  timestamp: string;
  attempted: number;
  succeeded: number;
  failed: number;
  unchanged: number;
  needsReview: number;
  /** Reconciliation counts */
  confirmed: number;
  partial: number;
  mismatched: number;
  transitions: { from: ControlPlaneState; to: ControlPlaneState; count: number }[];
  stillNeedAttention: { resourceId: string; title: string; reason: string }[];
}

export type RowFlashStatus = 'success' | 'no_change' | 'failed' | 'needs_review';

// In-memory store (session-scoped)
let _recentActions: ActionOutcome[] = [];
let _recentBulkActions: BulkActionOutcome[] = [];
let _rowFlashes: Map<string, { status: RowFlashStatus; expiresAt: number }> = new Map();

const MAX_RECENT = 50;
const FLASH_DURATION_MS = 8000;

export function recordActionOutcome(outcome: ActionOutcome) {
  _recentActions.unshift(outcome);
  if (_recentActions.length > MAX_RECENT) _recentActions.length = MAX_RECENT;
  setRowFlash(outcome.resourceId, outcome.status);
}

export function recordBulkActionOutcome(outcome: BulkActionOutcome) {
  _recentBulkActions.unshift(outcome);
  if (_recentBulkActions.length > 10) _recentBulkActions.length = 10;
}

export function setRowFlash(resourceId: string, status: RowFlashStatus) {
  _rowFlashes.set(resourceId, { status, expiresAt: Date.now() + FLASH_DURATION_MS });
}

export function getRowFlash(resourceId: string): RowFlashStatus | null {
  const flash = _rowFlashes.get(resourceId);
  if (!flash) return null;
  if (Date.now() > flash.expiresAt) {
    _rowFlashes.delete(resourceId);
    return null;
  }
  return flash.status;
}

export function getRecentActions(): ActionOutcome[] {
  return _recentActions;
}

export function getRecentBulkActions(): BulkActionOutcome[] {
  return _recentBulkActions;
}

/** Get action history for a specific resource, most recent first */
export function getResourceActionHistory(resourceId: string): ActionOutcome[] {
  return _recentActions.filter(a => a.resourceId === resourceId);
}

export function clearExpiredFlashes() {
  const now = Date.now();
  for (const [id, flash] of _rowFlashes) {
    if (now > flash.expiresAt) _rowFlashes.delete(id);
  }
}

export function deriveOutcomeStatus(
  expectedTo: ControlPlaneState,
  actualFrom: ControlPlaneState,
  actualTo: ControlPlaneState,
  opResult: { operationalized: boolean; needsReview: boolean; success: boolean },
): RowFlashStatus {
  if (!opResult.success) return 'failed';
  if (opResult.needsReview) return 'needs_review';
  if (actualFrom === actualTo) return 'no_change';
  return 'success';
}

/** Reconcile mutation result against refreshed canonical state */
export function reconcileOutcome(
  outcome: ActionOutcome,
  reconciledState: ControlPlaneState,
): ActionOutcome {
  const reconciledToState = reconciledState;
  let reconciliation: ReconciliationVerdict;
  let mismatchExplanation: string | undefined;

  if (reconciledToState === outcome.expectedToState) {
    reconciliation = 'confirmed';
  } else if (reconciledToState === outcome.mutationToState && outcome.mutationToState !== outcome.expectedToState) {
    // Mutation and reconciliation agree, but differ from expected
    reconciliation = 'mismatched';
    mismatchExplanation = buildMismatchExplanation(
      outcome.expectedFromState, outcome.expectedToState,
      reconciledToState, outcome.actionKey,
    );
  } else if (reconciledToState !== outcome.mutationToState) {
    // Reconciled state differs even from mutation — partial
    if (isProgressFromState(outcome.expectedFromState, reconciledToState)) {
      reconciliation = 'partial';
      mismatchExplanation = `Progressed to ${reconciledToState} instead of expected ${outcome.expectedToState}`;
    } else {
      reconciliation = 'mismatched';
      mismatchExplanation = buildMismatchExplanation(
        outcome.expectedFromState, outcome.expectedToState,
        reconciledToState, outcome.actionKey,
      );
    }
  } else {
    reconciliation = 'confirmed';
  }

  // Update flash if reconciliation reveals a problem
  if (reconciliation === 'mismatched' && outcome.status === 'success') {
    setRowFlash(outcome.resourceId, 'needs_review');
  }

  const updated: ActionOutcome = {
    ...outcome,
    reconciledToState,
    reconciliation,
    mismatchExplanation,
    transitionMatched: reconciledToState === outcome.expectedToState,
  };

  // Update in-place in the store
  const idx = _recentActions.findIndex(a => a.id === outcome.id);
  if (idx >= 0) _recentActions[idx] = updated;

  return updated;
}

function buildMismatchExplanation(
  fromState: ControlPlaneState,
  expectedTo: ControlPlaneState,
  actualTo: ControlPlaneState,
  actionKey: string,
): string {
  const EXPLANATIONS: Record<string, Record<string, string>> = {
    extract: {
      blocked: 'Extraction ran but produced no knowledge items — resource moved to blocked state',
      has_content: 'Extraction completed but KIs were not persisted — content still present',
      ingested: 'Content was invalidated during extraction — resource reverted to ingested',
    },
    enrich: {
      ingested: 'Enrichment failed to produce usable content — resource remains ingested',
      blocked: 'Enrichment detected an unresolvable issue — resource is now blocked',
    },
    activate: {
      extracted: 'Activation criteria not met — KIs exist but none qualify for activation',
      blocked: 'Activation found issues — resource is now blocked for review',
      has_content: 'Activation failed — knowledge items may have been invalidated',
    },
    fix: {
      blocked: 'Diagnosis ran but could not resolve the blocker',
      ingested: 'Repair cleared content — resource needs re-enrichment',
    },
  };

  const actionExplanations = EXPLANATIONS[actionKey];
  if (actionExplanations?.[actualTo]) return actionExplanations[actualTo];

  return `Expected transition to "${expectedTo}" but resource is now "${actualTo}"`;
}

const STATE_PROGRESSION: ControlPlaneState[] = ['ingested', 'has_content', 'extracted', 'activated'];

function isProgressFromState(from: ControlPlaneState, to: ControlPlaneState): boolean {
  const fromIdx = STATE_PROGRESSION.indexOf(from);
  const toIdx = STATE_PROGRESSION.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx > fromIdx;
}
