/**
 * Loop Runtime — Write-point wiring + precedence + invalidation
 *
 * Connects the loop scheduler and roleplay knowledge models to
 * real runtime events. Enforces source-of-truth precedence and
 * handles invalidation / rebuild safely.
 */

import {
  loadLoops,
  saveLoops,
  markPrepComplete,
  markActionComplete,
  getCarryForwardAccounts,
  generateLoopsFromBlocks,
  type ExecutionLoop,
  type LoopAccount,
} from '@/lib/loopScheduler';
import {
  getTodayRoleplayStatus,
  recordRoleplayBlockEvent,
  getRoleplayBlockConfig,
  findRoleplaySlot,
  type RoleplayBlockStatus,
  type RoleplayBlockEvent,
} from '@/lib/dailyRoleplayBlock';
import { isLoopNativeSchedulerEnabled, isRoleplayGroundingEnabled, isAccountExecutionModelEnabled } from '@/lib/featureFlags';
import { todayInAppTz } from '@/lib/timeFormat';
import {
  markAccountPrepped,
  recordAccountOutcome,
  markAccountWorkedGeneric,
  buildCarryForward as buildAccountCarryForward,
  buildExecutionSummary,
  getLoopAccountReadiness,
  reconcileOnPlanChange,
  type OutcomeType,
  type AccountExecutionEntry,
} from '@/lib/accountExecutionState';

// ── Provenance Model ───────────────────────────────────────

export interface RoleplayProvenance {
  selectedScenarioId: string;
  scenarioType: string;
  sourcePlaybookIds: string[];
  sourceResourceIds: string[];
  groundingSource: 'playbook' | 'default';
  freshnessState: 'fresh' | 'stale' | 'expired' | 'unknown';
  selectionReason: string;
  timestamp: string;
}

const PROVENANCE_KEY = 'roleplay-provenance-log';

export function logProvenance(provenance: RoleplayProvenance): void {
  try {
    const existing: RoleplayProvenance[] = JSON.parse(localStorage.getItem(PROVENANCE_KEY) || '[]');
    existing.push(provenance);
    // Keep last 50
    localStorage.setItem(PROVENANCE_KEY, JSON.stringify(existing.slice(-50)));
  } catch { }
}

export function loadProvenanceLog(): RoleplayProvenance[] {
  try {
    return JSON.parse(localStorage.getItem(PROVENANCE_KEY) || '[]');
  } catch { return []; }
}

export function getLatestProvenance(): RoleplayProvenance | null {
  const log = loadProvenanceLog();
  return log.length > 0 ? log[log.length - 1] : null;
}

// ── Runtime Write Points ───────────────────────────────────

/**
 * Called when a prep block is marked as completed in the daily plan.
 * Updates the corresponding loop's state.
 */
export function onPrepComplete(
  date: string,
  blockIndex: number,
  preparedAccounts: LoopAccount[],
): void {
  if (!isLoopNativeSchedulerEnabled()) return;
  const loops = loadLoops(date);
  if (loops.length === 0) return;
  const blockId = `block-${blockIndex}`;
  const targetLoop = loops.find(l => l.prepBlockId === blockId);
  if (!targetLoop) return;
  const updated = markPrepComplete(loops, targetLoop.loopId, preparedAccounts);
  saveLoops(date, updated);

  // Write account-level truth
  if (isAccountExecutionModelEnabled()) {
    for (const acct of preparedAccounts) {
      markAccountPrepped(date, acct.id, acct.name, targetLoop.loopId, blockId);
    }
  }
}

/**
 * Called when an action block is marked as completed.
 */
export function onActionComplete(
  date: string,
  blockIndex: number,
  workedAccounts: LoopAccount[],
): void {
  if (!isLoopNativeSchedulerEnabled()) return;
  const loops = loadLoops(date);
  if (loops.length === 0) return;
  const blockId = `block-${blockIndex}`;
  const targetLoop = loops.find(l => l.actionBlockId === blockId);
  if (!targetLoop) return;
  const updated = markActionComplete(loops, targetLoop.loopId, workedAccounts);
  saveLoops(date, updated);

  // Write account-level truth
  if (isAccountExecutionModelEnabled()) {
    for (const acct of workedAccounts) {
      markAccountWorkedGeneric(date, acct.id, acct.name, targetLoop.loopId, blockId);
    }
  }
}

/**
 * Called when individual accounts are worked during an action block.
 */
export function onAccountWorked(
  date: string,
  loopId: string,
  account: LoopAccount,
): void {
  if (!isLoopNativeSchedulerEnabled()) return;
  const loops = loadLoops(date);
  const loop = loops.find(l => l.loopId === loopId);
  if (!loop) return;
  if (!loop.accountsWorked.some(a => a.id === account.id)) {
    loop.accountsWorked.push({ ...account, workedAt: new Date().toISOString() });
    saveLoops(date, loops);
  }
}

/**
 * Persist carry-forward accounts for tomorrow's loops.
 */
export function persistCarryForward(date: string): LoopAccount[] {
  const loops = loadLoops(date);
  return getCarryForwardAccounts(loops);
}

// ── Source-of-Truth Precedence ──────────────────────────────

export type LoopSource = 'server' | 'client' | 'heuristic';

export interface LoopPrecedenceResult {
  source: LoopSource;
  loops: ExecutionLoop[];
  reason: string;
}

/**
 * Resolve loops using strict precedence:
 * 1. Server loop metadata (from plan payload)
 * 2. Client persisted loop state
 * 3. Heuristic fallback (generated from blocks)
 *
 * Also reconciles: if server and client diverge, server wins
 * but completed client state is preserved.
 */
export function resolveLoops(
  date: string,
  serverLoopMetadata?: any[],
  planBlocks?: any[],
): LoopPrecedenceResult {
  // 1. Server loop metadata
  if (serverLoopMetadata && Array.isArray(serverLoopMetadata) && serverLoopMetadata.length > 0) {
    // Reconcile: merge completed state from client into server truth
    if (isLoopNativeSchedulerEnabled()) {
      const clientLoops = loadLoops(date);
      if (clientLoops.length > 0) {
        const completedIds = new Set(clientLoops.filter(l => l.status === 'complete').map(l => l.loopId));
        const reconciled = (serverLoopMetadata as ExecutionLoop[]).map(sl => {
          if (completedIds.has(sl.loopId)) {
            const cl = clientLoops.find(c => c.loopId === sl.loopId);
            if (cl) return { ...sl, status: cl.status, accountsPrepared: cl.accountsPrepared, accountsWorked: cl.accountsWorked };
          }
          return sl;
        });
        saveLoops(date, reconciled);
        return { source: 'server', loops: reconciled, reason: 'Server metadata (reconciled with client completed state)' };
      }
    }
    return { source: 'server', loops: serverLoopMetadata as ExecutionLoop[], reason: 'Server-generated loop metadata' };
  }

  // 2. Client persisted
  if (isLoopNativeSchedulerEnabled()) {
    const clientLoops = loadLoops(date);
    if (clientLoops.length > 0) {
      return { source: 'client', loops: clientLoops, reason: 'Client-persisted loop state' };
    }
  }

  // 3. Heuristic fallback
  if (planBlocks && planBlocks.length > 0) {
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);
    const carryForward = persistCarryForward(yesterday.toISOString().split('T')[0]);
    const generated = generateLoopsFromBlocks(planBlocks, date, carryForward);
    return { source: 'heuristic', loops: generated, reason: 'Generated from plan blocks (heuristic)' };
  }

  return { source: 'heuristic', loops: [], reason: 'No loop data available' };
}

// ── Roleplay Status Precedence ─────────────────────────────

export type RoleplayStatusSource = 'persisted_event' | 'auto_injection' | 'missed_no_slot';

export interface RoleplayStatusResult {
  source: RoleplayStatusSource;
  status: RoleplayBlockStatus;
  event: RoleplayBlockEvent | null;
}

/**
 * Resolve roleplay status for today using strict precedence:
 * 1. Persisted roleplay event
 * 2. Auto-injection eligibility
 * 3. missed_no_slot fallback
 */
export function resolveRoleplayStatus(
  planBlocks?: Array<{ start_time: string; end_time: string; type: string }>,
): RoleplayStatusResult {
  const today = todayInAppTz();

  // 1. Persisted event
  const existing = getTodayRoleplayStatus(today);
  if (existing) {
    return { source: 'persisted_event', status: existing.status, event: existing };
  }

  // 2. Auto-injection eligibility
  const config = getRoleplayBlockConfig();
  if (!config.enabled) {
    return { source: 'missed_no_slot', status: 'missed_no_slot', event: null };
  }

  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) {
    return { source: 'missed_no_slot', status: 'missed_no_slot', event: null };
  }

  const blocks = planBlocks || [];
  const slot = findRoleplaySlot(blocks);
  if (slot) {
    return { source: 'auto_injection', status: 'scheduled', event: null };
  }

  // 3. No slot
  return { source: 'missed_no_slot', status: 'missed_no_slot', event: null };
}

// ── Invalidation / Rebuild Rules ───────────────────────────

const LOOP_PLAN_HASH_KEY = 'loop-plan-hash';

function hashPlanBlocks(blocks: any[]): string {
  return blocks.map(b => `${b.start_time}-${b.end_time}-${b.type}`).join('|');
}

/**
 * Check if loops need to be invalidated and rebuilt.
 * Returns true if rebuild is needed.
 */
export function shouldInvalidateLoops(
  date: string,
  currentPlanBlocks: any[],
): boolean {
  const storedHash = localStorage.getItem(`${LOOP_PLAN_HASH_KEY}-${date}`);
  const currentHash = hashPlanBlocks(currentPlanBlocks);

  if (storedHash !== currentHash) {
    localStorage.setItem(`${LOOP_PLAN_HASH_KEY}-${date}`, currentHash);
    return true;
  }
  return false;
}

/**
 * Rebuild loops from plan blocks, preserving any completed state.
 */
export function rebuildLoopsIfNeeded(
  date: string,
  planBlocks: any[],
  serverLoopMetadata?: any[],
): ExecutionLoop[] {
  if (!isLoopNativeSchedulerEnabled()) return [];

  if (!shouldInvalidateLoops(date, planBlocks)) {
    return loadLoops(date);
  }

  // Preserve completed state from old loops
  const oldLoops = loadLoops(date);
  const completedLoopIds = new Set(
    oldLoops.filter(l => l.status === 'complete').map(l => l.loopId)
  );

  // Use server metadata if available, otherwise regenerate
  let newLoops: ExecutionLoop[];
  if (serverLoopMetadata && serverLoopMetadata.length > 0) {
    newLoops = serverLoopMetadata as ExecutionLoop[];
  } else {
    const carryForward = getCarryForwardAccounts(oldLoops);
    newLoops = generateLoopsFromBlocks(planBlocks, date, carryForward);
  }

  // Restore completed state for matching loops
  for (const loop of newLoops) {
    if (completedLoopIds.has(loop.loopId)) {
      const oldLoop = oldLoops.find(l => l.loopId === loop.loopId);
      if (oldLoop) {
        loop.status = oldLoop.status;
        loop.accountsPrepared = oldLoop.accountsPrepared;
        loop.accountsWorked = oldLoop.accountsWorked;
      }
    }
  }

  saveLoops(date, newLoops);
  return newLoops;
}

// ── Scenario Regeneration Triggers ─────────────────────────

const REGEN_TRIGGER_KEY = 'scenario-regen-last-trigger';

/**
 * Should be called when playbooks are loaded/updated.
 * Delegates to roleplayScenarioManager.regenerateScenariosIfNeeded.
 * Returns whether regeneration happened.
 */
export function triggerScenarioRegenIfNeeded(
  playbooks: any[],
): { regenerated: boolean; reason: string } {
  if (!isRoleplayGroundingEnabled()) return { regenerated: false, reason: 'Roleplay grounding disabled' };

  try {
    // Dynamic import to avoid circular deps
    const { regenerateScenariosIfNeeded } = require('@/lib/roleplayScenarioManager');
    const result = regenerateScenariosIfNeeded(playbooks);
    if (result.regenerated) {
      localStorage.setItem(REGEN_TRIGGER_KEY, new Date().toISOString());
    }
    return { regenerated: result.regenerated, reason: result.reason };
  } catch (e) {
    return { regenerated: false, reason: `Regeneration failed: ${e}` };
  }
}

/**
 * Check scenario freshness on app load.
 * Lazy trigger — only runs if cache is stale.
 */
export function checkScenarioFreshnessOnLoad(): void {
  if (!isRoleplayGroundingEnabled()) return;

  try {
    const { loadCachedScenarios } = require('@/lib/roleplayKnowledge');
    const scenarios = loadCachedScenarios();
    if (scenarios.length === 0) return;

    // Check age of oldest scenario
    const oldest = scenarios.reduce((min: string, s: any) => {
      const gen = s.generatedAt || s.refreshedAt || '';
      return gen < min ? gen : min;
    }, new Date().toISOString());

    const ageMs = Date.now() - new Date(oldest).getTime();
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    if (ageMs > SEVEN_DAYS) {
      // Mark all as stale
      const updated = scenarios.map((s: any) => ({ ...s, freshnessState: 'stale' as const }));
      const { saveCachedScenarios } = require('@/lib/roleplayKnowledge');
      saveCachedScenarios(updated);
    }
  } catch { }
}

// ── Fallback Matrix ────────────────────────────────────────

export interface FallbackBehavior {
  condition: string;
  behavior: string;
  userSees: string;
  logged: boolean;
}

export const FALLBACK_MATRIX: FallbackBehavior[] = [
  {
    condition: 'No loop metadata',
    behavior: 'Heuristic readiness from plan blocks',
    userSees: 'Normal daily plan without loop indicators',
    logged: false,
  },
  {
    condition: 'Malformed loop metadata',
    behavior: 'Skip loop rendering, fall back to heuristic',
    userSees: 'Normal daily plan',
    logged: true,
  },
  {
    condition: 'No trusted scenarios',
    behavior: 'Default fallback scenario (cold call / Director of Marketing)',
    userSees: 'Generic roleplay prompt',
    logged: false,
  },
  {
    condition: 'Stale scenario cache',
    behavior: 'Use stale scenarios with stale indicator, queue regen',
    userSees: 'Roleplay works normally, stale badge in debug',
    logged: false,
  },
  {
    condition: 'Scenario regeneration failure',
    behavior: 'Keep existing cache, log error',
    userSees: 'No change — existing scenarios remain',
    logged: true,
  },
  {
    condition: 'No roleplay morning slot',
    behavior: 'Record missed_no_slot, no block injection',
    userSees: '"No morning slot available" message',
    logged: false,
  },
  {
    condition: 'No prepared accounts for action block',
    behavior: 'Show "prep needed" signal',
    userSees: '"Prep needed before next call block" warning',
    logged: false,
  },
];

// ── Debug State Snapshot ───────────────────────────────────

export interface SystemDebugSnapshot {
  // Loop state
  loopSource: LoopSource;
  loopCount: number;
  currentLoopStatus: string | null;
  carryForwardCount: number;

  // Roleplay state
  roleplayStatusToday: RoleplayBlockStatus | null;
  roleplayGroundingSource: 'playbook' | 'default' | null;
  selectedScenarioId: string | null;
  scenarioFreshness: string | null;
  lastScenarioRegenTime: string | null;

  // Suppression
  capabilityPromptSuppressed: boolean;
  suppressionReason: string | null;

  // Metadata
  snapshotAt: string;
}

export function captureDebugSnapshot(
  planBlocks?: any[],
  serverLoopMetadata?: any[],
): SystemDebugSnapshot {
  const today = todayInAppTz();
  const loopResult = resolveLoops(today, serverLoopMetadata, planBlocks);
  const roleplayResult = resolveRoleplayStatus(planBlocks);
  const provenance = getLatestProvenance();
  const regenTime = localStorage.getItem(REGEN_TRIGGER_KEY);

  // Check capability suppression
  let capSuppressed = false;
  let capReason: string | null = null;
  try {
    const suppressKey = `capability-prompt-suppressed`;
    const raw = localStorage.getItem(suppressKey);
    if (raw) {
      const data = JSON.parse(raw);
      capSuppressed = !!data.suppressed;
      capReason = data.reason || null;
    }
  } catch { }

  const carryForward = loopResult.loops.length > 0
    ? getCarryForwardAccounts(loopResult.loops).length
    : 0;

  const currentLoop = loopResult.loops.find(l => l.status !== 'complete') || null;

  return {
    loopSource: loopResult.source,
    loopCount: loopResult.loops.length,
    currentLoopStatus: currentLoop?.status || null,
    carryForwardCount: carryForward,
    roleplayStatusToday: roleplayResult.status,
    roleplayGroundingSource: provenance?.groundingSource || null,
    selectedScenarioId: provenance?.selectedScenarioId || null,
    scenarioFreshness: provenance?.freshnessState || null,
    lastScenarioRegenTime: regenTime || null,
    capabilityPromptSuppressed: capSuppressed,
    suppressionReason: capReason,
    snapshotAt: new Date().toISOString(),
  };
}
