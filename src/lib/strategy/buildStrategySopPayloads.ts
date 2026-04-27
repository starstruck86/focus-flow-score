/**
 * buildStrategySopPayloads — Phase 3 (Unified Strategy SOP Resolver).
 *
 * Single source of truth for every SOP payload that leaves the client. The
 * goal is *consolidation only*: this helper assembles the same payloads
 * the legacy helpers used to produce, but in one pass, so we can never
 * drift between them.
 *
 * Phase 3 contract — strict no-behavior-change:
 *   • Wire shapes match the existing helpers exactly:
 *       - resolvedSops    → identical to buildResolvedSopsPayload()
 *       - globalSop       → identical to buildGlobalSopPayload()
 *       - workspaceSop    → identical to buildWorkspaceSopPayload()
 *       - taskSop         → identical to buildAccountResearchSopAttachment()
 *                            (only when taskType === 'account_brief')
 *   • All exclusion rules are preserved:
 *       - globalSop excluded whenever a taskType is present.
 *       - workspaceSop excluded for `work` and for any taskType.
 *       - Discovery Prep task SOP path is intentionally NOT touched here —
 *         useTaskExecution still owns it (Phase 3 spec: "DO NOT change
 *         yet"). taskSop returns null for discovery_prep.
 *   • Returns `null` fields (never `undefined`) so the absence semantics
 *     stay deterministic for callers that conditionally serialize.
 *
 * This module is the *only* place that should grow new SOP routing logic
 * going forward. Legacy helpers (buildResolvedSopsPayload,
 * buildWorkspaceSopPayload, buildGlobalSopPayload,
 * buildAccountResearchSopAttachment) are now thin wrappers that delegate
 * here.
 */
import { resolveStrategySops, type StrategyChatMode } from './resolveStrategySops';
import { getStrategyConfig, type StrategyTaskSopKey, type StrategyWorkspaceSopKey } from './strategyConfig';

// ── Wire shapes (mirror existing helpers exactly) ─────────────────────────

export interface ResolvedSopsPayload {
  workspace: StrategyWorkspaceSopKey | null;
  taskType: StrategyTaskSopKey | null;
  mode: StrategyChatMode;
  appliedSopIds: string[];
  enabledCount: number;
}

export interface GlobalSopPayload {
  sopId: 'global';
  name: string;
  rawInstructions: string;
}

export interface WorkspaceSopPayload {
  sopId: string;
  workspace: StrategyWorkspaceSopKey;
  name: string;
  rawInstructions: string;
}

/** Server-shape mirror of `SopContractLike` — bullet arrays per heading. */
export interface AccountResearchSopAttachment {
  enabled: boolean;
  nonNegotiables: string[];
  requiredInputs: string[];
  requiredOutputs: string[];
  researchWorkflow: string[];
  mandatoryChecks: string[];
  metricsProtocol: string[];
  pageOneCockpitRules: string[];
  formattingRules: string[];
  buildOrder: string[];
  qaChecklist: string[];
}

export type TaskSopPayload = AccountResearchSopAttachment;

export interface StrategySopPayloads {
  resolvedSops: ResolvedSopsPayload | null;
  globalSop: GlobalSopPayload | null;
  workspaceSop: WorkspaceSopPayload | null;
  taskSop: TaskSopPayload | null;
}

// ── Hard caps & registries (mirror legacy helpers) ────────────────────────

const GLOBAL_MAX_RAW_INSTRUCTIONS = 8_000;
const WORKSPACE_MAX_RAW_INSTRUCTIONS = 6_000;

const WORKSPACE_KEYS = new Set<StrategyWorkspaceSopKey>([
  'brainstorm', 'deep_research', 'refine', 'library', 'artifacts', 'projects', 'work',
]);

const TASK_KEYS = new Set<StrategyTaskSopKey>([
  'discovery_prep', 'deal_review', 'account_research', 'recap_email', 'roi_model',
]);

/**
 * Minimum acceptance checks for Account Research. Mirrors
 * buildAccountResearchSopAttachment exactly so server-side
 * `[sop-output-check].required_outputs_missing` logs stay stable.
 */
const ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS: ReadonlyArray<string> = [
  'company overview',
  'key priorities',
  'risks or gaps',
  'recommended angles',
];

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

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
}

// ── Per-payload builders (private) ────────────────────────────────────────

function buildResolved(
  workspace: StrategyWorkspaceSopKey | null,
  taskType: StrategyTaskSopKey | null,
): ResolvedSopsPayload | null {
  let result;
  try {
    result = resolveStrategySops({ workspace, taskType });
  } catch {
    return null;
  }
  if (result.enabledCount === 0) return null;
  return {
    workspace,
    taskType,
    mode: result.mode,
    appliedSopIds: result.appliedSopIds,
    enabledCount: result.enabledCount,
  };
}

function buildGlobal(taskType: StrategyTaskSopKey | null): GlobalSopPayload | null {
  // Chat-only. Task pipelines never receive the Global SOP (Phase 2 contract).
  if (taskType) return null;

  let cfg;
  try {
    cfg = getStrategyConfig();
  } catch {
    return null;
  }
  if (!cfg?.enabled) return null;

  const global = cfg.sopContracts?.global;
  if (!global || !global.enabled) return null;

  const raw = (global.rawInstructions ?? '').trim();
  if (!raw) return null;

  return {
    sopId: 'global',
    name: global.name?.trim() || 'Global Strategy SOP',
    rawInstructions: raw.slice(0, GLOBAL_MAX_RAW_INSTRUCTIONS),
  };
}

function buildWorkspace(
  workspace: StrategyWorkspaceSopKey | null,
  taskType: StrategyTaskSopKey | null,
): WorkspaceSopPayload | null {
  // Phase 3A guard: never inject during a task pipeline.
  if (taskType) return null;
  if (!workspace) return null;

  let result;
  try {
    result = resolveStrategySops({ workspace, taskType });
  } catch {
    return null;
  }
  if (result.mode !== 'workspace') return null;
  if (!result.workspaceSop || !result.workspaceSop.enabled) return null;

  const raw = (result.workspaceSop.rawInstructions ?? '').trim();
  if (!raw) return null;

  const sopId = `workspace:${workspace}`;
  return {
    sopId,
    workspace,
    name: result.workspaceSop.name || sopId,
    rawInstructions: raw.slice(0, WORKSPACE_MAX_RAW_INSTRUCTIONS),
  };
}

function buildTask(taskType: StrategyTaskSopKey | null): TaskSopPayload | null {
  if (!taskType) return null;

  // Phase 3 only consolidates the Account Research path. Discovery Prep
  // remains owned by useTaskExecution per the spec ("DO NOT change yet").
  // Other task types have no client-side SOP attachment yet.
  if (taskType !== 'account_research') return null;

  let cfg;
  try {
    cfg = getStrategyConfig();
  } catch {
    return null;
  }
  if (!cfg?.enabled) return null;

  const contract = cfg.sopContracts?.tasks?.account_research;
  if (!contract || !contract.enabled) return null;

  const sections = (contract.parsedSections ?? {}) as Record<string, unknown>;

  const userRequiredOutputs = asStringArray(sections.requiredOutputs);
  const requiredOutputs = Array.from(
    new Set([...userRequiredOutputs, ...ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS]),
  );

  return {
    enabled: true,
    nonNegotiables: asStringArray(sections.nonNegotiables),
    requiredInputs: asStringArray(sections.requiredInputs),
    requiredOutputs,
    researchWorkflow: asStringArray(sections.researchWorkflow),
    mandatoryChecks: asStringArray(sections.mandatoryChecks),
    metricsProtocol: asStringArray(sections.metricsProtocol),
    pageOneCockpitRules: asStringArray(sections.pageOneCockpitRules),
    formattingRules: asStringArray(sections.formattingRules),
    buildOrder: asStringArray(sections.buildOrder),
    qaChecklist: asStringArray(sections.qaChecklist),
  };
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Build every SOP payload for a single chat or task call.
 *
 * Callers send only the payloads they need:
 *   • chat → resolvedSops + globalSop + workspaceSop
 *   • account_brief task → taskSop
 *   • discovery_prep task → none of the above (handled by useTaskExecution)
 *
 * Accepts loose input strings — anything outside the allowed registries
 * is treated as `null` so a malformed UI prop can never escape the
 * sanitizer.
 */
export function buildStrategySopPayloads(input: {
  workspace?: string | null;
  taskType?: string | null;
}): StrategySopPayloads {
  const workspace = asWorkspaceKey(input.workspace);
  const taskType = asTaskKey(input.taskType);

  return {
    resolvedSops: buildResolved(workspace, taskType),
    globalSop: buildGlobal(taskType),
    workspaceSop: buildWorkspace(workspace, taskType),
    taskSop: buildTask(taskType),
  };
}

/** Exposed for tests / debugging. Mirrors the legacy export name. */
export const ACCOUNT_RESEARCH_REQUIRED_CHECKS = ACCOUNT_RESEARCH_REQUIRED_OUTPUT_CHECKS;
