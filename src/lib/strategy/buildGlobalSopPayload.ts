/**
 * buildGlobalSopPayload — Phase 2 (Global SOP advisory injection in chat).
 *
 * Phase 1 made Global SOP storage + settings UI accurate. Phase 2 is the
 * first step that actually nudges chat output: when the engine is on AND
 * the global SOP contract is enabled with non-empty raw instructions, we
 * ship them to `strategy-chat` so the server can append an advisory block
 * AFTER the core/V1/V2/synthesis preamble and BEFORE the workspace SOP +
 * global instructions.
 *
 * Hard contract:
 *   • Returns `null` when nothing should be injected — server treats
 *     absence as "no behavior change".
 *   • Never task-pipeline aware: tasks (Discovery Prep, Account Research,
 *     etc.) ignore the Global SOP entirely and call sites for those flows
 *     must not send this payload.
 *   • Pure read of localStorage-backed `strategyConfig` — no network.
 */
import { getStrategyConfig } from './strategyConfig';

const MAX_RAW_INSTRUCTIONS = 8_000; // Hard cap so an oversized SOP can't blow the prompt.

export interface GlobalSopPayload {
  /** Stable id — always `"global"`. Mirrors `appliedSopIds`. */
  sopId: 'global';
  /** Display name for logs. */
  name: string;
  /** Raw advisory text — capped at MAX_RAW_INSTRUCTIONS chars. */
  rawInstructions: string;
}

export function buildGlobalSopPayload(): GlobalSopPayload | null {
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
    rawInstructions: raw.slice(0, MAX_RAW_INSTRUCTIONS),
  };
}
