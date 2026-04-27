/**
 * buildResolvedSopsPayload — Phase 3 wrapper.
 *
 * The original Phase 2 helper has been consolidated into the unified
 * resolver `buildStrategySopPayloads`. This module is kept as a thin
 * wrapper so existing imports (and any third-party tests) keep working
 * with no behavior change. All routing/validation logic lives in
 * `buildStrategySopPayloads.ts`.
 */
import {
  buildStrategySopPayloads,
  type ResolvedSopsPayload,
} from './buildStrategySopPayloads';

export type { ResolvedSopsPayload };

export function buildResolvedSopsPayload(input: {
  workspace?: string | null;
  taskType?: string | null;
}): ResolvedSopsPayload | null {
  return buildStrategySopPayloads(input).resolvedSops;
}
