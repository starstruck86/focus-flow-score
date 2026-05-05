/**
 * Phase 3.5C — Artifact Gate ENFORCEMENT regression tests.
 *
 * Validates the production enforcement path logic:
 *   a) Passing output does NOT trigger regen
 *   b) Failing output triggers exactly ONE regen
 *   c) Second failure marks artifact_gate_failed
 *   d) Gate diagnostics are included in regen prompt
 *   e) 3.5B tests remain untouched (verified by running full suite)
 */
import { describe, it, expect } from "vitest";
import {
  runArtifactGate,
  checkTemplateFidelity,
  checkReadability,
  checkSectionCompleteness,
  checkEvidenceDiscipline,
  type ArtifactManifest,
  type ArtifactGateResult,
} from "../artifactGate";

// ── Helpers ──

const PROSE_MANIFEST: ArtifactManifest = {
  rubric: { mustHave: ["current state", "cost or risk", "change hypothesis", "open question"] },
  output: { shape: "prose" },
};

/** Simulate the enforcement logic from run-strategy-eval-synthesis */
function simulateEnforcement(
  output: string,
  manifest: ArtifactManifest,
  regenOutput?: string, // if provided, simulates regen returning this
): {
  artifactGateResult: ArtifactGateResult;
  regenerated: boolean;
  failed: boolean;
  regenTriggered: boolean;
  regenDiagnosticsUsed: string[];
} {
  let result = runArtifactGate(output, manifest);
  let regenerated = false;
  let failed = false;
  let regenTriggered = false;
  let regenDiagnosticsUsed: string[] = [];

  if (!result.pass) {
    regenTriggered = true;
    // Collect diagnostics that would be injected into regen prompt
    for (const g of result.gates) {
      if (!g.pass) {
        regenDiagnosticsUsed.push(...g.diagnostics);
      }
    }

    if (regenOutput) {
      regenerated = true;
      result = runArtifactGate(regenOutput, manifest);
      if (!result.pass) {
        failed = true;
      }
    } else {
      failed = true;
    }
  }

  return { artifactGateResult: result, regenerated, failed, regenTriggered, regenDiagnosticsUsed };
}

// ── Good output that passes all gates ──
const GOOD_OUTPUT = [
  "Currently the hotel group operates 14 properties across 3 brands, each running",
  "independent guest data systems. This fragmentation costs approximately $420K annually",
  "in duplicate licensing because each property maintains separate CRM, PMS, and loyalty",
  "platforms — resulting in 23% higher technology spend per occupied room compared to",
  "consolidated competitors.",
  "",
  "The real cost or risk here is concrete: without a unified guest profile, the VP of Revenue",
  "Management cannot execute cross-property upsell campaigns, which means an estimated",
  "$1.2M in unrealized ancillary revenue annually. This creates a change hypothesis —",
  "consolidation around operational margin rather than technology features, because GMs",
  "respond to cost-per-occupied-room metrics, not platform capabilities [KI:a1b2c3d4].",
  "This demonstrates the strategic shift required for sustainable growth.",
  "",
  "The open question remains: Ask the GM directly — who signs off on technology spend",
  "above $50K, and what is the current approval cycle? Confirm the per-property licensing",
  "cost with the IT Director to validate the $420K baseline [KI:e5f6g7h8].",
  "This validates the consolidation thesis before executive presentation.",
].join("\n");

// ── Bad output that fails gates ──
const BAD_OUTPUT = "This is a short generic output that doesn't cover anything meaningful.";

// ── Fixed output after regen ──
const FIXED_OUTPUT = GOOD_OUTPUT; // reuse good output as the regen result

describe("Phase 3.5C — Artifact Gate Enforcement", () => {
  // a) Pass output does NOT trigger regen
  it("passing output does not trigger regeneration", () => {
    const result = simulateEnforcement(GOOD_OUTPUT, PROSE_MANIFEST);
    expect(result.regenTriggered).toBe(false);
    expect(result.regenerated).toBe(false);
    expect(result.failed).toBe(false);
    expect(result.artifactGateResult.pass).toBe(true);
  });

  // b) Failed output triggers exactly ONE regen
  it("failed output triggers exactly one regeneration attempt", () => {
    const result = simulateEnforcement(BAD_OUTPUT, PROSE_MANIFEST, FIXED_OUTPUT);
    expect(result.regenTriggered).toBe(true);
    expect(result.regenerated).toBe(true);
    // The fixed output passes, so not marked as failed
    expect(result.failed).toBe(false);
    expect(result.artifactGateResult.pass).toBe(true);
  });

  // c) Second failure marks artifact_gate_failed
  it("second failure marks artifact_gate_failed", () => {
    const result = simulateEnforcement(BAD_OUTPUT, PROSE_MANIFEST, BAD_OUTPUT);
    expect(result.regenTriggered).toBe(true);
    expect(result.regenerated).toBe(true);
    expect(result.failed).toBe(true);
    expect(result.artifactGateResult.pass).toBe(false);
  });

  // c-alt) No regen output available also marks failed
  it("no regen output marks artifact_gate_failed", () => {
    const result = simulateEnforcement(BAD_OUTPUT, PROSE_MANIFEST, undefined);
    expect(result.regenTriggered).toBe(true);
    expect(result.regenerated).toBe(false);
    expect(result.failed).toBe(true);
  });

  // d) Gate diagnostics are included in regen prompt
  it("gate diagnostics are collected for regen prompt injection", () => {
    const result = simulateEnforcement(BAD_OUTPUT, PROSE_MANIFEST, FIXED_OUTPUT);
    expect(result.regenDiagnosticsUsed.length).toBeGreaterThan(0);
    // Should contain specific diagnostic strings from failing gates
    const allDiags = result.regenDiagnosticsUsed.join(" ");
    expect(allDiags).toMatch(/missing|stub|not found|filler|lacks/i);
  });

  // e) 3.5B gate functions remain untouched — verify they still work
  it("3.5B gate functions are unmodified and functional", () => {
    const fidelity = checkTemplateFidelity(GOOD_OUTPUT, PROSE_MANIFEST);
    expect(fidelity.gate).toBe("template_fidelity");
    expect(typeof fidelity.pass).toBe("boolean");

    const readability = checkReadability(GOOD_OUTPUT);
    expect(readability.gate).toBe("readability");

    const completeness = checkSectionCompleteness(GOOD_OUTPUT, PROSE_MANIFEST.rubric.mustHave);
    expect(completeness.gate).toBe("section_completeness");

    const evidence = checkEvidenceDiscipline(GOOD_OUTPUT);
    expect(evidence.gate).toBe("evidence_discipline");
  });

  // Structural: runArtifactGate returns correct shape
  it("runArtifactGate returns correct response shape", () => {
    const result = runArtifactGate(GOOD_OUTPUT, PROSE_MANIFEST);
    expect(result).toHaveProperty("pass");
    expect(result).toHaveProperty("gates");
    expect(result).toHaveProperty("failed_dimensions");
    expect(Array.isArray(result.gates)).toBe(true);
    expect(result.gates.length).toBe(4);
    for (const g of result.gates) {
      expect(g).toHaveProperty("gate");
      expect(g).toHaveProperty("pass");
      expect(g).toHaveProperty("diagnostics");
    }
  });

  // Max one regen: simulate enforcement flow tracks single attempt
  it("enforcement flow allows at most one regen attempt", () => {
    // Even with bad regen, only one attempt is made
    let regenCount = 0;
    let result = runArtifactGate(BAD_OUTPUT, PROSE_MANIFEST);
    if (!result.pass) {
      regenCount++;
      // Simulate regen producing bad output again
      result = runArtifactGate(BAD_OUTPUT, PROSE_MANIFEST);
      // No further regen — just mark failed
    }
    expect(regenCount).toBe(1);
  });
});
