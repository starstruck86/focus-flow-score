/**
 * Loop-Native Scheduler
 *
 * Canonical loop structure for prep → action execution.
 * Replaces heuristic readiness with explicit loop state.
 * Feature-flagged via ENABLE_LOOP_NATIVE_SCHEDULER.
 */

// ── Data Model ─────────────────────────────────────────────

export type LoopType = 'new_logo' | 'follow_up' | 'meeting_prep';
export type LoopStatus = 'pending' | 'prep_ready' | 'action_ready' | 'in_progress' | 'complete' | 'carry_forward';

export interface ExecutionLoop {
  loopId: string;
  date: string;
  loopType: LoopType;
  prepBlockId: string | null;
  actionBlockId: string | null;
  prepTargetCount: number;
  accountsAssigned: LoopAccount[];
  accountsPrepared: LoopAccount[];
  accountsWorked: LoopAccount[];
  status: LoopStatus;
  carryForwardToNextLoop: boolean;
  blockedReason: string | null;
}

export interface LoopAccount {
  id: string;
  name: string;
  prepCompletedAt?: string;
  workedAt?: string;
  carryForward?: boolean;
}

// ── Block linkage ──────────────────────────────────────────

export interface LoopLinkedBlock {
  blockIndex: number;
  start_time: string;
  end_time: string;
  label: string;
  type: string;
  loopId: string;
  linkedPrepBlockId?: string;
  linkedActionBlockId?: string;
  assignedAccountIds: string[];
  preparedAccountIds: string[];
  workstream?: string;
  goals?: string[];
  linked_accounts?: { id: string; name: string }[];
}

// ── Generation ─────────────────────────────────────────────

interface PlanBlock {
  start_time: string;
  end_time: string;
  type: string;
  label?: string;
  workstream?: string;
  goals?: string[];
  linked_accounts?: { id: string; name: string }[];
}

const PREP_TYPES = new Set(['prep', 'research', 'build']);
const ACTION_TYPES = new Set(['prospecting', 'pipeline']);

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

function blockDuration(b: PlanBlock): number {
  return toMinutes(b.end_time) - toMinutes(b.start_time);
}

/**
 * Generate execution loops from a daily plan's block list.
 * Pairs consecutive prep → action blocks into explicit loops.
 * Carry-forward accounts from previous day can be injected.
 */
export function generateLoopsFromBlocks(
  blocks: PlanBlock[],
  date: string,
  carryForwardAccounts: LoopAccount[] = [],
): ExecutionLoop[] {
  const loops: ExecutionLoop[] = [];
  let loopIndex = 0;

  // Identify prep and action blocks
  const indexedBlocks = blocks.map((b, i) => ({ ...b, idx: i }));
  const prepBlocks = indexedBlocks.filter(b => PREP_TYPES.has(b.type));
  const actionBlocks = indexedBlocks.filter(b => ACTION_TYPES.has(b.type));

  // Pair preps with their nearest subsequent action
  const usedActions = new Set<number>();

  for (const prep of prepBlocks) {
    // Find the nearest action block after this prep
    const nextAction = actionBlocks.find(
      a => a.idx > prep.idx && !usedActions.has(a.idx)
    );

    const loopId = `loop-${date}-${loopIndex++}`;
    const assignedAccounts: LoopAccount[] = (prep.linked_accounts || []).map(a => ({
      id: a.id,
      name: a.name,
    }));

    const loop: ExecutionLoop = {
      loopId,
      date,
      loopType: inferLoopType(prep, nextAction),
      prepBlockId: `block-${prep.idx}`,
      actionBlockId: nextAction ? `block-${nextAction.idx}` : null,
      prepTargetCount: Math.max(assignedAccounts.length, estimatePrepTarget(prep)),
      accountsAssigned: assignedAccounts,
      accountsPrepared: [],
      accountsWorked: [],
      status: 'pending',
      carryForwardToNextLoop: false,
      blockedReason: null,
    };

    if (nextAction) usedActions.add(nextAction.idx);
    loops.push(loop);
  }

  // Handle orphan action blocks (no matching prep) — inject carry-forward
  for (const action of actionBlocks) {
    if (usedActions.has(action.idx)) continue;
    const loopId = `loop-${date}-${loopIndex++}`;
    const loop: ExecutionLoop = {
      loopId,
      date,
      loopType: inferLoopType(null, action),
      prepBlockId: null,
      actionBlockId: `block-${action.idx}`,
      prepTargetCount: 0,
      accountsAssigned: carryForwardAccounts.length > 0
        ? carryForwardAccounts.map(a => ({ ...a, carryForward: true }))
        : (action.linked_accounts || []).map(a => ({ id: a.id, name: a.name })),
      accountsPrepared: carryForwardAccounts.map(a => ({ ...a, carryForward: true })),
      accountsWorked: [],
      status: carryForwardAccounts.length > 0 ? 'action_ready' : 'pending',
      carryForwardToNextLoop: false,
      blockedReason: carryForwardAccounts.length === 0 && !(action.linked_accounts?.length)
        ? 'No prepared accounts — prep needed'
        : null,
    };
    loops.push(loop);
  }

  return loops;
}

function inferLoopType(prep: PlanBlock | null, action: PlanBlock | null): LoopType {
  const ws = prep?.workstream || action?.workstream;
  if (ws === 'renewal') return 'follow_up';
  const label = (prep?.label || action?.label || '').toLowerCase();
  if (label.includes('follow') || label.includes('pipeline')) return 'follow_up';
  if (label.includes('meeting') || label.includes('prep')) return 'meeting_prep';
  return 'new_logo';
}

function estimatePrepTarget(block: PlanBlock): number {
  const mins = blockDuration(block);
  // ~10 min per account prep
  return Math.max(2, Math.min(5, Math.floor(mins / 10)));
}

// ── Loop State Management ──────────────────────────────────

const LOOP_STATE_KEY = 'execution-loops';

function loopStorageKey(date: string): string {
  return `${LOOP_STATE_KEY}-${date}`;
}

export function loadLoops(date: string): ExecutionLoop[] {
  try {
    const raw = localStorage.getItem(loopStorageKey(date));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Corruption guard: must be array of objects with loopId
    if (!Array.isArray(parsed)) { localStorage.removeItem(loopStorageKey(date)); return []; }
    if (parsed.length > 0 && !parsed[0].loopId) { localStorage.removeItem(loopStorageKey(date)); return []; }
    return parsed;
  } catch { localStorage.removeItem(loopStorageKey(date)); return []; }
}

export function saveLoops(date: string, loops: ExecutionLoop[]): void {
  localStorage.setItem(loopStorageKey(date), JSON.stringify(loops));
}

// ── Loop Transitions ───────────────────────────────────────

export function markPrepComplete(
  loops: ExecutionLoop[],
  loopId: string,
  preparedAccounts: LoopAccount[],
): ExecutionLoop[] {
  return loops.map(l => {
    if (l.loopId !== loopId) return l;
    return {
      ...l,
      accountsPrepared: preparedAccounts,
      status: l.actionBlockId ? 'action_ready' : 'complete',
      blockedReason: null,
    };
  });
}

export function markActionComplete(
  loops: ExecutionLoop[],
  loopId: string,
  workedAccounts: LoopAccount[],
): ExecutionLoop[] {
  return loops.map(l => {
    if (l.loopId !== loopId) return l;
    const unworked = l.accountsPrepared.filter(
      a => !workedAccounts.some(w => w.id === a.id)
    );
    return {
      ...l,
      accountsWorked: workedAccounts,
      status: unworked.length > 0 ? 'carry_forward' : 'complete',
      carryForwardToNextLoop: unworked.length > 0,
    };
  });
}

export function getCarryForwardAccounts(loops: ExecutionLoop[]): LoopAccount[] {
  const carried: LoopAccount[] = [];
  for (const l of loops) {
    if (l.status === 'carry_forward' || l.carryForwardToNextLoop) {
      const unworked = l.accountsPrepared.filter(
        a => !l.accountsWorked.some(w => w.id === a.id)
      );
      carried.push(...unworked.map(a => ({ ...a, carryForward: true })));
    }
  }
  return carried;
}

// ── Loop Readiness (replaces heuristic) ────────────────────

export interface LoopReadinessState {
  currentLoop: ExecutionLoop | null;
  nextLoop: ExecutionLoop | null;
  totalPrepared: number;
  totalWorked: number;
  carryForwardCount: number;
  isNextActionReady: boolean;
  blockedReason: string | null;
}

export function computeLoopReadinessFromLoops(loops: ExecutionLoop[]): LoopReadinessState {
  const pending = loops.filter(l => l.status !== 'complete');
  const current = pending.find(l => l.status === 'in_progress') || pending[0] || null;
  const next = current ? pending.find(l => l.loopId !== current.loopId) || null : null;

  const totalPrepared = loops.reduce((s, l) => s + l.accountsPrepared.length, 0);
  const totalWorked = loops.reduce((s, l) => s + l.accountsWorked.length, 0);
  const carryForward = getCarryForwardAccounts(loops);

  const nextActionLoop = pending.find(l => l.actionBlockId && l.status !== 'complete');
  const isNextActionReady = nextActionLoop
    ? nextActionLoop.status === 'action_ready' || nextActionLoop.accountsPrepared.length > 0
    : true;

  return {
    currentLoop: current,
    nextLoop: next,
    totalPrepared,
    totalWorked,
    carryForwardCount: carryForward.length,
    isNextActionReady,
    blockedReason: nextActionLoop?.blockedReason || null,
  };
}
