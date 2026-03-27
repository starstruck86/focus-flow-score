/**
 * Loop Readiness Layer
 *
 * When ENABLE_LOOP_NATIVE_SCHEDULER is on, uses explicit loop state
 * from loopScheduler.ts. Otherwise falls back to heuristic readiness.
 */
import { isLoopNativeSchedulerEnabled } from '@/lib/featureFlags';
import { loadLoops, computeLoopReadinessFromLoops, type LoopReadinessState } from '@/lib/loopScheduler';

export interface LoopReadiness {
  loopId: string;
  loopType: 'prospecting' | 'pipeline' | 'build';
  prepReady: boolean;
  actionReady: boolean;
  accountsPreparedCount: number;
  accountsActionableCount: number;
  blockedReason: string | null;
}

export interface PrepActionSignal {
  roleplayStatus: 'completed' | 'skipped' | 'scheduled' | 'missed_no_slot' | null;
  roleplayStreakDays: number;
  roleplayGroundingSource?: 'playbook' | 'default' | null;
  nextActionBlockLabel: string | null;
  nextActionBlockReady: boolean;
  preparedAccountsWaiting: number;
  blockedReason: string | null;
  carryForwardCount: number;
  currentLoopStatus?: string | null;
  nextLoopStatus?: string | null;
  currentLoopType?: string | null;
  serverLoopCount?: number;
}

// ── Heuristic: count "prepared" accounts ─────────────────────

interface BlockLike {
  type: string;
  linked_accounts?: { id: string; name: string }[];
  goals?: string[];
  build_steps?: { step: string; done: boolean }[];
}

/**
 * Walk the block list and determine how many accounts have been
 * "prepped" (appeared in a completed prep/research/build block)
 * vs how many are linked to upcoming action blocks.
 */
export function computeLoopReadiness(
  blocks: BlockLike[],
  completedGoals: Set<string>,
  currentBlockIndex: number,
): LoopReadiness[] {
  // Gather accounts from completed prep-type blocks
  const preppedAccountIds = new Set<string>();
  const PREP_TYPES = new Set(['prep', 'research', 'build']);
  const ACTION_TYPES = new Set(['prospecting', 'pipeline']);

  for (let i = 0; i <= Math.min(currentBlockIndex, blocks.length - 1); i++) {
    const b = blocks[i];
    if (!PREP_TYPES.has(b.type)) continue;
    // Consider block "done" if at least one goal is completed
    const blockHasCompletion = b.goals?.some((_, gi) => completedGoals.has(`${i}-${gi}`));
    if (blockHasCompletion || i < currentBlockIndex) {
      b.linked_accounts?.forEach(a => preppedAccountIds.add(a.id));
    }
  }

  // Build readiness for each upcoming action block
  const loops: LoopReadiness[] = [];
  for (let i = Math.max(0, currentBlockIndex); i < blocks.length; i++) {
    const b = blocks[i];
    if (!ACTION_TYPES.has(b.type)) continue;

    const linkedIds = b.linked_accounts?.map(a => a.id) || [];
    const actionableCount = linkedIds.filter(id => preppedAccountIds.has(id)).length;
    const ready = linkedIds.length === 0 || actionableCount > 0; // no linked = general block = ready

    loops.push({
      loopId: `loop-${i}`,
      loopType: b.type === 'pipeline' ? 'pipeline' : 'prospecting',
      prepReady: preppedAccountIds.size > 0,
      actionReady: ready,
      accountsPreparedCount: preppedAccountIds.size,
      accountsActionableCount: actionableCount,
      blockedReason: ready ? null : 'Prep incomplete — research accounts before calling',
    });
  }

  return loops;
}

/**
 * Build the summary signal for cockpit / daily plan header.
 * Uses explicit loop state when the loop-native scheduler is enabled.
 * Also reads server-side loop_metadata from plan payload when available.
 */
export function buildPrepActionSignal(
  blocks: BlockLike[],
  completedGoals: Set<string>,
  currentBlockIndex: number,
  roleplayStatus: PrepActionSignal['roleplayStatus'],
  roleplayStreakDays: number,
  date?: string,
  serverLoopMetadata?: any[],
  roleplayGroundingSource?: 'playbook' | 'default' | null,
): PrepActionSignal {
  // Use server-side loop metadata if present (source of truth)
  if (serverLoopMetadata && serverLoopMetadata.length > 0) {
    const pending = serverLoopMetadata.filter((l: any) => l.status !== 'complete');
    const current = pending.find((l: any) => l.status === 'in_progress') || pending[0] || null;
    const next = current ? pending.find((l: any) => l.loopId !== current.loopId) || null : null;
    const totalPrepared = serverLoopMetadata.reduce((s: number, l: any) => s + (l.accountsPrepared?.length || 0), 0);
    const totalWorked = serverLoopMetadata.reduce((s: number, l: any) => s + (l.accountsWorked?.length || 0), 0);
    const carryForward = serverLoopMetadata
      .filter((l: any) => l.carryForwardToNextLoop)
      .reduce((s: number, l: any) => s + (l.accountsPrepared?.length || 0) - (l.accountsWorked?.length || 0), 0);

    const nextActionLoop = pending.find((l: any) => l.actionBlockIndex !== null);
    const isReady = nextActionLoop
      ? nextActionLoop.status === 'action_ready' || (nextActionLoop.accountsPrepared?.length || 0) > 0
      : true;

    return {
      roleplayStatus,
      roleplayStreakDays,
      roleplayGroundingSource,
      nextActionBlockLabel: nextActionLoop ? 'Call Block' : null,
      nextActionBlockReady: isReady,
      preparedAccountsWaiting: Math.max(0, totalPrepared - totalWorked),
      blockedReason: nextActionLoop?.blockedReason || null,
      carryForwardCount: Math.max(0, carryForward),
      currentLoopStatus: current?.status || null,
      nextLoopStatus: next?.status || null,
      currentLoopType: current?.loopType || null,
      serverLoopCount: serverLoopMetadata.length,
    };
  }

  // Use explicit loop state when available (client-side)
  if (date && isLoopNativeSchedulerEnabled()) {
    const loops = loadLoops(date);
    if (loops.length > 0) {
      const state = computeLoopReadinessFromLoops(loops);
      return {
        roleplayStatus,
        roleplayStreakDays,
        roleplayGroundingSource,
        nextActionBlockLabel: state.currentLoop?.actionBlockId ? 'Call Block' : null,
        nextActionBlockReady: state.isNextActionReady,
        preparedAccountsWaiting: state.totalPrepared - state.totalWorked,
        blockedReason: state.blockedReason,
        carryForwardCount: state.carryForwardCount,
        currentLoopStatus: state.currentLoop?.status || null,
        nextLoopStatus: state.nextLoop?.status || null,
      };
    }
  }
  const loops = computeLoopReadiness(blocks, completedGoals, currentBlockIndex);

  // Find next action block
  const ACTION_TYPES = new Set(['prospecting', 'pipeline']);
  const nextActionIdx = blocks.findIndex((b, i) => i >= Math.max(0, currentBlockIndex) && ACTION_TYPES.has(b.type));
  const nextAction = nextActionIdx >= 0 ? blocks[nextActionIdx] : null;

  // Total prepped accounts across all completed prep blocks
  const PREP_TYPES = new Set(['prep', 'research', 'build']);
  const allPreppedIds = new Set<string>();
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!PREP_TYPES.has(b.type)) continue;
    if (i < currentBlockIndex || b.goals?.some((_, gi) => completedGoals.has(`${i}-${gi}`))) {
      b.linked_accounts?.forEach(a => allPreppedIds.add(a.id));
    }
  }

  // Accounts that were prepped but not yet in any past action block
  const workedIds = new Set<string>();
  for (let i = 0; i < Math.min(currentBlockIndex, blocks.length); i++) {
    if (ACTION_TYPES.has(blocks[i].type)) {
      blocks[i].linked_accounts?.forEach(a => workedIds.add(a.id));
    }
  }
  const carryForward = [...allPreppedIds].filter(id => !workedIds.has(id)).length;

  const nextLoop = loops[0] || null;

  return {
    roleplayStatus,
    roleplayStreakDays,
    roleplayGroundingSource,
    nextActionBlockLabel: nextAction ? (nextAction as any).label || 'Call Block' : null,
    nextActionBlockReady: nextLoop?.actionReady ?? true,
    preparedAccountsWaiting: allPreppedIds.size,
    blockedReason: nextLoop?.blockedReason ?? null,
    carryForwardCount: carryForward,
  };
}
