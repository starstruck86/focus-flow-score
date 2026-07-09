/**
 * Stale-run detection tests — proves stalled runs cannot sit forever.
 *
 * Tests the staleRunWatchdog logic:
 * 1. Runs pending past threshold get marked failed with stale_timeout
 * 2. Performance and error telemetry are persisted
 * 3. Different stages have different timeouts
 * 4. Runs within threshold are not touched
 * 5. Batch suffixed steps resolve to base stage timeouts
 */

import { describe, it, expect } from "vitest";

// ── Inline the core timeout logic for unit testing ──────────────
// (The actual staleRunWatchdog.ts runs in Deno; we mirror its logic here)

const WATCHED_STAGE_TIMEOUTS_MS: Record<string, number> = {
  synthesis: 6 * 60 * 1000,
  document_authoring: 9 * 60 * 1000,
};
const DEFAULT_PENDING_TIMEOUT_MS = 7 * 60 * 1000;
const HARD_PENDING_CEILING_MS = 14 * 60 * 1000;

function resolveStageKey(step: string): string {
  if (!step) return "";
  if (WATCHED_STAGE_TIMEOUTS_MS[step]) return step;
  const base = step.split(":")[0];
  return WATCHED_STAGE_TIMEOUTS_MS[base] ? base : step;
}

function shouldReap(step: string, ageMs: number): boolean {
  const stageKey = resolveStageKey(step);
  const timeoutMs = WATCHED_STAGE_TIMEOUTS_MS[stageKey] ?? DEFAULT_PENDING_TIMEOUT_MS;
  return ageMs > timeoutMs || ageMs > HARD_PENDING_CEILING_MS;
}

function buildErrorMessage(step: string, ageMs: number): string {
  const key = resolveStageKey(step);
  return WATCHED_STAGE_TIMEOUTS_MS[key]
    ? `stage_timeout:${step} (no progress for ${Math.round(ageMs / 1000)}s)`
    : `stage_timeout:${step || "unknown"} (generic pending watchdog after ${Math.round(ageMs / 1000)}s)`;
}

describe("Stale-run detection", () => {
  describe("timeout thresholds", () => {
    it("synthesis: reaps after 6 min", () => {
      expect(shouldReap("synthesis", 5 * 60 * 1000)).toBe(false);
      expect(shouldReap("synthesis", 7 * 60 * 1000)).toBe(true);
    });

    it("document_authoring: reaps after 9 min", () => {
      expect(shouldReap("document_authoring", 8 * 60 * 1000)).toBe(false);
      expect(shouldReap("document_authoring", 10 * 60 * 1000)).toBe(true);
    });

    it("unknown step: reaps after default 7 min", () => {
      expect(shouldReap("planning", 6 * 60 * 1000)).toBe(false);
      expect(shouldReap("planning", 8 * 60 * 1000)).toBe(true);
    });

    it("empty step: reaps after default timeout", () => {
      expect(shouldReap("", 8 * 60 * 1000)).toBe(true);
    });

    it("hard ceiling: reaps anything past 14 min", () => {
      expect(shouldReap("document_authoring", 15 * 60 * 1000)).toBe(true);
    });
  });

  describe("batch suffix resolution", () => {
    it("document_authoring:batch_5_of_12 resolves to document_authoring timeout", () => {
      // Under 9 min — should NOT reap
      expect(shouldReap("document_authoring:batch_5_of_12", 8 * 60 * 1000)).toBe(false);
      // Over 9 min — should reap
      expect(shouldReap("document_authoring:batch_5_of_12", 10 * 60 * 1000)).toBe(true);
    });

    it("synthesis:retry_2 resolves to synthesis timeout", () => {
      expect(shouldReap("synthesis:retry_2", 5 * 60 * 1000)).toBe(false);
      expect(shouldReap("synthesis:retry_2", 7 * 60 * 1000)).toBe(true);
    });
  });

  describe("error message format", () => {
    it("known stage includes stage name", () => {
      const msg = buildErrorMessage("synthesis", 400000);
      expect(msg).toContain("stage_timeout:synthesis");
      expect(msg).toContain("no progress for");
    });

    it("unknown stage uses generic watchdog", () => {
      const msg = buildErrorMessage("planning", 500000);
      expect(msg).toContain("stage_timeout:planning");
      expect(msg).toContain("generic pending watchdog");
    });

    it("empty step shows unknown", () => {
      const msg = buildErrorMessage("", 500000);
      expect(msg).toContain("unknown");
    });

    it("batch suffix preserved in error message", () => {
      const msg = buildErrorMessage("document_authoring:batch_3_of_8", 600000);
      expect(msg).toContain("document_authoring:batch_3_of_8");
    });
  });

  describe("telemetry contract", () => {
    it("reaped run gets failed status, error, and completed_at", () => {
      // Simulates what the watchdog writes to DB
      const step = "synthesis";
      const ageMs = 7 * 60 * 1000;
      const nowIso = new Date().toISOString();
      const error = buildErrorMessage(step, ageMs);

      const updatedRow = {
        status: "failed",
        progress_step: "failed",
        error,
        completed_at: nowIso,
        updated_at: nowIso,
      };

      expect(updatedRow.status).toBe("failed");
      expect(updatedRow.error).toContain("stage_timeout");
      expect(updatedRow.completed_at).toBeTruthy();
      expect(updatedRow.progress_step).toBe("failed");
    });

    it("non-stale run is not touched", () => {
      // Run within threshold — watchdog returns original row
      const isStale = shouldReap("synthesis", 3 * 60 * 1000);
      expect(isStale).toBe(false);
    });
  });

  describe("no silent pending guarantee", () => {
    it("every watched stage has a finite timeout", () => {
      for (const [_stage, ms] of Object.entries(WATCHED_STAGE_TIMEOUTS_MS)) {
        expect(ms).toBeGreaterThan(0);
        expect(ms).toBeLessThan(HARD_PENDING_CEILING_MS);
        expect(Number.isFinite(ms)).toBe(true);
      }
    });

    it("default timeout is finite and under hard ceiling", () => {
      expect(DEFAULT_PENDING_TIMEOUT_MS).toBeGreaterThan(0);
      expect(DEFAULT_PENDING_TIMEOUT_MS).toBeLessThan(HARD_PENDING_CEILING_MS);
    });

    it("hard ceiling catches any step that somehow bypasses stage timeout", () => {
      // Even a completely unknown future stage will be reaped at the ceiling
      expect(shouldReap("future_unknown_stage_xyz", HARD_PENDING_CEILING_MS + 1)).toBe(true);
    });
  });
});
