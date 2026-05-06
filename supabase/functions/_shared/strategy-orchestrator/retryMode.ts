// ════════════════════════════════════════════════════════════════
// deriveRetryMode — Adaptive retry strategy for task authoring.
//
// Inspects previous failure diagnostics and determines the most
// productive authoring strategy for the next attempt. Each mode
// progressively reduces the payload size to increase the probability
// of success under provider timeout/capacity constraints.
// ════════════════════════════════════════════════════════════════

export type RetryMode = "normal" | "chunked" | "low_token" | "rescue_only";

export interface RetryDiagnostics {
  /** How the previous attempt failed */
  failure_type: "timeout" | "gate_fail" | "authoring_error" | "unknown";
  /** Which provider(s) timed out */
  timed_out_providers?: string[];
  /** Which gate dimensions failed */
  failed_dimensions?: string[];
  /** Previous retry mode used */
  previous_mode?: RetryMode;
  /** How many attempts have been made so far */
  attempt_number: number;
}

/**
 * Derive the next retry mode based on previous failure diagnostics.
 * The sequence is deterministic and always escalates:
 *   attempt 1: normal (monolithic generation)
 *   attempt 2: chunked (section-by-section)
 *   attempt 3: low_token (chunked + reduced token budget)
 *   attempt 4+: rescue_only (fail honestly)
 */
export function deriveRetryMode(diag: RetryDiagnostics): RetryMode {
  const { attempt_number, failure_type, previous_mode } = diag;

  // First attempt is always normal
  if (attempt_number <= 1) return "normal";

  // If we've never tried chunked, try it now
  if (!previous_mode || previous_mode === "normal") return "chunked";

  // If chunked failed, try with lower token budget
  if (previous_mode === "chunked") return "low_token";

  // If low_token also failed, we've exhausted strategies
  return "rescue_only";
}

/**
 * Derive the max token budget for authoring based on retry mode.
 */
export function tokenBudgetForMode(mode: RetryMode): number {
  switch (mode) {
    case "normal": return 12000;
    case "chunked": return 8000;
    case "low_token": return 4000;
    case "rescue_only": return 4000;
  }
}

/**
 * Whether to skip monolithic authoring and go straight to section batching.
 */
export function shouldUseChunkedAuthoring(mode: RetryMode): boolean {
  return mode === "chunked" || mode === "low_token" || mode === "rescue_only";
}
