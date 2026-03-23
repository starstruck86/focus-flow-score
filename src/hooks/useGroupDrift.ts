/**
 * Hook to check whether a function group is blocked by deployment drift.
 * Returns null if the group is healthy, or a DriftInfo if blocked.
 */

import { checkDriftBlock, type DriftInfo, FUNCTION_GROUPS } from '@/lib/functionGroupDrift';

/**
 * Check if any function in the given group has a drift block.
 * Returns the DriftInfo or null.
 */
export function useGroupDrift(groupName: string): DriftInfo | null {
  const group = FUNCTION_GROUPS.find(g => g.name === groupName);
  if (!group) return null;
  return checkDriftBlock(group.functions[0]);
}
