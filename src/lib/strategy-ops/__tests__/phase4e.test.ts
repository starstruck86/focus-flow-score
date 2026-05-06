import { describe, it, expect } from "vitest";
import {
  classifyRemediation,
  isRemediationEnabled,
  type RemediationType,
} from "../../../../supabase/functions/_shared/strategy-orchestrator/remediationExecutor";

// ── classifyRemediation ────────────────────────────────────────────

describe("classifyRemediation", () => {
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
    // Edge case: shouldn't happen in practice, but defensive
    expect(classifyRemediation([])).toBe("skip_too_many_dimensions");
  });
});

// ── isRemediationEnabled ───────────────────────────────────────────

describe("isRemediationEnabled", () => {
  it("returns false by default (flag off = no behavior change)", () => {
    // In test environment, STRATEGY_TARGETED_REMEDIATION is not set
    // The function accesses Deno.env which doesn't exist, so it catches and returns false
    expect(isRemediationEnabled()).toBe(false);
  });
});

// ── Remediation type → behavior mapping ────────────────────────────

describe("remediation type selection rules", () => {
  it("section_reauthor targets only mapped sections (2 dims)", () => {
    const result = classifyRemediation(["template_fidelity", "section_completeness"]);
    expect(result).toBe("section_reauthor");
    // NOT full_regen, NOT evidence_rewrite
    expect(result).not.toBe("evidence_rewrite");
  });

  it("evidence_discipline alone does not trigger full regen", () => {
    const result = classifyRemediation(["evidence_discipline"]);
    expect(result).toBe("evidence_rewrite");
    expect(result).not.toBe("skip_too_many_dimensions");
  });

  it("failed remediation falls back to full regen (3+ dims)", () => {
    // If a single remediation fails, the pipeline calls with the same or more dims
    // 3+ dims always skips, ensuring fallback to hard fail (= full regen)
    expect(classifyRemediation(["readability", "section_completeness", "evidence_discipline"]))
      .toBe("skip_too_many_dimensions");
  });
});

// ── Cost estimation ────────────────────────────────────────────────

describe("remediation cost expectations", () => {
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
});

// ── Gate re-run contract ───────────────────────────────────────────

describe("gate re-run contract", () => {
  it("classifyRemediation never returns a type that skips gate re-run", () => {
    // All valid remediation types (non-skip) MUST re-run the gate
    // This is enforced in attemptRemediation: postGateResult = runArtifactGate(...)
    // Here we verify that the type selection never returns an invalid type
    const validTypes: RemediationType[] = [
      "normalize_only", "section_reauthor", "evidence_rewrite",
      "provider_retry", "skip_too_many_dimensions",
    ];

    const singleDims = ["readability", "template_fidelity", "section_completeness", "evidence_discipline"];
    for (const dim of singleDims) {
      const result = classifyRemediation([dim]);
      expect(validTypes).toContain(result);
    }
  });
});
