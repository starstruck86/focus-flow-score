/**
 * buildResolvedSopsPayload — Phase 2 (resolver plumbing only).
 *
 * Runs `resolveStrategySops()` on the client and returns a lightweight,
 * server-safe metadata payload. The server logs this payload under
 * `[strategy-sop] resolved {...}` and otherwise ignores it.
 *
 * Phase 2 contract:
 *   • NO SOP text is sent to the server.
 *   • NO model behavior changes.
 *   • Only ids + counts + mode flow over the wire so we can prove the
 *     resolver fires correctly end-to-end.
 *
 * Returns `null` when nothing applies (engine off or no enabled SOPs) so
 * the server's "absence == no-op" semantics stay clean.
 */
import { resolveStrategySops, type StrategyChatMode } from './resolveStrategySops';
import type { StrategyTaskSopKey, StrategyWorkspaceSopKey } from './strategyConfig';

export interface ResolvedSopsPayload {
  workspace: StrategyWorkspaceSopKey | null;
  taskType: StrategyTaskSopKey | null;
  mode: StrategyChatMode;
  appliedSopIds: string[];
  enabledCount: number;
}

const WORKSPACE_KEYS = new Set<StrategyWorkspaceSopKey>([
  'brainstorm', 'deep_research', 'refine', 'library', 'artifacts', 'projects', 'work',
]);

const TASK_KEYS = new Set<StrategyTaskSopKey>([
  'discovery_prep', 'deal_review', 'account_research', 'recap_email', 'roi_model',
]);

function asWorkspaceKey(v: unknown): StrategyWorkspaceSopKey | null {
  return typeof v === 'string' && WORKSPACE_KEYS.has(v as StrategyWorkspaceSopKey)
    ? (v as StrategyWorkspaceSopKey)
    : null;
}

function asTaskKey(v: unknown): StrategyTaskSopKey | null {
  return typeof v === 'string' && TASK_KEYS.has(v as StrategyTaskSopKey)
    ? (v as StrategyTaskSopKey)
    : null;
}

export function buildResolvedSopsPayload(input: {
  workspace?: string | null;
  taskType?: string | null;
}): ResolvedSopsPayload | null {
  const workspace = asWorkspaceKey(input.workspace);
  const taskType = asTaskKey(input.taskType);

  let result;
  try {
    result = resolveStrategySops({ workspace, taskType });
  } catch {
    return null;
  }

  // Nothing enabled → omit from payload entirely so the server logs "none".
  if (result.enabledCount === 0) return null;

  return {
    workspace,
    taskType,
    mode: result.mode,
    appliedSopIds: result.appliedSopIds,
    enabledCount: result.enabledCount,
  };
}
