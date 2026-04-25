/**
 * resolveStrategySops — pure SOP resolver for the Universal Strategy SOP Engine.
 *
 * Phase 1: this resolver is NOT consumed by any prompt-builder. It is a
 * deterministic accessor that returns which SOPs apply to a given Strategy
 * call site (free-form chat, a workspace, a task). Future phases will use the
 * resolver from chat + orchestrator to compose system prompts.
 *
 * Layering rules (top wins on conflict, but Phase 1 only stacks them):
 *   • Global SOP   → applies to every turn when enabled
 *   • Workspace SOP → applies when the user is currently in that workspace
 *   • Task SOP     → applies when a task pipeline (Discovery Prep, etc.) runs
 *
 * Free-form chat is the special case where there is no workspace selected
 * (or `workspace === 'work'`). In that case only the Global SOP applies.
 *
 * The resolver always returns the *enabled* contracts only. A disabled
 * contract is treated as if it didn't exist.
 */
import {
  getStrategyConfig,
  type StrategySopContract,
  type StrategyTaskSopKey,
  type StrategyWorkspaceSopKey,
} from './strategyConfig';

export type StrategyChatMode = 'freeform' | 'workspace' | 'task';

export interface ResolveStrategySopsInput {
  /** Currently active workspace surface (or null/undefined for plain chat). */
  workspace?: StrategyWorkspaceSopKey | null;
  /** Task type when running a task pipeline (Discovery Prep, etc.). */
  taskType?: StrategyTaskSopKey | null;
  /**
   * Optional explicit mode. When omitted the resolver derives it from inputs:
   *   taskType → 'task', workspace → 'workspace', otherwise 'freeform'.
   * Free-form chat ignores workspace SOPs even if a workspace is open — the
   * 'work' rail counts as free-form.
   */
  mode?: StrategyChatMode;
}

export interface ResolveStrategySopsResult {
  globalSop: StrategySopContract | null;
  workspaceSop: StrategySopContract | null;
  taskSop: StrategySopContract | null;
  /**
   * Stable ids of contracts that were applied, in stack order
   * (e.g. ['global', 'workspace:brainstorm', 'task:discovery_prep']).
   */
  appliedSopIds: string[];
  enabledCount: number;
  mode: StrategyChatMode;
}

function isEnabled(c?: StrategySopContract | null): c is StrategySopContract {
  return !!c && c.enabled === true;
}

function deriveMode(input: ResolveStrategySopsInput): StrategyChatMode {
  if (input.mode) return input.mode;
  if (input.taskType) return 'task';
  if (input.workspace && input.workspace !== 'work') return 'workspace';
  return 'freeform';
}

export function resolveStrategySops(
  input: ResolveStrategySopsInput,
): ResolveStrategySopsResult {
  const cfg = getStrategyConfig();
  const mode = deriveMode(input);

  // Global SOP applies to every mode (and only when the engine is on).
  const globalCandidate = cfg.enabled ? cfg.sopContracts.global : undefined;
  const globalSop = isEnabled(globalCandidate) ? globalCandidate : null;

  // Workspace SOP — only when a real workspace is selected and engine is on.
  let workspaceSop: StrategySopContract | null = null;
  if (cfg.enabled && (mode === 'workspace' || mode === 'task') && input.workspace) {
    const ws = cfg.sopContracts.workspaces[input.workspace];
    if (isEnabled(ws)) workspaceSop = ws;
  }

  // For Discovery Prep specifically, the artifacts workspace SOP also stacks
  // (the spec describes Discovery Prep as: global + artifacts + task). This
  // is a deliberate, narrow rule keyed off the task type, not a general
  // workspace inference.
  if (
    cfg.enabled &&
    input.taskType === 'discovery_prep' &&
    (!input.workspace || input.workspace === 'artifacts')
  ) {
    const artifacts = cfg.sopContracts.workspaces.artifacts;
    if (isEnabled(artifacts)) workspaceSop = artifacts;
  }

  // Task SOP — only when a task type is supplied.
  let taskSop: StrategySopContract | null = null;
  if (cfg.enabled && input.taskType) {
    const t = cfg.sopContracts.tasks[input.taskType];
    if (isEnabled(t)) taskSop = t;
  }

  const appliedSopIds: string[] = [];
  if (globalSop) appliedSopIds.push('global');
  if (workspaceSop) {
    appliedSopIds.push(`workspace:${input.workspace ?? (input.taskType === 'discovery_prep' ? 'artifacts' : 'unknown')}`);
  }
  if (taskSop) appliedSopIds.push(`task:${input.taskType}`);

  return {
    globalSop,
    workspaceSop,
    taskSop,
    appliedSopIds,
    enabledCount: appliedSopIds.length,
    mode,
  };
}
