/**
 * buildGlobalSopPayload — Phase 3 wrapper.
 *
 * Global SOP routing now lives in the unified resolver
 * `buildStrategySopPayloads`. This wrapper preserves the original
 * function signature so existing callers keep working unchanged.
 */
import {
  buildStrategySopPayloads,
  type GlobalSopPayload,
} from './buildStrategySopPayloads';

export type { GlobalSopPayload };

export function buildGlobalSopPayload(): GlobalSopPayload | null {
  return buildStrategySopPayloads({ taskType: null }).globalSop;
}
