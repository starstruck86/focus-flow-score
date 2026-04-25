/**
 * buildWorkspaceSopPayload — Phase 3A (advisory injection).
 *
 * Phase 2 sent only metadata (`appliedSopIds`, counts) so the server could
 * log resolver behavior. Phase 3A is the first step that actually nudges
 * model output: when a *workspace* SOP is enabled, we ship its raw
 * instructions to the server so it can append them as an advisory block
 * BEFORE the global instructions block and AFTER the strict mode-lock /
 * V2 / synthesis prompts.
 *
 * Phase 3A contract — matches the engineering spec exactly:
 *   • Only fires for workspace SOPs (never global, never task).
 *   • Only fires when `mode === 'workspace'` — task pipelines (Discovery
 *     Prep) are intentionally untouched in this phase.
 *   • Only fires when the workspace SOP is enabled AND has non-empty
 *     instructions.
 *   • The server treats this as advisory only; it does NOT override
 *     strict-mode formatting, library citation rules, or the synthesis
 *     contract.
 *
 * Returns `null` when nothing should be injected so the server's
 * "absence == no-op" behavior stays clean.
 */
import { resolveStrategySops } from './resolveStrategySops';
import type { StrategyTaskSopKey, StrategyWorkspaceSopKey } from './strategyConfig';

const MAX_RAW_INSTRUCTIONS = 6_000; // Hard cap so an oversized SOP can't blow the prompt.

export interface WorkspaceSopPayload {
  /** Stable id, e.g. `workspace:brainstorm`. Mirrors `appliedSopIds`. */
  sopId: string;
  /** Workspace key the SOP was resolved for. */
  workspace: StrategyWorkspaceSopKey;
  /** Display name for logs / future UI surfacing. */
  name: string;
  /** Raw advisory text — capped at MAX_RAW_INSTRUCTIONS chars. */
  rawInstructions: string;
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

export function buildWorkspaceSopPayload(input: {
  workspace?: string | null;
  taskType?: string | null;
}): WorkspaceSopPayload | null {
  const workspace = asWorkspaceKey(input.workspace);
  const taskType = asTaskKey(input.taskType);

  // Phase 3A guard: never inject during a task pipeline. Task SOPs are a
  // later phase, and Discovery Prep specifically must be untouched here.
  if (taskType) return null;
  if (!workspace) return null;

  let result;
  try {
    result = resolveStrategySops({ workspace, taskType });
  } catch {
    return null;
  }

  // Only act on workspace mode — `freeform` (work / no workspace) intentionally
  // ships only the global SOP via the existing global-instructions path.
  if (result.mode !== 'workspace') return null;
  if (!result.workspaceSop || !result.workspaceSop.enabled) return null;

  const raw = (result.workspaceSop.rawInstructions ?? '').trim();
  if (!raw) return null;

  const sopId = `workspace:${workspace}`;
  return {
    sopId,
    workspace,
    name: result.workspaceSop.name || sopId,
    rawInstructions: raw.slice(0, MAX_RAW_INSTRUCTIONS),
  };
}
