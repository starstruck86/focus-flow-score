/**
 * resolveStrategySops — Phase W2 (resolver upgrade).
 *
 * What's new in W2 (resolver-only):
 *   • Every Strategy run now resolves the typed WorkspaceContract from
 *     the W1 registry and attaches it to the resolved payload.
 *   • Unknown / missing / custom workspaces normalize to `work` so
 *     downstream code never has to handle a missing contract.
 *   • Existing raw/advisory `workspaceSop` (StrategySopContract) remains
 *     available as a derived/back-compat view — Phase 3A's chat path is
 *     untouched.
 *   • No retrieval, prompt, validation, or UI behavior changes here.
 *
 * Layering rules (unchanged):
 *   • Global SOP    → applies to every turn when enabled
 *   • Workspace SOP → applies when the user is currently in a workspace
 *   • Task SOP      → applies when a task pipeline runs
 *
 * Free-form chat is the special case where there is no workspace selected
 * (or `workspace === 'work'`). In that case only the Global SOP applies
 * for the legacy raw `workspaceSop` field — but the typed `workspaceContract`
 * is ALWAYS resolved (defaulting to the Work contract) so the future
 * composer can read formatting/retrieval rules unconditionally.
 */
import {
  getStrategyConfig,
  type StrategySopContract,
  type StrategyTaskSopKey,
  type StrategyWorkspaceSopKey,
} from './strategyConfig';
import {
  getWorkspaceContract,
  normalizeWorkspaceKey,
  type NormalizeWorkspaceKeyResult,
} from './workspaceContracts';
import type {
  OutputFormattingHints,
  RetrievalRules,
  WorkspaceContract,
  WorkspaceKey,
} from './workspaceContractTypes';

export type StrategyChatMode = 'freeform' | 'workspace' | 'task';

export interface ResolveStrategySopsInput {
  /** Currently active workspace surface (or null/undefined for plain chat). */
  workspace?: StrategyWorkspaceSopKey | string | null;
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

/**
 * Structured note attached when a workspace key was normalized away
 * from the input. Surfaced for telemetry; never throws.
 */
export interface ResolverNote {
  kind: 'workspace_key_fallback' | 'workspace_key_aliased';
  input: string | null;
  resolvedTo: WorkspaceKey;
  detail?: string;
}

export interface ResolveStrategySopsResult {
  // ─── Legacy / back-compat fields (Phase 3A consumers depend on these) ─
  globalSop: StrategySopContract | null;
  /** Raw advisory text contract from `strategyConfig.sopContracts.workspaces`. */
  workspaceSop: StrategySopContract | null;
  taskSop: StrategySopContract | null;
  /**
   * Stable ids of contracts that were applied, in stack order
   * (e.g. ['global', 'workspace:brainstorm', 'task:discovery_prep']).
   */
  appliedSopIds: string[];
  /** Count of legacy SOP contracts applied (global + workspace + task). */
  enabledCount: number;
  mode: StrategyChatMode;

  // ─── W2 additions (always present) ────────────────────────────────────
  /** Resolved canonical workspace key. Always a valid WorkspaceKey. */
  workspace: WorkspaceKey;
  /** Full typed W1 contract for `workspace`. Always non-null. */
  workspaceContract: WorkspaceContract;
  /** Convenience: `workspaceContract.version`. */
  contractVersion: string;
  /** Convenience: `workspaceContract.retrievalRules`. */
  retrievalRules: RetrievalRules;
  /** Stable gate ids declared by the contract. Used by W6 / dev panel. */
  qualityGateIds: string[];
  /** Convenience: `workspaceContract.outputFormattingHints`. */
  outputFormattingHints: OutputFormattingHints;
  /** Optional resolver notes for telemetry (e.g. fallback reasons). */
  notes: ResolverNote[];
}

function isEnabled(c?: StrategySopContract | null): c is StrategySopContract {
  return !!c && c.enabled === true;
}

function deriveMode(
  input: ResolveStrategySopsInput,
  normalized: NormalizeWorkspaceKeyResult,
): StrategyChatMode {
  if (input.mode) return input.mode;
  if (input.taskType) return 'task';
  // Only treat as workspace mode when the resolved key is a real workspace
  // and not the implicit `work` lane (which is the free-form rail).
  if (normalized.source !== 'fallback' && normalized.key !== 'work') {
    return 'workspace';
  }
  return 'freeform';
}

function buildNote(n: NormalizeWorkspaceKeyResult): ResolverNote | null {
  if (n.source === 'canonical') return null;
  if (n.source === 'alias') {
    return {
      kind: 'workspace_key_aliased',
      input: n.input,
      resolvedTo: n.key,
      detail: n.note,
    };
  }
  return {
    kind: 'workspace_key_fallback',
    input: n.input,
    resolvedTo: n.key,
    detail: n.note,
  };
}

/**
 * Pick the legacy raw workspace SOP contract for the given workspace key,
 * applying the same gating rules used in Phase 3A:
 *   • only when engine is on
 *   • only when mode is 'workspace' or (Discovery Prep) 'task'
 *   • only when the underlying contract is `enabled`
 *
 * `originalWorkspaceProvided` mirrors the pre-W2 behavior: the
 * Discovery-Prep → artifacts narrow rule fires when the caller either
 * supplied no workspace at all or explicitly supplied 'artifacts'. The
 * normalized fallback to 'work' must NOT trigger that rule, so we look
 * at the raw input — not the normalized key.
 */
function pickLegacyWorkspaceSop(
  cfg: ReturnType<typeof getStrategyConfig>,
  mode: StrategyChatMode,
  workspace: WorkspaceKey,
  taskType: StrategyTaskSopKey | null | undefined,
  originalWorkspaceProvided: string | null,
): StrategySopContract | null {
  if (!cfg.enabled) return null;

  // Standard workspace mode lookup — only when the caller actually selected
  // a workspace. The fallback 'work' alone should not pull in a contract.
  if (mode === 'workspace' || mode === 'task') {
    const ws =
      cfg.sopContracts.workspaces[workspace as StrategyWorkspaceSopKey];
    if (isEnabled(ws)) return ws;
  }

  // Discovery Prep narrow rule: stack the artifacts workspace SOP even when
  // no workspace was explicitly provided.
  if (
    taskType === 'discovery_prep' &&
    (!originalWorkspaceProvided || originalWorkspaceProvided === 'artifacts')
  ) {
    const artifacts = cfg.sopContracts.workspaces.artifacts;
    if (isEnabled(artifacts)) return artifacts;
  }
  return null;
}

export function resolveStrategySops(
  input: ResolveStrategySopsInput,
): ResolveStrategySopsResult {
  const cfg = getStrategyConfig();

  // ── Step 1: normalize the workspace key (always succeeds) ─────────────
  const normalized = normalizeWorkspaceKey(input.workspace ?? null);
  const workspace = normalized.key;
  const note = buildNote(normalized);
  const notes: ResolverNote[] = note ? [note] : [];

  // Side-channel warning so unknown keys don't go silent in dev/CI.
  if (normalized.source === 'fallback' && normalized.input) {
    // eslint-disable-next-line no-console
    console.warn(
      `[resolveStrategySops] unknown workspace "${normalized.input}" → fallback to "work" (${normalized.note ?? 'unknown'})`,
    );
  }

  // ── Step 2: derive mode (using the normalized key, not the raw input) ─
  const mode = deriveMode(input, normalized);

  // ── Step 3: legacy SOP resolution (back-compat) ───────────────────────
  const globalCandidate = cfg.enabled ? cfg.sopContracts.global : undefined;
  const globalSop = isEnabled(globalCandidate) ? globalCandidate : null;

  const workspaceSop = pickLegacyWorkspaceSop(
    cfg,
    mode,
    workspace,
    input.taskType ?? null,
  );

  let taskSop: StrategySopContract | null = null;
  if (cfg.enabled && input.taskType) {
    const t = cfg.sopContracts.tasks[input.taskType];
    if (isEnabled(t)) taskSop = t;
  }

  const appliedSopIds: string[] = [];
  if (globalSop) appliedSopIds.push('global');
  if (workspaceSop) {
    // Mirror Phase 3A behaviour: id reflects either the active workspace or
    // the implicit Discovery-Prep → artifacts stack.
    const wsLabel =
      workspace ?? (input.taskType === 'discovery_prep' ? 'artifacts' : 'unknown');
    appliedSopIds.push(`workspace:${wsLabel}`);
  }
  if (taskSop) appliedSopIds.push(`task:${input.taskType}`);

  // ── Step 4: typed workspace contract (always non-null) ────────────────
  const workspaceContract = getWorkspaceContract(workspace);

  return {
    // legacy
    globalSop,
    workspaceSop,
    taskSop,
    appliedSopIds,
    enabledCount: appliedSopIds.length,
    mode,
    // W2 additions
    workspace,
    workspaceContract,
    contractVersion: workspaceContract.version,
    retrievalRules: workspaceContract.retrievalRules,
    qualityGateIds: workspaceContract.qualityGates.map((g) => g.id),
    outputFormattingHints: workspaceContract.outputFormattingHints,
    notes,
  };
}
