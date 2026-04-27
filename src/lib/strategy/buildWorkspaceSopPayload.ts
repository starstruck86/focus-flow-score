/**
 * buildWorkspaceSopPayload — Phase 3 wrapper.
 *
 * Workspace SOP routing now lives in the unified resolver
 * `buildStrategySopPayloads`. This wrapper preserves the original
 * function signature so existing callers keep working unchanged.
 */
import {
  buildStrategySopPayloads,
  type WorkspaceSopPayload,
} from './buildStrategySopPayloads';

export type { WorkspaceSopPayload };

export function buildWorkspaceSopPayload(input: {
  workspace?: string | null;
  taskType?: string | null;
}): WorkspaceSopPayload | null {
  return buildStrategySopPayloads(input).workspaceSop;
}
