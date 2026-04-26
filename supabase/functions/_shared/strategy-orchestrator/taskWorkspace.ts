// ════════════════════════════════════════════════════════════════
// Task → Workspace resolver (Phase W3)
//
// Maps a Strategy task_type to the canonical W1 WorkspaceKey so the
// task pipeline (`runTask.ts`) inherits the same universal-library
// retrieval posture as the chat surface. This module is intentionally
// tiny and pure — no DB, no I/O, no prompt composition.
//
// Mapping (W3-correct, library is universal context):
//   • discovery_prep        → artifacts      (libraryUse: primary)
//   • account_brief         → deep_research  (libraryUse: primary)
//   • account_research*     → deep_research  (libraryUse: primary)
//   • ninety_day_plan       → projects       (libraryUse: primary)
//   • <unknown / fallback>  → work           (libraryUse: relevant)
//
// All resolutions go through the W3 normalizer so unknown / aliased
// keys deterministically fall back to `work`. Telemetry consumers
// see the canonical key, the contract version, and any fallback note.
// ════════════════════════════════════════════════════════════════

import {
  normalizeWorkspaceKey,
  type NormalizeWorkspaceKeyResult,
} from "../strategy-core/workspaceContracts.ts";
import type { WorkspaceKey } from "../strategy-core/workspaceContractTypes.ts";

/**
 * Best-effort mapping from task_type → workspace key. Unknown task
 * types intentionally return `null` so the caller can fall through
 * to the explicit `work` fallback (which is normalized through the
 * W3 normalizer to keep all resolutions on the same code path).
 */
function rawWorkspaceForTask(taskType: string): WorkspaceKey | null {
  const t = (taskType || "").toLowerCase().trim();
  if (!t) return null;

  // Artifact-shaped tasks (one-shot deliverables grounded in the
  // user's library + research). Discovery Prep is the canonical
  // example and stays artifact-first.
  if (t === "discovery_prep") return "artifacts";

  // Research-shaped tasks: account-centric briefs, deep dives, etc.
  // Anything starting with "account_" that is not a pure artifact
  // belongs in deep_research so the library is treated as primary.
  if (t === "account_brief") return "deep_research";
  if (t.startsWith("account_research")) return "deep_research";
  if (t === "deep_research") return "deep_research";

  // Multi-step planning / project-shaped work.
  if (t === "ninety_day_plan") return "projects";
  if (t.startsWith("project_")) return "projects";

  return null;
}

export interface TaskWorkspaceResolution {
  /** Canonical workspace key chosen for this task. Always valid. */
  workspace: WorkspaceKey;
  /** Telemetry only — did we coerce the requested key? */
  normalization: NormalizeWorkspaceKeyResult;
  /** The raw task_type the caller passed in (for telemetry). */
  taskType: string;
  /**
   * Whether the mapping fell through to the `work` fallback because
   * the task_type was unknown to this resolver. Distinct from the
   * normalizer's own fallback signal.
   */
  taskFellBack: boolean;
}

/**
 * Resolve a Strategy task_type to its canonical WorkspaceKey via the
 * W3 normalizer. Pure function — safe to call from anywhere.
 *
 * `null` / undefined / unknown task types resolve to `work`, which
 * carries `libraryUse: relevant` so the library is still consulted
 * when there is any retrieval signal (W3 universal-library principle).
 */
export function resolveTaskWorkspace(
  taskType: string | null | undefined,
): TaskWorkspaceResolution {
  const raw = rawWorkspaceForTask(taskType ?? "");
  const taskFellBack = raw === null;
  // Always normalize through the W3 normalizer so the contract
  // resolution / telemetry paths are byte-identical to the chat
  // surface. `work` is the documented fallback.
  const normalization = normalizeWorkspaceKey(raw ?? "work");
  return {
    workspace: normalization.key,
    normalization,
    taskType: taskType ?? "",
    taskFellBack,
  };
}
