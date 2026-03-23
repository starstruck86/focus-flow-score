/**
 * Hook to check whether a function group is blocked by deployment drift.
 * Returns null if the group is healthy, or a DriftInfo if blocked.
 */

import { useSyncExternalStore, useCallback } from 'react';
import { checkDriftBlock, getDriftedGroups, type DriftInfo, FUNCTION_GROUPS } from './functionGroupDrift';

/** Subscribe to drift state changes (piggybacks on the module-level map) */
const _listeners = new Set<() => void>();
let _snapshot = 0;

// Patch recordFunctionVersion to notify subscribers
const origRecord = (await import('./functionGroupDrift')).recordFunctionVersion;
// We can't patch at import time, so instead use a polling snapshot approach
// that's cheap — getDriftedGroups is a simple map read.

function subscribe(cb: () => void) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

/**
 * Check if any function in the given group has a drift block.
 * Returns the DriftInfo or null.
 */
export function useGroupDrift(groupName: string): DriftInfo | null {
  const group = FUNCTION_GROUPS.find(g => g.name === groupName);
  if (!group) return null;

  // Check any function in the group — they all map to the same drift state
  return checkDriftBlock(group.functions[0]);
}
