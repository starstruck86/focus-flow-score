/**
 * Action Outcome Store — tracks results of control plane actions.
 * Provides row-level flash states and a recent actions log.
 */

import type { ControlPlaneState } from './controlPlaneState';

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
  actualFromState: ControlPlaneState;
  actualToState: ControlPlaneState;
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
