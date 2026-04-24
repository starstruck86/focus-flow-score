/**
 * Phase 2 — Build a lightweight Global Instructions payload for Strategy chat.
 *
 * Reads the user's StrategyGlobalInstructionsConfig and serializes ONLY the
 * lightweight pieces (globalInstructions, outputPreferences, libraryBehavior)
 * that should influence normal chat. Discovery Prep SOP is intentionally
 * excluded in Phase 2 — it has its own routing in a later phase.
 *
 * Returns null when the engine is disabled OR the config produces no
 * meaningful guidance, so the server can short-circuit and emit zero
 * additional system prompt bytes (preserving the exact baseline behavior).
 */
import {
  getStrategyConfig,
  type StrategyGlobalInstructionsConfig,
  type OutputPreferences,
  type LibraryBehavior,
} from './strategyConfig';

export interface GlobalInstructionsPayload {
  /** Free-form user instructions (trimmed). Empty when none provided. */
  globalInstructions: string;
  outputPreferences: OutputPreferences;
  libraryBehavior: LibraryBehavior;
  strictMode: boolean;
  selfCorrectOnce: boolean;
}

/**
 * Returns a payload ONLY when the engine is enabled. Caller must treat
 * `null` as "do not include any global-instructions block in the request".
 */
export function buildGlobalInstructionsPayload(
  cfg: StrategyGlobalInstructionsConfig = getStrategyConfig(),
): GlobalInstructionsPayload | null {
  if (!cfg.enabled) return null;
  return {
    globalInstructions: (cfg.globalInstructions || '').trim(),
    outputPreferences: cfg.outputPreferences,
    libraryBehavior: cfg.libraryBehavior,
    strictMode: !!cfg.strictMode,
    selfCorrectOnce: !!cfg.selfCorrectOnce,
  };
}
