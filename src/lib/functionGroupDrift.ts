/**
 * Runtime drift detector for edge function deploy groups.
 *
 * Each edge function returns its group version via `x-function-group-version`.
 * This module tracks observed versions per group and blocks affected
 * functionality when a mismatch is detected.
 */

import { createLogger } from './logger';

const logger = createLogger('FunctionGroupDrift');

// ── Group definitions ──────────────────────────────────────────
export interface FunctionGroup {
  name: string;
  functions: string[];
}

export const FUNCTION_GROUPS: FunctionGroup[] = [
  { name: 'whoop', functions: ['whoop-auth', 'whoop-callback', 'whoop-sync'] },
  { name: 'dave', functions: ['dave-conversation-token'] },
];

const functionToGroup = new Map<string, string>();
for (const g of FUNCTION_GROUPS) {
  for (const fn of g.functions) {
    functionToGroup.set(fn, g.name);
  }
}

// ── Version tracking ───────────────────────────────────────────
/** Map from group name → Map from function name → observed version */
const observedVersions = new Map<string, Map<string, string>>();

/** Groups currently in drift state */
const driftedGroups = new Map<string, DriftInfo>();

export interface DriftInfo {
  groupName: string;
  expected: string;
  actual: string;
  firstFunction: string;
  conflictingFunction: string;
  detectedAt: number;
}

/**
 * Record a version observed from an edge function response.
 * Returns a DriftInfo if this creates a version mismatch within the group.
 */
export function recordFunctionVersion(
  functionName: string,
  version: string,
): DriftInfo | null {
  const groupName = functionToGroup.get(functionName);
  if (!groupName) return null; // Not in any tracked group

  if (!observedVersions.has(groupName)) {
    observedVersions.set(groupName, new Map());
  }
  const groupVersions = observedVersions.get(groupName)!;
  groupVersions.set(functionName, version);

  // Check for mismatch within the group
  const versions = Array.from(groupVersions.entries());
  if (versions.length < 2) return null; // Need at least 2 to compare

  const [firstFn, firstVer] = versions[0];
  for (let i = 1; i < versions.length; i++) {
    const [otherFn, otherVer] = versions[i];
    if (otherVer !== firstVer) {
      const drift: DriftInfo = {
        groupName,
        expected: firstVer,
        actual: otherVer,
        firstFunction: firstFn,
        conflictingFunction: otherFn,
        detectedAt: Date.now(),
      };
      driftedGroups.set(groupName, drift);
      logger.error(`VERSION DRIFT in group "${groupName}": ${firstFn}=${firstVer} vs ${otherFn}=${otherVer}. Blocking group.`);
      return drift;
    }
  }

  // All versions match — clear any previous drift for this group
  driftedGroups.delete(groupName);
  return null;
}

/**
 * Check whether a function's group is currently blocked due to drift.
 * Call this BEFORE making a request to fail fast.
 */
export function checkDriftBlock(functionName: string): DriftInfo | null {
  const groupName = functionToGroup.get(functionName);
  if (!groupName) return null;
  return driftedGroups.get(groupName) ?? null;
}

/**
 * Get all currently drifted groups.
 */
export function getDriftedGroups(): ReadonlyMap<string, DriftInfo> {
  return driftedGroups;
}

/**
 * Build a user-facing error message for a drift block.
 */
export function driftErrorMessage(drift: DriftInfo): string {
  return (
    `Deployment version mismatch detected in "${drift.groupName}" function group. ` +
    `${drift.firstFunction} is running ${drift.expected} but ${drift.conflictingFunction} is running ${drift.actual}. ` +
    `Please redeploy all functions in this group together to resolve.`
  );
}

/**
 * Clear drift state (e.g. after a confirmed redeployment).
 */
export function clearDrift(groupName?: string): void {
  if (groupName) {
    driftedGroups.delete(groupName);
    observedVersions.delete(groupName);
  } else {
    driftedGroups.clear();
    observedVersions.clear();
  }
}

/** Response header name used by edge functions */
export const VERSION_HEADER = 'x-function-group-version';
