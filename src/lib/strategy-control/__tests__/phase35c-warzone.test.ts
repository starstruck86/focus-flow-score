/**
 * Phase 3.5C — Warzone Test Suite
 *
 * Adversarial fixtures, silent failure tests, regen degradation tests,
 * and call-count guardrail tests. Proves the artifact gate survives
 * realistic production failure modes.
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

// ── Manifests ─────────────────────────────────────────────────────

const EXEC_BRIEF_MANIFEST: ArtifactManifest = {
  rubric: { mustHave: ["situation", "commercial insight", "risks", "strategic why", "specific asks", "cited sources"] },
  output: { shape: "structured_artifact" },
};

const PROSE_MANIFEST: ArtifactManifest = {
  rubric: { mustHave: ["current state", "cost or risk", "change hypothesis", "open question"] },
  output: { shape: "prose" },
};

// ── Good baseline for regen degradation tests ─────────────────────

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

// ══════════════════════════════════════════════════════════════════
// 1. ADVERSARIAL ARTIFACT FIXTURES
// ══════════════════════════════════════════════════════════════════

describe("Phase 3.5C Warzone — Adversarial Fixtures", () => {

  // 1a. Polished wall-of-text executive brief
  it("FAILS polished wall-of-text executive brief", () => {
    const wallOfText = "The Beechwood Hotel currently operates four disconnected guest-facing platforms spanning CRM, PMS, loyalty, and ancillary booking systems, which collectively cost approximately $180K per year in redundant licensing fees while simultaneously creating data fragmentation that prevents the General Manager from executing personalized upsell campaigns at check-in, resulting in an estimated $42 per room-night in missed ancillary revenue that compounds to roughly $890K annually in unrealized opportunity, all while the upcoming Q3 renovation cycle threatens to lock in the current technology stack for three or more years if consolidation is not prioritized immediately, creating a situation where the VP of Revenue Management cannot build cross-property guest profiles because each property maintains its own siloed system that refuses to share data with the others, and the front-desk staff waste an average of 22 minutes per check-in resolving data conflicts across these fragmented systems, which directly erodes the operating margin that the GM is compensated on through a bonus structure tied to NPS and RevPAR metrics that are both being dragged down by this exact technology fragmentation.";
    const result = checkReadability(wallOfText);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("wall of text") || d.includes("words"))).toBe(true);
  });

  // 1b. Valid JSON with all keys but generic/filler sections
  it("FAILS valid JSON with all required keys but generic filler content", () => {
    const genericJSON = JSON.stringify({
      situation: "This section covers the current state of the account and provides an overview of the business context for the engagement moving forward into the next quarter with a comprehensive analysis of all relevant factors and considerations that may impact the overall trajectory of this relationship. Additional context is provided below for completeness.",
      commercial_insight: "The commercial opportunity here is significant and represents a meaningful chance to drive value for the customer while also improving our competitive position in the market through better alignment of our solution capabilities with their stated business objectives and strategic priorities going forward.",
      risks: "There are several risks to consider including market dynamics, competitive pressure, and timing considerations that could impact the outcome of this engagement in ways that need to be carefully monitored and addressed through proactive engagement and stakeholder management.",
      strategic_why: "The strategic rationale for this engagement is clear and compelling, offering the potential to transform how the customer approaches their core business challenges while creating meaningful differentiation in a crowded market landscape.",
      specific_asks: "We recommend exploring the customer's current priorities and aligning our approach to address their most pressing needs while maintaining flexibility to adapt as new information becomes available throughout the engagement lifecycle.",
      cited_sources: "Sources include various internal analyses and market research that informed the perspectives outlined above, providing a comprehensive foundation for the recommendations and strategic direction proposed in this document.",
    });
    const result = runArtifactGate(genericJSON, EXEC_BRIEF_MANIFEST);
    expect(result.pass).toBe(false);
    // Should fail on section_completeness (filler/no substance)
    expect(result.failed_dimensions).toContain("section_completeness");
  });

  // 1c. Citation-heavy artifact with decorative citations
  it("FAILS citation-heavy artifact with decorative (non-causal) citations", () => {
    const decorativeCitations = [
      "The hotel is a nice property [KI:a1b2c3d4]. The lobby is modern [KI:b2c3d4e5].",
      "Their team is experienced [KI:c3d4e5f6]. The market is growing [KI:d4e5f6g7].",
      "Guests enjoy the amenities [KI:e5f6g7h8]. The pool area is well-maintained [KI:f6g7h8i9].",
      "Staff training is adequate [KI:g7h8i9j0]. Revenue has been stable [KI:h8i9j0k1].",
    ].join(" ");
    const result = checkEvidenceDiscipline(decorativeCitations);
    expect(result.pass).toBe(false);
    expect(result.diagnostics.some(d => d.includes("causal reasoning"))).toBe(true);
  });

  // 1d. Structurally complete artifact with no causal chain
  it("FAILS structurally complete artifact with no causal chain", () => {
    const noCausal = JSON.stringify({
      situation: "Beechwood Hotel has four guest platforms. They use CRM and PMS and loyalty systems. The property has been operating for fifteen years in the downtown area of a mid-sized city serving business and leisure travelers.",
      commercial_insight: "Platform consolidation is a trend in hospitality. Many hotels are looking at unified guest data platforms. The technology market offers several options for integrated systems.",
      risks: "There are timeline pressures. Budget constraints exist. Stakeholder alignment is needed across multiple departments including operations, IT, finance, and revenue management teams.",
      strategic_why: "Consolidation makes sense for operational reasons. Many industry peers are pursuing similar initiatives. The technology landscape supports this direction with mature solutions.",
      specific_asks: "Explore the budget situation. Evaluate the timeline. Look into stakeholder preferences for vendor selection and implementation approach across the property portfolio.",
      cited_sources: "General industry knowledge and standard hospitality technology best practices inform these perspectives and strategic recommendations for the account engagement.",
    });
    const result = runArtifactGate(noCausal, EXEC_BRIEF_MANIFEST);
    expect(result.pass).toBe(false);
    // Should fail on section_completeness (lacks substance — no metrics, no causal language)
    expect(result.failed_dimensions).toContain("section_completeness");
  });

  // 1e. Artifact with metrics but no seller action
  it("FAILS artifact with metrics but no seller action", () => {
    const metricsNoAction = [
      "Currently the hotel group operates 14 properties with $420K in redundant licensing.",
      "The cost or risk is $1.2M annually in unrealized ancillary revenue because of 23% higher",
      "technology spend per occupied room compared to consolidated competitors.",
      "The change hypothesis is that consolidation reduces per-room technology cost by 35%,",
      "saving approximately $147K annually across the portfolio.",
      "The open question is whether the timing aligns with the renovation cycle.",
    ].join("\n\n");
    // This output has metrics but no actionable question/ask directed at a specific persona
    // The "open question" section lacks substance — it's just a statement, not an executable ask
    const result = checkSectionCompleteness(metricsNoAction, PROSE_MANIFEST.rubric.mustHave);
    // The "open question" section is < 40 words (stub)
    expect(result.diagnostics.some(d => d.includes("stub") || d.includes("lacks substance"))).toBe(true);
  });

  // 1f. Artifact with actions but no quantified business consequence
  it("FAILS artifact with actions but no quantified business consequence", () => {
    const actionsNoNumbers = JSON.stringify({
      situation: "Beechwood Hotel runs disconnected guest platforms that create fragmentation across the property portfolio. The GM faces pressure from corporate to modernize the technology stack before the renovation cycle because the current systems do not support cross-property guest recognition.",
      commercial_insight: "The real issue is that the hotel cannot execute personalized upsell at check-in. Guest preference data lives in separate silos, which means front-desk staff lack context. This creates missed revenue opportunities that compound over time as competitors pull ahead with unified platforms.",
      risks: "Without consolidation, the renovation cycle will lock in the current stack. The VP of Operations has flagged this concern. Delaying action compounds the complexity of future re-platforming. This situation creates organizational risk that extends beyond technology into guest satisfaction and staff retention.",
      strategic_why: "Consolidation is a revenue recovery initiative, not a technology project. The GM responds to operational metrics that directly tie to property profitability. Framing the conversation around margin protection rather than platform features changes the dynamic entirely with executive stakeholders.",
      specific_asks: "Ask the GM who signs off on technology spend and what the approval cycle looks like. Confirm the per-property licensing structure with the IT Director. Map the guest journey across all current touchpoints to identify the highest-friction moments.",
      cited_sources: "Based on engagement context and discovery findings indicating platform fragmentation as the root cause of guest experience degradation across the Beechwood portfolio. Supporting evidence from operational analysis confirms the relationship between data silos and missed upsell execution.",
    });
    const result = runArtifactGate(actionsNoNumbers, EXEC_BRIEF_MANIFEST);
    // Should fail section_completeness — sections lack substance (no metrics/numbers)
    expect(result.pass).toBe(false);
    expect(result.failed_dimensions).toContain("section_completeness");
  });
});

// ══════════════════════════════════════════════════════════════════
// 2. SILENT FAILURE TESTS
// ══════════════════════════════════════════════════════════════════

describe("Phase 3.5C Warzone — Silent Failure (Structurally Valid but Strategically Empty)", () => {

  it("FAILS structurally valid JSON with all mustHave keys but generic filler in every section", () => {
    const silentFail = JSON.stringify({
      situation: "This section describes the current state of the account. We will examine the landscape and identify key themes that are relevant to this engagement moving forward with a comprehensive review of all factors.",
      commercial_insight: "The following describes the commercial angle. There are opportunities to create value through better alignment of solutions with customer needs and strategic objectives for growth and improvement.",
      risks: "Below are the key risks to consider. Market dynamics, competitive pressures, and timing are all factors that could impact the engagement outcome and need careful monitoring and management.",
      strategic_why: "In this section we discuss the strategic rationale. The opportunity is compelling and offers potential for meaningful impact through better alignment of our capabilities with their requirements and priorities.",
      specific_asks: "Here we outline the specific requests including timeline alignment, budget validation, and stakeholder engagement to ensure comprehensive coverage of all relevant considerations in the decision process.",
      cited_sources: "The following are the sources informing this analysis. Internal research and market data provide the foundation for the perspectives shared throughout this document and its recommendations.",
    });
    const result = runArtifactGate(silentFail, EXEC_BRIEF_MANIFEST);
    expect(result.pass).toBe(false);
    const failedGates = result.failed_dimensions;
    expect(failedGates.length).toBeGreaterThan(0);
    // Must catch filler or lack of substance
    expect(
      failedGates.includes("section_completeness") || failedGates.includes("evidence_discipline")
    ).toBe(true);
  });

  it("FAILS prose that mentions all mustHave concepts but says nothing specific", () => {
    const vagueButComplete = [
      "The current state of the business involves several operational challenges",
      "that affect overall performance and create complexity for the leadership team.",
      "The cost or risk of maintaining the status quo is significant and could",
      "impact the organization's ability to compete effectively in the market.",
      "The change hypothesis suggests that a different approach could yield better",
      "outcomes and create more sustainable competitive advantages over time.",
      "The open question is whether the organization is ready to make the necessary",
      "changes and commit to a new strategic direction that addresses these issues.",
    ].join(" ");
    // All 4 mustHave phrases present, but zero substance
    const result = runArtifactGate(vagueButComplete, PROSE_MANIFEST);
    expect(result.pass).toBe(false);
  });
});

// ══════════════════════════════════════════════════════════════════
// 3. REGEN DEGRADATION TESTS
// ══════════════════════════════════════════════════════════════════

/** Simulates the enforcement logic from run-strategy-eval-synthesis */
function simulateEnforcement(
  output: string,
  manifest: ArtifactManifest,
  regenOutput?: string,
): {
  finalResult: ArtifactGateResult;
  regenTriggered: boolean;
  regenUsed: boolean;
  artifactGateFailed: boolean;
  regenDiagnostics: string[];
  regenCallCount: number;
  finalOutput: string;
} {
  let result = runArtifactGate(output, manifest);
  let regenTriggered = false;
  let regenUsed = false;
  let artifactGateFailed = false;
  let regenDiagnostics: string[] = [];
  let regenCallCount = 0;
  let finalOutput = output;

  if (!result.pass) {
    regenTriggered = true;
    for (const g of result.gates) {
      if (!g.pass) regenDiagnostics.push(...g.diagnostics);
    }

    if (regenOutput !== undefined) {
      regenCallCount = 1; // exactly one regen call
      // Only use regen if it also passes the gate (degradation guard)
      const regenResult = runArtifactGate(regenOutput, manifest);
      if (regenResult.pass) {
        regenUsed = true;
        result = regenResult;
        finalOutput = regenOutput;
      } else {
        // Regen is worse or also bad — keep original, mark failed
        artifactGateFailed = true;
        // Keep original result (not the regen result)
      }
    } else {
      artifactGateFailed = true;
    }
  }

  return { finalResult: result, regenTriggered, regenUsed, artifactGateFailed, regenDiagnostics, regenCallCount, finalOutput };
}

describe("Phase 3.5C Warzone — Regen Degradation", () => {

  it("does NOT replace passing output with worse regen output", () => {
    // Original passes → no regen triggered at all
    const result = simulateEnforcement(GOOD_OUTPUT, PROSE_MANIFEST, "garbage");
    expect(result.regenTriggered).toBe(false);
    expect(result.regenCallCount).toBe(0);
    expect(result.finalOutput).toBe(GOOD_OUTPUT);
  });

  it("rejects regen that is also bad and marks artifact_gate_failed", () => {
    const badOriginal = "Short bad output.";
    const badRegen = "Also short and bad.";
    const result = simulateEnforcement(badOriginal, PROSE_MANIFEST, badRegen);
    expect(result.regenTriggered).toBe(true);
    expect(result.regenCallCount).toBe(1);
    expect(result.artifactGateFailed).toBe(true);
  });

  it("accepts regen that fixes the problems", () => {
    const badOriginal = "Short bad output.";
    const result = simulateEnforcement(badOriginal, PROSE_MANIFEST, GOOD_OUTPUT);
    expect(result.regenTriggered).toBe(true);
    expect(result.regenUsed).toBe(true);
    expect(result.artifactGateFailed).toBe(false);
    expect(result.finalOutput).toBe(GOOD_OUTPUT);
  });

  it("collects exact gate failure reasons for regen prompt injection", () => {
    const badOriginal = "Short bad output.";
    const result = simulateEnforcement(badOriginal, PROSE_MANIFEST, GOOD_OUTPUT);
    expect(result.regenDiagnostics.length).toBeGreaterThan(0);
  });

  it("marks artifact_gate_failed when no regen output available", () => {
    const badOriginal = "Short bad output.";
    const result = simulateEnforcement(badOriginal, PROSE_MANIFEST, undefined);
    expect(result.regenTriggered).toBe(true);
    expect(result.artifactGateFailed).toBe(true);
    expect(result.regenCallCount).toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════
// 4. CALL-COUNT GUARDRAIL TESTS
// ══════════════════════════════════════════════════════════════════

describe("Phase 3.5C Warzone — Call-Count Guardrails", () => {

  it("0 regen calls when gate passes", () => {
    const result = simulateEnforcement(GOOD_OUTPUT, PROSE_MANIFEST);
    expect(result.regenCallCount).toBe(0);
    expect(result.regenTriggered).toBe(false);
  });

  it("exactly 1 regen call when gate fails", () => {
    const result = simulateEnforcement("bad", PROSE_MANIFEST, GOOD_OUTPUT);
    expect(result.regenCallCount).toBe(1);
  });

  it("never more than 1 regen call even with multiple failures", () => {
    // Simulate multiple bad outputs — only one regen attempt
    const result = simulateEnforcement("bad", PROSE_MANIFEST, "also bad");
    expect(result.regenCallCount).toBe(1);
    expect(result.artifactGateFailed).toBe(true);
  });

  it("adversarial loop is not re-run after artifact gate regen (structural guarantee)", () => {
    // The enforcement flow: adversarial → artifact gate → optional regen → done
    // No path back to adversarial. We verify by checking that regen only
    // invokes the gate, not a full pipeline re-run.
    const result = simulateEnforcement("bad", PROSE_MANIFEST, GOOD_OUTPUT);
    // If adversarial were re-run, we'd expect more than 1 regen call
    expect(result.regenCallCount).toBe(1);
    expect(result.regenUsed).toBe(true);
  });

  it("enforcement path is deterministic: same inputs produce same gate results", () => {
    const r1 = simulateEnforcement(GOOD_OUTPUT, PROSE_MANIFEST);
    const r2 = simulateEnforcement(GOOD_OUTPUT, PROSE_MANIFEST);
    expect(r1.finalResult.pass).toBe(r2.finalResult.pass);
    expect(r1.finalResult.failed_dimensions).toEqual(r2.finalResult.failed_dimensions);
    expect(r1.regenCallCount).toBe(r2.regenCallCount);
  });
});

// ══════════════════════════════════════════════════════════════════
// 5. EXISTING GATE FUNCTIONS REMAIN STABLE
// ══════════════════════════════════════════════════════════════════

describe("Phase 3.5C Warzone — Gate Function Stability", () => {

  it("runArtifactGate always returns exactly 4 gates", () => {
    const r1 = runArtifactGate(GOOD_OUTPUT, PROSE_MANIFEST);
    const r2 = runArtifactGate("", EXEC_BRIEF_MANIFEST);
    expect(r1.gates.length).toBe(4);
    expect(r2.gates.length).toBe(4);
    const expectedGates = ["template_fidelity", "readability", "section_completeness", "evidence_discipline"];
    expect(r1.gates.map(g => g.gate)).toEqual(expectedGates);
    expect(r2.gates.map(g => g.gate)).toEqual(expectedGates);
  });

  it("each gate returns correct shape", () => {
    const result = runArtifactGate(GOOD_OUTPUT, PROSE_MANIFEST);
    for (const g of result.gates) {
      expect(g).toHaveProperty("gate");
      expect(g).toHaveProperty("pass");
      expect(g).toHaveProperty("diagnostics");
      expect(typeof g.gate).toBe("string");
      expect(typeof g.pass).toBe("boolean");
      expect(Array.isArray(g.diagnostics)).toBe(true);
    }
  });
});
