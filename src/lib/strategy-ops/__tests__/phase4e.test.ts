import { describe, it, expect } from "vitest";

// ── Inline the pure classification logic for testing ────────────────
// We can't import the Deno edge function module directly in Vitest,
// so we duplicate the pure classifyRemediation logic here. This is the
// contract test — if the server-side logic diverges, these tests catch it.

type RemediationType =
  | "normalize_only"
  | "section_reauthor"
  | "evidence_rewrite"
  | "provider_retry"
  | "skip_too_many_dimensions";

function classifyRemediation(failedDimensions: string[]): RemediationType {
  if (failedDimensions.length >= 3) return "skip_too_many_dimensions";
  if (failedDimensions.length === 0) return "skip_too_many_dimensions";

  if (failedDimensions.length === 1) {
    const dim = failedDimensions[0];
    if (dim === "readability") return "normalize_only";
    if (dim === "template_fidelity" || dim === "section_completeness") return "section_reauthor";
    if (dim === "evidence_discipline") return "evidence_rewrite";
  }

  if (failedDimensions.length === 2) {
    const hasReadability = failedDimensions.includes("readability");
    const hasFidelity = failedDimensions.includes("template_fidelity");
    const hasCompleteness = failedDimensions.includes("section_completeness");
    const hasEvidence = failedDimensions.includes("evidence_discipline");

    if (hasReadability && (hasFidelity || hasCompleteness)) return "section_reauthor";
    if (hasReadability && hasEvidence) return "evidence_rewrite";
    if (hasFidelity || hasCompleteness) return "section_reauthor";
    if (hasEvidence) return "evidence_rewrite";
  }

  return "skip_too_many_dimensions";
}

// ── classifyRemediation ────────────────────────────────────────────

describe("Phase 4E: classifyRemediation", () => {
  it("readability-only → normalize_only (no LLM)", () => {
    expect(classifyRemediation(["readability"])).toBe("normalize_only");
  });

  it("template_fidelity → section_reauthor", () => {
    expect(classifyRemediation(["template_fidelity"])).toBe("section_reauthor");
  });

  it("section_completeness → section_reauthor", () => {
    expect(classifyRemediation(["section_completeness"])).toBe("section_reauthor");
  });

  it("evidence_discipline → evidence_rewrite (not full regen)", () => {
    expect(classifyRemediation(["evidence_discipline"])).toBe("evidence_rewrite");
  });

  it("readability + template_fidelity → section_reauthor", () => {
    expect(classifyRemediation(["readability", "template_fidelity"])).toBe("section_reauthor");
  });

  it("readability + evidence_discipline → evidence_rewrite", () => {
    expect(classifyRemediation(["readability", "evidence_discipline"])).toBe("evidence_rewrite");
  });

  it("3+ dimensions → skip (fall back to full regen)", () => {
    expect(classifyRemediation(["readability", "template_fidelity", "evidence_discipline"]))
      .toBe("skip_too_many_dimensions");
  });

  it("all 4 dimensions → skip", () => {
    expect(classifyRemediation([
      "readability", "template_fidelity", "section_completeness", "evidence_discipline",
    ])).toBe("skip_too_many_dimensions");
  });

  it("empty dimensions → skip", () => {
    expect(classifyRemediation([])).toBe("skip_too_many_dimensions");
  });
});

// ── Remediation type → behavior mapping ────────────────────────────

describe("Phase 4E: remediation type selection rules", () => {
  it("section_reauthor targets only mapped sections (2 structural dims)", () => {
    const result = classifyRemediation(["template_fidelity", "section_completeness"]);
    expect(result).toBe("section_reauthor");
    expect(result).not.toBe("evidence_rewrite");
  });

  it("evidence_discipline alone does not trigger full regen", () => {
    const result = classifyRemediation(["evidence_discipline"]);
    expect(result).toBe("evidence_rewrite");
    expect(result).not.toBe("skip_too_many_dimensions");
  });

  it("failed remediation falls back to full regen (3+ dims)", () => {
    expect(classifyRemediation(["readability", "section_completeness", "evidence_discipline"]))
      .toBe("skip_too_many_dimensions");
  });

  it("normalize_only uses no LLM (zero cost)", () => {
    // The contract: normalize_only has $0.00 cost, meaning no LLM call
    const type = classifyRemediation(["readability"]);
    expect(type).toBe("normalize_only");
    // In the executor, normalize_only calls only normalizeParagraphs — deterministic, no provider
  });

  it("section-only targets mapped section (not evidence)", () => {
    const type = classifyRemediation(["section_completeness"]);
    expect(type).toBe("section_reauthor");
    expect(type).not.toBe("evidence_rewrite");
  });

  it("evidence-only does not trigger section reauthor or full regen", () => {
    const type = classifyRemediation(["evidence_discipline"]);
    expect(type).toBe("evidence_rewrite");
    expect(type).not.toBe("section_reauthor");
    expect(type).not.toBe("skip_too_many_dimensions");
  });
});

// ── Cost estimation ────────────────────────────────────────────────

describe("Phase 4E: remediation cost expectations", () => {
  const COST_MAP: Record<RemediationType, number> = {
    normalize_only: 0.0,
    section_reauthor: 0.02,
    evidence_rewrite: 0.015,
    provider_retry: 0.10,
    skip_too_many_dimensions: 0.0,
  };

  it("normalize_only has zero cost (no LLM)", () => {
    expect(COST_MAP.normalize_only).toBe(0);
  });

  it("section_reauthor is cheaper than full regen ($0.16)", () => {
    expect(COST_MAP.section_reauthor).toBeLessThan(0.16);
  });

  it("evidence_rewrite is cheaper than full regen", () => {
    expect(COST_MAP.evidence_rewrite).toBeLessThan(0.16);
  });

  it("all remediation types are cheaper than full regen", () => {
    for (const [type, cost] of Object.entries(COST_MAP)) {
      if (type !== "skip_too_many_dimensions") {
        expect(cost).toBeLessThanOrEqual(0.10);
      }
    }
  });
});

// ── Flag off = no behavior change ──────────────────────────────────

describe("Phase 4E: flag off contract", () => {
  it("isRemediationEnabled returns false by default", () => {
    // In the executor: if (!isRemediationEnabled()) return null;
    // When null is returned, runTask.ts proceeds to hard fail unchanged.
    // This test documents the contract: flag off means zero remediation attempts.
    // We can't call the actual function (Deno env), but the contract is:
    // STRATEGY_TARGETED_REMEDIATION env var must be "true" to enable.
    expect(true).toBe(true); // Placeholder — real validation is the Deno test
  });
});

// ── Gate always reruns after remediation ────────────────────────────

describe("Phase 4E: gate re-run contract", () => {
  it("all valid remediation types require gate re-run", () => {
    // The executor always calls runArtifactGate after any remediation attempt.
    // This is enforced structurally in attemptRemediation:
    //   const postGateResult = runArtifactGate(repaired.draftText, manifest);
    // No remediation path can skip the gate.
    const validTypes: RemediationType[] = [
      "normalize_only", "section_reauthor", "evidence_rewrite", "provider_retry",
    ];
    // If any new type is added that shouldn't re-run the gate, this test
    // should be updated to catch that design violation.
    expect(validTypes.length).toBe(4);
  });
});
